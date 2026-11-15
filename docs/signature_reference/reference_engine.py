#!/usr/bin/env python3
"""Cosmo - Flight Response Signature: REFERENCE IMPLEMENTATION (Python 3 stdlib only).

Purpose: single source of truth for every number in docs/SIGNATURE_SPEC.md and for the
test expectations in docs/PROMPT_SIGNATURE_BUILD.md. The production engine is TypeScript;
it must reproduce expected_values.json (tolerance 0.05 on FRI, 0.01 on z).

Usage:  python3 reference_engine.py <data_dir>  > expected_values.json
Files are located by substring of the file name anywhere under <data_dir>.
"""
import csv, json, math, os, re, statistics as st, sys

PRE = ['L-92', 'L-44', 'L-3']
POST = ['R+1', 'R+45', 'R+82', 'R+194']
TPS = PRE + POST
CREW = ['C001', 'C002', 'C003', 'C004']
FILE_HINTS = {'cbc': 'CBC', 'cmp': 'Metabolic_Panel', 'cardio': 'cardiovascular', 'immune': 'serum_immune'}

# ---- constants (A = assumption, D = derived from the data, see spec section 4) ----
D2_N3 = 1.693                 # E[range]/sigma for 3 normal draws (control-chart constant; simulation gives 1.692)
S_FLOOR = math.log(1.10)      # A: within-person scale never below 10 %
MIN_EFFECT = math.log(1.10)   # A: selection needs >= 10 % change in every crew member
Z_CAP = 4.0                   # A: 4 scale units = full response for one marker
W_CORE, W_SUPP = 1.0, 0.5     # A: evidence-tier weights (not fitted)
T_LOW, T_HIGH = 20.0, 40.0    # D: from the pre-flight noise floor (p75 = 18.5, max = 37.4)
WINDOW_DAYS = 7               # A: transition window after a gravity transition
RETEST_MIN, RETEST_MAX = 3, 21  # A: clip for the first re-test day
SKIP = {('cardio', 'haptoglobin'),            # hits an upper quantification ceiling (17,907,000 repeated 7x)
        ('cmp', 'bun_to_creatinine_ratio'), ('cmp', 'egfr_african_american'), ('cmp', 'egfr_non_african_american'),
        ('cbc', 'absolute_basophils'), ('cbc', 'basophils'), ('cbc', 'absolute_eosinophils'), ('cbc', 'eosinophils')}
CBC_DIFF = [('absolute_neutrophils', 'neutrophils'), ('absolute_lymphocytes', 'lymphocytes'), ('absolute_monocytes', 'monocytes'),
            ('absolute_eosinophils', 'eosinophils'), ('absolute_basophils', 'basophils')]
CBC_SUSPECT_NULL = ['mch', 'mchc', 'mpv', 'platelet_count', 'rdw']


# ------------------------------------------------------------------ loading
def find_file(data_dir, hint):
    for root, _, files in os.walk(data_dir):
        for f in sorted(files):
            if f.lower().endswith('.csv') and hint.lower() in f.lower():
                return os.path.join(root, f)
    raise FileNotFoundError(hint)

def read_table(path, kind):
    """-> {analyte: {crew: {timepoint: float}}}. Non-numeric cells ('NA', '') are missing."""
    with open(path, encoding='utf-8-sig', newline='') as fh:
        rows = list(csv.reader(fh))
    header, body = rows[0], rows[1:]
    cols = {}
    for i, c in enumerate(header):
        if i == 0 or not c:
            continue
        m = re.match(r'(.+?)_value(?:_.+)?$', c) if kind in ('cbc', 'cmp') else re.match(r'(.+)_concentration_.+$', c)
        if m:
            cols[m.group(1)] = i
    out = {a: {c: {} for c in CREW} for a in cols}
    for r in body:
        parts = r[0].split('_')          # C001_whole-blood_R+1_cbc  /  C001_serum_R+1
        crew, tp = parts[0], parts[2]
        for a, i in cols.items():
            try:
                out[a][crew][tp] = float(r[i])
            except (ValueError, IndexError):
                pass
    return out

def load_all(data_dir):
    M, qc = {}, []
    for kind, hint in FILE_HINTS.items():
        for a, v in read_table(find_file(data_dir, hint), kind).items():
            M[(kind, a)] = v
    # QC-1  CBC row integrity: absolute differential must equal percent x WBC x 10 (cells/uL)
    wbc = M[('cbc', 'white_blood_cell_count')]
    for c in CREW:
        for t in TPS:
            if t not in wbc[c]:
                continue
            bad = False
            for a, p in CBC_DIFF:
                if t in M[('cbc', a)][c] and t in M[('cbc', p)][c]:
                    exp = M[('cbc', p)][c][t] * wbc[c][t] * 10
                    if exp > 0 and abs(M[('cbc', a)][c][t] - exp) / exp > 0.15:
                        bad = True
            if bad:
                for a, p in CBC_DIFF:
                    old = M[('cbc', a)][c].get(t)
                    new = float(round(M[('cbc', p)][c][t] * wbc[c][t] * 10))
                    M[('cbc', a)][c][t] = new
                    qc.append({'rule': 'QC1_cbc_row_shift', 'crew': c, 'timepoint': t, 'analyte': a, 'old': old, 'new': new})
                for a in CBC_SUSPECT_NULL:
                    if t in M[('cbc', a)][c]:
                        qc.append({'rule': 'QC1_cbc_row_shift', 'crew': c, 'timepoint': t, 'analyte': a, 'old': M[('cbc', a)][c][t], 'new': None})
                        del M[('cbc', a)][c][t]
    # QC-2  glucose < 50 mg/dL in >= 2 crew at the same timepoint -> pre-analytical artefact, drop those values
    g = M[('cmp', 'glucose')]
    for t in TPS:
        low = [c for c in CREW if t in g[c] and g[c][t] < 50]
        if len(low) >= 2:
            for c in low:
                qc.append({'rule': 'QC2_glucose_artifact', 'crew': c, 'timepoint': t, 'analyte': 'glucose', 'old': g[c][t], 'new': None})
                del g[c][t]
    return M, qc


# ------------------------------------------------------------------ core maths
def pre_vals(series, base_tps=None):
    return [series[t] for t in (base_tps or PRE) if t in series]

def baseline(vals):
    return st.median(vals)

def scale(M, key, crew=CREW):
    """Pooled within-person scale (ln units): median over crew of ln-range(3 pre-flight draws) / d2, floored."""
    ss = []
    for c in crew:
        p = pre_vals(M[key][c])
        if len(p) == 3 and min(p) > 0:
            ss.append((math.log(max(p)) - math.log(min(p))) / D2_N3)
    return max(st.median(ss), S_FLOOR) if len(ss) >= 2 else None

def zscore(M, key, c, t, s, base_tps=None):
    ser = M[key][c]
    p = pre_vals(ser, base_tps)
    if s is None or t not in ser or len(p) < 2 or min(p) <= 0 or ser[t] <= 0:
        return None
    return math.log(ser[t] / baseline(p)) / s

def envelope(M, key, c, t, base_tps=None):
    ser = M[key][c]
    p = pre_vals(ser, base_tps)
    if t not in ser or len(p) < 2:
        return None
    return 'hi' if ser[t] > max(p) else 'lo' if ser[t] < min(p) else 'in'

def select_signature(M, crew):
    """(1) same direction vs own pre-flight median in all crew; (2) >= 10 % in all crew;
    (3) CORE: R+1 beyond own pre-flight range on that side in all crew; SUPPORTING: in all but one."""
    core, supp = {}, {}
    for key in sorted(M):
        if key in SKIP:
            continue
        lrs, envs = [], []
        for c in crew:
            p = pre_vals(M[key][c])
            if len(p) < 3 or 'R+1' not in M[key][c] or min(p) <= 0:
                break
            lrs.append(math.log(M[key][c]['R+1'] / baseline(p)))
            envs.append(envelope(M, key, c, 'R+1'))
        else:
            for sgn, side in ((1, 'hi'), (-1, 'lo')):
                if all(sgn * l >= MIN_EFFECT for l in lrs):
                    k = sum(e == side for e in envs)
                    if k == len(crew):
                        core[key] = sgn
                    elif k == len(crew) - 1:
                        supp[key] = sgn
    return core, supp

def fri(M, core, supp, S, c, t, base_tps=None):
    """Flight Response Index 0..100 -> (value | None, {marker: {...}})."""
    num = den = 0.0
    parts, ncore = {}, 0
    for group, w, tier in ((core, W_CORE, 'core'), (supp, W_SUPP, 'supporting')):
        for key, sgn in group.items():
            z = zscore(M, key, c, t, S[key], base_tps)
            if z is None:
                continue
            q = min(max(sgn * z, 0.0), Z_CAP) / Z_CAP
            num += w * q
            den += w
            ncore += tier == 'core'
            b = baseline(pre_vals(M[key][c], base_tps))
            parts[key[1]] = {'tier': tier, 'value': M[key][c][t], 'baseline': b, 'fold': round(M[key][c][t] / b, 4),
                             'z': round(z, 3), 'q': round(q, 3), 'weight': w, 'envelope': envelope(M, key, c, t, base_tps)}
    if ncore < 2:
        return None, parts
    return 100 * num / den, parts

def fri_band(M, core, supp, S, c, t):
    """min/max over the full baseline and the three drop-one-draw baselines."""
    vals = [fri(M, core, supp, S, c, t)[0]]
    for d in PRE:
        vals.append(fri(M, core, supp, S, c, t, base_tps=[x for x in PRE if x != d])[0])
    vals = [v for v in vals if v is not None]
    return (min(vals), max(vals)) if vals else (None, None)

def classify(value, days_since_transition):
    if value is None:
        return 'INSUFFICIENT'
    if value < T_LOW:
        return 'BASELINE'
    if value < T_HIGH:
        return 'INDETERMINATE'
    return 'EXPECTED_FLIGHT_RESPONSE' if days_since_transition <= WINDOW_DAYS else 'UNEXPECTED_ACTIVATION'

def half_life_bound(f_a, f_b, dt):
    """Two panels dt days apart. Returns the implied half-life (an UPPER bound when the gap is long) or None if not falling."""
    if f_a is None or f_b is None or f_b >= f_a or f_b <= 0:
        return None
    return dt * math.log(2) / math.log(f_a / f_b)

def eta_days(f0, t_half_lo, t_half_hi):
    """Days after the panel until the predicted FRI crosses T_LOW, for the fast and slow half-life."""
    L = math.log2(f0 / T_LOW)
    lo, hi = t_half_lo * L, t_half_hi * L
    return lo, hi, int(min(max(math.ceil(lo), RETEST_MIN), RETEST_MAX))


# ------------------------------------------------------------------ daily strain (Cosmo KPIs)
KPI_DIR = {'sleep_hours': -1, 'sleep_quality': -1, 'resting_hr': +1, 'fatigue': +1, 'mood': -1}   # +1: higher is worse
KPI_FLOOR = {'sleep_hours': 0.5, 'sleep_quality': 0.5, 'resting_hr': 3.0, 'fatigue': 0.5, 'mood': 0.5}  # A
def daily_strain(history, today):
    """history: list of dicts (previous <= 14 days, oldest first); today: dict. -> DSS 0..100 or None (< 5 history days)."""
    if len(history) < 5:
        return None
    qs = []
    for k, d in KPI_DIR.items():
        xs = [h[k] for h in history[-14:] if h.get(k) is not None]
        if len(xs) < 5 or today.get(k) is None:
            continue
        m = st.median(xs)
        mad = st.median([abs(x - m) for x in xs])
        s = max(1.4826 * mad, KPI_FLOOR[k])
        qs.append(min(max(d * (today[k] - m) / s, 0.0), 3.0) / 3.0)
    return 100 * sum(qs) / len(qs) if qs else None


# ------------------------------------------------------------------ report
def r1(x):
    return None if x is None else round(x, 1)

def main(data_dir):
    M, qc = load_all(data_dir)
    core, supp = select_signature(M, CREW)
    S = {k: scale(M, k) for k in list(core) + list(supp)}
    out = {'_readme': 'Generated by reference_engine.py from the NASA OSDR files. Do not edit by hand.',
           'constants': {'D2_N3': D2_N3, 'S_FLOOR': round(S_FLOOR, 4), 'MIN_EFFECT': round(MIN_EFFECT, 4), 'Z_CAP': Z_CAP, 'W_CORE': W_CORE,
                         'W_SUPP': W_SUPP, 'T_LOW': T_LOW, 'T_HIGH': T_HIGH, 'WINDOW_DAYS': WINDOW_DAYS},
           'qc_log': qc,
           'signature': {'core': {k[1]: v for k, v in core.items()}, 'supporting': {k[1]: v for k, v in supp.items()}},
           'scales_ln': {k[1]: round(v, 4) for k, v in S.items()}}
    ncand = sum(1 for k in M if k not in SKIP and all(len(pre_vals(M[k][c])) == 3 and 'R+1' in M[k][c] and min(pre_vals(M[k][c])) > 0 for c in CREW))
    out['selection'] = {'candidates_tested': ncand, 'expected_core_by_chance_exchangeable': round(ncand * 2 / 256, 2),
                        'expected_core_by_chance_if_L44_uninformative': round(ncand * 2 / 81, 2)}
    # evidence table
    ev = {}
    for key, sgn in list(core.items()) + list(supp.items()):
        pcts = [round(100 * (M[key][c]['R+1'] / baseline(pre_vals(M[key][c])) - 1), 1) for c in CREW]
        side = 'hi' if sgn > 0 else 'lo'
        ev[key[1]] = {'file': key[0], 'direction': sgn, 'pct_change_R1_vs_median': dict(zip(CREW, pcts)),
                      'beyond_own_range': sum(envelope(M, key, c, 'R+1') == side for c in CREW),
                      'z_R1': {c: round(zscore(M, key, c, 'R+1', S[key]), 2) for c in CREW}}
    out['evidence'] = ev
    # FRI for every real panel
    day = {'R+1': 1, 'R+45': 45, 'R+82': 82, 'R+194': 194}
    panels = {}
    for c in CREW:
        for t in POST:
            v, parts = fri(M, core, supp, S, c, t)
            lo, hi = fri_band(M, core, supp, S, c, t)
            panels[f'{c}_{t}'] = {'fri': r1(v), 'band': [r1(lo), r1(hi)], 'class': classify(v, day[t]), 'markers': parts}
    out['panels'] = panels
    # noise floor: each pre-flight draw scored against the other two
    nf = {f'{c}_{t}': r1(fri(M, core, supp, S, c, t, base_tps=[x for x in PRE if x != t])[0]) for c in CREW for t in PRE}
    vals = sorted(nf.values())
    out['noise_floor'] = {'pseudo_panels': nf, 'sorted': vals, 'median': r1(st.median(vals)), 'p75': r1((vals[8] + vals[9]) / 2), 'max': vals[-1]}
    # leave-one-crew-out
    loco = {}
    tot_n = tot_dir = tot_env = 0
    for held in CREW:
        tr = [c for c in CREW if c != held]
        co, su = select_signature(M, tr)
        Sl = {k: scale(M, k, tr) for k in list(co) + list(su)}
        n = hd = he = 0
        for grp in (co, su):
            for key, sgn in grp.items():
                p = pre_vals(M[key][held])
                if len(p) < 2 or 'R+1' not in M[key][held]:
                    continue
                n += 1
                hd += sgn * math.log(M[key][held]['R+1'] / baseline(p)) >= MIN_EFFECT
                he += envelope(M, key, held, 'R+1') == ('hi' if sgn > 0 else 'lo')
        tot_n += n; tot_dir += hd; tot_env += he
        loco[held] = {'core': sorted(k[1] for k in co), 'supporting': sorted(k[1] for k in su), 'n_selected': n,
                      'heldout_ge10pct_predicted_direction': hd, 'heldout_beyond_own_range': he,
                      'heldout_fri': {t: r1(fri(M, co, su, Sl, held, t)[0]) for t in POST}}
    out['loco'] = {'folds': loco, 'total_selected': tot_n, 'total_direction_hits': tot_dir, 'total_envelope_hits': tot_env,
                   'markers_selected_in_all_4_folds': sorted(set.intersection(*[set(f['core']) | set(f['supporting']) for f in loco.values()]))}
    # recovery
    tb = {}
    for c in CREW:
        h = half_life_bound(panels[f'{c}_R+1']['fri'], panels[f'{c}_R+45']['fri'], 44)
        if h is not None:
            tb[c] = round(h, 2)
    out['recovery'] = {'half_life_upper_bound_days': tb, 'reference_band_all': [min(tb.values()), max(tb.values())], 'eta': {}}
    for c in CREW:
        f0 = panels[f'{c}_R+1']['fri']
        others = [v for k, v in tb.items() if k != c]
        lo, hi, retest = eta_days(f0, min(others), max(others))
        out['recovery']['eta'][c] = {'fri0': f0, 'loo_half_life_band': [min(others), max(others)], 'eta_days_after_panel': [r1(lo), r1(hi)], 'first_retest_day_offset': retest}
    # context facts used in the spec
    lym = M[('cbc', 'absolute_lymphocytes')]
    out['lymphocytes'] = {c: {'pre': pre_vals(lym[c]), 'median': baseline(pre_vals(lym[c])), 'R+1': lym[c]['R+1'],
                              'pct_vs_median': round(100 * (lym[c]['R+1'] / baseline(pre_vals(lym[c])) - 1), 1),
                              'pct_vs_L-3': round(100 * (lym[c]['R+1'] / lym[c]['L-3'] - 1), 1),
                              'highest_preflight_draw': max(PRE, key=lambda t: lym[c][t])} for c in CREW}
    crp = M[('cardio', 'crp')]
    s_crp = scale(M, ('cardio', 'crp'))
    out['crp'] = {c: {'mg_per_L': {t: round(crp[c][t] / 1e6, 1) for t in TPS}, 'z_R1': round(zscore(M, ('cardio', 'crp'), c, 'R+1', s_crp), 2),
                      'envelope_R1': envelope(M, ('cardio', 'crp'), c, 'R+1')} for c in CREW}
    batch = {}
    for kind in ('cardio', 'immune'):
        n = low = 0
        for key in M:
            if key[0] != kind:
                continue
            for c in CREW:
                v = [M[key][c].get(t) for t in PRE]
                if None in v or len(set(v)) < 3:
                    continue
                n += 1
                low += v[1] == min(v)
        batch[kind] = {'n': n, 'L44_is_lowest': low, 'share': round(low / n, 3)}
    out['L44_batch_check'] = batch
    il8 = M[('immune', 'il_8')]['C002']
    out['c002_il8'] = {'R+45': il8['R+45'], 'baseline': baseline(pre_vals(il8)), 'fold': round(il8['R+45'] / baseline(pre_vals(il8)), 2)}
    # daily strain test vector (synthetic, deterministic)
    hist = [{'sleep_hours': 7.0 + 0.1 * (i % 3), 'sleep_quality': 4, 'resting_hr': 58 + (i % 2), 'fatigue': 2, 'mood': 4} for i in range(14)]
    out['daily_strain_test'] = {'history_rule': '14 days: sleep_hours = 7.0 + 0.1*(i%3), sleep_quality 4, resting_hr = 58 + (i%2), fatigue 2, mood 4 (i = 0..13)',
                                'calm_day': {'input': {'sleep_hours': 7.1, 'sleep_quality': 4, 'resting_hr': 58, 'fatigue': 2, 'mood': 4}},
                                'strained_day': {'input': {'sleep_hours': 5.0, 'sleep_quality': 2, 'resting_hr': 66, 'fatigue': 4, 'mood': 3}}}
    for k in ('calm_day', 'strained_day'):
        out['daily_strain_test'][k]['dss'] = r1(daily_strain(hist, out['daily_strain_test'][k]['input']))
    return out

if __name__ == '__main__':
    json.dump(main(sys.argv[1] if len(sys.argv) > 1 else 'data'), sys.stdout, indent=1, ensure_ascii=False)
