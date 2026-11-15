# Cosmo — Signature Triage: specification

Status: decided, ready to build. Author: lead scientist-engineer pass, 2026-11-14.
**Read `docs/SIGNATURE_ADDENDUM_SECOND_ASSAY.md` too: it corrects §8 point 4, replaces the demo script (§9)
and three dialogues (§7.1), and adds the two-assay confirmation badge. Where they differ, the addendum wins.**
Every number in this document is produced by `docs/signature_reference/reference_engine.py` from the five
NASA files and stored in `docs/signature_reference/expected_values.json` (called **fixture** below), unless it
is marked **ASSUMPTION** or carries a citation. Nothing here is a medical claim.

---

## 0. Name and pitch

**Signature Triage** — "Is it the flight, or is it something new?"

> Cosmo turns a scarce blood panel into a three-way answer — *baseline*, *expected flight response* or
> *unexpected activation* — by comparing six markers with the astronaut's own pre-flight biology and with the
> real Inspiration4 crew pattern, says how sure it is, and tells the crew when the next draw is worth a kit.

What is new is not the index. It is what the index is used for: context (same pattern, different meaning
depending on mission phase), a measured noise floor, a re-test rule, and a data-quality gate that caught four
real defects in the NASA files.

---

## 1. What the data say (Step 1)

Data: 4 crew (C001–C004), draws at L-92, L-44, L-3, R+1, R+45, R+82, R+194. Personal baseline = median of the
three pre-flight draws. "Beyond own range" = R+1 is higher (or lower) than all three of that person's
pre-flight values.

### 1.1 Markers that moved the same way in 4/4 crew at R+1

117 blood/serum analytes had all four crew measured; 21 moved in the same direction in 4/4
(chance alone gives about 15 of 117, so direction-only agreement is weak evidence).
After the selection rule in §4.3 six remain:

| Marker (file) | Dir | % vs own median at R+1 (C001..C004) | Beyond own range | % vs baseline at R+45 | at R+82 |
|---|---|---|---|---|---|
| IL-6 (OSD-575 immune) | up | +139.0, +28.3, +184.6, +59.7 | 4/4 | -43, +169, -51, -10 | -64, +14, +36, +52 |
| MCP-1 (OSD-575 immune) | up | +56.3, +65.4, +183.4, +15.3 | 4/4 | -68, +117, +37, -4 | -43, +7, +83, +164 |
| IL-10 (OSD-575 immune) | up | +69.4, +13.5, +36.3, +33.4 | 4/4 | -37, -1, -8, +4 | +34, +19, -22, -20 |
| IL-27 (OSD-575 immune) | up | +31.7, +34.1, +28.9, +62.2 | 3/4 | -10, +4, -53, +27 | +12, +40, -21, -16 |
| Glucose (OSD-575 CMP) | up | +12.5, +15.3, +37.3, +16.9 | 3/4 | +5, QC, QC, QC | +14, +7, +7, -4 |
| Monocytes % (OSD-569 CBC) | up | +15.2, +41.1, +38.2, +12.4 | 3/4 | -5, +39, +18, +17 | +25, +16, +22, +3 |

All four cytokines (IL-6, MCP-1, IL-10, IL-27) are in the list of cytokines reported as significantly
increased at R+1 by the peer-reviewed analysis of the same crew (Kim et al. 2024, ref. [4]).
Glucose and monocyte % are not covered by that paper.

### 1.2 Earlier "facts" that did not survive re-verification

| Earlier statement | Re-verified result | Decision |
|---|---|---|
| Lymphocytes fell in 4/4 (-38, -46, -34, -27 %) | True only against L-3 (-38.5, -46.4, -33.9, -26.9 %). Against the personal pre-flight median: -26.8, -27.3, +0.1, +20.7 %. L-3 is the highest pre-flight draw for lymphocytes and for WBC in 4/4 crew, so the "drop" is mostly a return from a pre-launch high. | Not in the index. Shown as context only. Do not say "immune suppression". |
| C003 L-92 lymphocytes = 6826/uL is an outlier | It is a column shift in the source row, not biology: 6826 is the neutrophil count (71.1 % x 9.6 k). True lymphocytes = 1997/uL. Platelets, MPV, RDW, MCHC in the same row are shifted too. | QC-1 repairs the row. |
| CRP rose in 4/4 (+107, +4, +95, +29 %) | Direction true, but R+1 is inside the person's own pre-flight range in 3/4; z = 0.59, 0.03, 0.54, 0.20. Pre-flight CRP varies up to 16x within one person (C004: 1.3 to 21.4 mg/L). | Not in the index. |
| Glucose rose in 4/4 = "metabolic stress" | Direction true; R+1 values are 83–103 mg/dL against a lab reference of 65–99; fasting state is not recorded. | Supporting marker only. Never call it metabolic stress. |
| IL-6 rose in 4/4 | Confirmed, and above every pre-flight value in 4/4. Magnitude differs 6x between crew. | Core marker. |

### 1.3 The "individual-specific, no uniform pattern" conflict

A public 2026 hackathon guide for this dataset states that TNFa, IL-6 and IL-1b trajectories were
individual-specific with no crew-wide pattern, using fold-change from the L-44 draw (ref. [8]). Checked here:

- **L-44 is a low batch in the serum multiplex panels.** It is the lowest of the three pre-flight draws in
  80 % of cardiovascular-panel series (28/35) and 67 % of immune-panel series (187/279); chance is 33 %.
  A single-draw L-44 baseline therefore inflates and scrambles fold-changes. A median of three draws is
  robust to it.
- With the median baseline: IL-6 is up in 4/4 and above all pre-flight values in 4/4; IL-1b is mixed
  (2 up, 2 down); TNFa is up in 4/4 but only +6 to +30 % and beyond own range in 2/4.
- So the guide is right for IL-1b, roughly right for TNFa, and too pessimistic for IL-6.
  The honest wording: **direction is shared, magnitude is individual.** Only two of four crew reach the
  "clear" zone of our index at R+1 (§5.1).

### 1.4 Urine (OSD-656) — non-invasive proxy tested and rejected

- Only 3 crew have urine at R+1 (C001 has no L-3 and no R+1 sample). No R+194.
- R+1 urine is globally more concentrated than L-3 (sample-median NPQ higher by 0.3–1.2 log2 units), so raw
  values are confounded by hydration. The file has no creatinine. We normalise by subtracting each
  sample's median NPQ (**ASSUMPTION**).
- After normalisation urine IL-6 changes by +0.76, -0.09, +1.75 log2 (beyond own range in 1/3), urine CCL2
  (= MCP-1) is beyond range in 0/3, urine IL-10 goes down in 3/3. Within-person rank correlation of serum vs
  urine IL-6 is +1.0, -0.09, -0.6, +0.49 across the four crew.
- Three urine proteins (CXCL8, IL-36A, MPO) are above own range in 3/3, which equals the chance expectation
  (176 analytes x 1/64 = 2.8).

**Decision: no urine proxy.** The data do not support it. We show this as a negative result.

### 1.5 Data-quality defects found (all handled in code)

| ID | Defect | Evidence | Handling |
|---|---|---|---|
| QC-1 | CBC row C003 L-92 has shifted columns | absolute counts do not equal percent x WBC | rebuild 5 absolute counts from percents; null MCH, MCHC, MPV, platelets, RDW for that row |
| QC-2 | Glucose 44, 36, 43 mg/dL in three crew at R+45 (C004 potassium 5.9) | implausible in three people at once; serum was shipped at room temperature (OSD-575 protocol) | drop glucose when < 50 mg/dL in >= 2 crew at one timepoint (**ASSUMPTION**: pre-analytical artefact) |
| QC-3 | Haptoglobin = 17,907,000 repeated 7 times | upper quantification ceiling | analyte excluded |
| QC-4 | L-44 low batch in multiplex panels | §1.3 | median baseline; range-based scale is conservative |
| QC-5 | Urine header: two blank column names; `il1rl1_percent_normalized_value` holds NPQ | values 2.9–5.7 next to a 90–172 column | only relevant if urine is ever parsed |
| QC-6 | CMP header `alt_max_...`, `ast_max_...` lack `range_`; 22 `NA` cells | header listing | parse `_value` columns only; `NA` = missing |

---

## 2. Concepts considered (Step 2)

Scores 1–5: novelty vs typical teams / scientific defensibility / usefulness far from Earth / 3-minute demo
impact / buildable in <= 8 h.

| # | Concept | Nov | Def | Use | Demo | Build | Sum | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | Signature fingerprint vs Inspiration4 envelope | 2 | 4 | 3 | 4 | 5 | 18 | keep as the visual |
| 2 | Recovery ETA | 3 | 2 | 4 | 4 | 4 | 17 | keep, reduced to upper bounds + a re-test rule |
| 3 | Daily-signal nowcast / smart draw scheduling | 5 | 2 | 5 | 4 | 3 | 19 | keep as a labelled protocol, not a validated model |
| 4 | Direction consistency / leave-one-crew-out | 3 | 5 | 2 | 3 | 5 | 18 | keep as the evidence card |
| 5 | Urine non-invasive proxy | 4 | 1 | 4 | 2 | 3 | 14 | rejected by the data (§1.4) |
| 6 | Action layer tied to HRP risks | 2 | 3 | 5 | 3 | 5 | 18 | keep, short |
| 7 | **Expected-vs-unexpected triage with a measured noise floor** | 5 | 4 | 5 | 5 | 4 | 23 | **spine** |
| 8 | Data-quality gate (finds real defects in NASA files) | 4 | 5 | 3 | 4 | 5 | 21 | keep |
| 9 | Number-grounded Cosmo (LLM cannot say a number that code did not compute) | 3 | 5 | 4 | 3 | 4 | 19 | keep |

Why 7 + 1 + 4 + 8 (+ reduced 2, 3, 6, 9) wins:

1. Many teams will plot OSD-569 and average cytokine z-scores. None of that tells an astronaut what to do.
2. The same six-marker pattern appears at R+1 (flight) and again in C002 at R+45 and C003 at R+194 with no
   flight. So the pattern is a general innate-activation pattern; mission phase gives it meaning.
3. That turns the reference data into a decision: inside the transition window = expected, outside = act.
4. Two real "second events" in the NASA data make a demo no other team has.
5. With three baseline draws the index is noisy. Measuring that noise and saying it out loud is the answer
   to "how sure are we", and it is cheap to build.
6. The QC gate shows we read the data more carefully than a plot would.
7. Recovery timing cannot be estimated from one 44-day gap, so we give upper bounds and a re-test rule that
   would close the gap. The limitation becomes the protocol.
8. Draw scheduling from daily KPIs is the most useful idea for deep space, but no NASA file here links daily
   KPIs to labs, so it ships as an explicit protocol with labelled assumptions.
9. Everything is simple arithmetic that fits in one TypeScript module and one JSON fixture.
10. Scope: one engine, two Cosmo tools, four cards, one scripted demo.

---

## 3. Data pipeline

Files are found by name fragment anywhere under `data/`.

| Key | File name contains | Columns used | Unit |
|---|---|---|---|
| cbc | `CBC` | `monocytes_value_percent`; for QC and context: `white_blood_cell_count_value_...`, the five `*_value_percent` differentials, the five `absolute_*_value_...` | %, cells/uL |
| cmp | `Metabolic_Panel` | `glucose_value_milligram_per_deciliter` (+ `potassium_value_...` for display) | mg/dL |
| immune | `serum_immune` | `il_6_`, `mcp_1_`, `il_10_`, `il_27_`, `il_8_` + `concentration_picogram_per_milliliter` | pg/mL |
| cardio | `cardiovascular` | `crp_concentration_picogram_per_milliliter` (context only; pg/mL / 1e6 = mg/L) | pg/mL |
| urine | `urine_immune` | not used by the engine | NPQ (log2) |

Parsing rules:

- Files have a UTF-8 BOM. First column is `Sample Name`; split on `_`: part 0 = crew, part 2 = timepoint
  (`C001_whole-blood_R+1_cbc`, `C001_serum_R+1`).
- CBC/CMP: use columns matching `^(.+?)_value(_.+)?$`. Multiplex: columns matching `^(.+)_concentration_.+$`.
  Ignore `*_percent` columns in the multiplex files (they are values relative to the crew pre-flight mean,
  per the OSD-575 protocol text).
- A cell that does not parse as a number (`NA`, empty) is missing.
- Timepoint to mission day: L-92 = -92, L-44 = -44, L-3 = -3, R+1 = 1, R+45 = 45, R+82 = 82, R+194 = 194.
- Apply QC-1 and QC-2 after loading and store every change in a `qcLog` (shown in the UI).
- Missing signature marker: leave it out and renormalise weights. Fewer than 2 core markers or fewer than 2
  baseline draws: class `INSUFFICIENT`.

---

## 4. Formulas

Notation: crew member `c`, marker `m`, panel time `t`, value `x`.

### 4.1 Personal baseline and deviation

```
b(c,m)   = median of c's pre-flight values of m          (2 values: their mean)
d(c,m,t) = ln( x(c,m,t) / b(c,m) )                       log-ratio; used for every marker
```

Log-ratio because concentrations are right-skewed and effects are multiplicative; it also makes a doubling
and a halving symmetric. Requires x > 0 and b > 0.

### 4.2 Scale ("normal wobble") and z

Three baseline draws are too few for a personal SD or MAD (the MAD of three points can be near zero:
C003 IL-6 pre-flight is 2.67, 2.69, 2.51). So the scale is pooled across the reference crew:

```
r(c,m) = ln(max pre-flight) - ln(min pre-flight)         for each reference crew member with 3 draws
s(m)   = max( median over crew of r(c,m) / 1.693 , ln 1.10 )
z(c,m,t) = d(c,m,t) / s(m)
```

- 1.693 = expected range of 3 normal draws in SD units (control-chart constant d2; our simulation gives 1.692).
- Median over crew: robust to one odd person. Floor ln 1.10: **ASSUMPTION** (assay imprecision).
- Fixture values of s(m): IL-6 0.1592, MCP-1 0.2694, IL-10 0.4436, IL-27 0.2091, glucose 0.1185,
  monocytes % 0.1056. One z-unit of IL-6 is a factor e^0.1592 = 1.17.
- The L-44 low batch widens pre-flight ranges, so s(m) is too large rather than too small: z is conservative.
- For a future astronaut with >= 5 baseline draws use a personal scale instead (not built now).

### 4.3 Signature selection rule

Applied to every analyte with three pre-flight draws and an R+1 value in all reference crew (106 candidates
after QC and exclusions):

1. same direction against the personal median in all crew;
2. at least 10 % change in every crew member (|d| >= ln 1.10);
3. **core**: R+1 beyond own pre-flight range on that side in all crew; **supporting**: in all but one.

Result: core = IL-6, MCP-1, IL-10 (all up); supporting = IL-27, glucose, monocytes % (all up).

Chance check for the core rule. If a fourth draw were exchangeable with the three baseline draws, it would be
the highest of the four with probability 1/4, so all four crew on the same side has probability
2 x (1/4)^4 = 1/128 per analyte, about 0.83 expected among 106; we observe 3 (4 before the 10 % rule: MCV is
below range in 4/4 but moves only 3-6 %). If L-44 is treated as uninformative the expectation rises to about 2.6. So the count
alone is suggestive, not proof; the agreement with ref. [4] is what makes the triad credible.
The thresholds were chosen while looking at these four people. §8.2 measures how much that flatters us.

### 4.4 Flight Response Index (FRI), 0–100

```
q(m)  = clip( z(c,m,t), 0, 4 ) / 4                all six markers are "up" markers
FRI   = 100 x sum( w(m) x q(m) ) / sum( w(m) )    over available markers
w     = 1.0 core, 0.5 supporting
```

- Only movement in the signature direction counts; a marker below baseline contributes 0.
- Cap 4: **ASSUMPTION** (four wobble-units = full response; stops one marker from dominating).
- Weights are evidence tiers, not fitted. Four people cannot support fitted weights.
- Worked example, C003 at R+1 (fixture): z = IL-6 6.570, MCP-1 3.866, IL-10 0.698, monocytes 3.066,
  glucose 2.676, IL-27 1.213 -> q = 1.000, 0.967, 0.174, 0.767, 0.669, 0.303 ->
  FRI = 100 x (1.000 + 0.967 + 0.174 + 0.5 x (0.767 + 0.669 + 0.303)) / 4.5 = 66.9.

### 4.5 Uncertainty band

Dominant uncertainty = only three baseline draws. Recompute FRI four times: with the full baseline and with
each pre-flight draw removed. Band = [min, max] of the four values. C003 R+1: 66.9 [65.1–68.2];
C004 R+1: 36.0 [33.2–55.0].

### 4.6 Noise floor and zones

Score each pre-flight draw as if it were a new panel, against the other two draws (12 control panels, no
spaceflight involved): sorted FRI = 0.0, 1.2, 4.4, 6.0, 7.8, 7.9, 9.0, 9.3, 18.1, 18.9, 36.5, 37.4
(median 8.4, 75th percentile 18.5, max 37.4). These controls use a 2-draw baseline, so they are slightly
noisier than real panels.

```
FRI < 20          BASELINE        (75th percentile of controls = 18.5)
20 <= FRI < 40    INDETERMINATE   (2 of 12 controls scored 36–37 with no flight)
FRI >= 40         CLEAR           (above every control)
```

### 4.7 Triage class

```
days = days since the last gravity transition (launch, landing; later: surface EVA)   WINDOW = 7 d  ASSUMPTION
INSUFFICIENT              fewer than 2 core markers or fewer than 2 baseline draws
BASELINE                  FRI < 20
INDETERMINATE             20 <= FRI < 40
EXPECTED_FLIGHT_RESPONSE  FRI >= 40 and days <= 7
UNEXPECTED_ACTIVATION     FRI >= 40 and days > 7
```

If the band contains 20 or 40 (band low < T <= band high) the UI and Cosmo add the word "borderline".
Nine of the 16 real panels are borderline, which is itself a fair picture of what three baseline draws allow.

### 4.8 Recovery bound, ETA and re-test rule

Inspiration4 has no sample between day 1 and day 45, so recovery time cannot be estimated, only bounded.
Assume exponential decay of FRI (**ASSUMPTION**, simplest one-parameter model):

```
T_half <= dt x ln 2 / ln( FRI_a / FRI_b )      two panels dt days apart, FRI_b < FRI_a
```

R+1 -> R+45 (dt = 44): C001 48.2 -> 1.1 gives <= 8.07 d; C003 66.9 -> 12.2 gives <= 17.92 d;
C004 36.0 -> 8.7 gives <= 21.47 d; C002 rose (36.9 -> 53.4), which is not a recovery.
Reference band for T_half: [8.07, 21.47] d. For an Inspiration4 crew member in the demo, leave their own
value out (C003: [8.07, 21.47]; C001: [17.92, 21.47]).

```
L        = log2( FRI_0 / 20 )
ETA band = [ T_fast x L , T_slow x L ] days after the panel      (time to re-enter the BASELINE zone)
re-test  = clip( ceil( T_fast x L ), 3, 21 ) days after the panel     clip limits: ASSUMPTION
```

Re-testing at the fast edge is the most informative draw: if FRI is already < 20 the fast hypothesis is
confirmed; if not, compute the personal T_half from the two panels and reschedule; if FRI did not fall, the
class becomes UNEXPECTED_ACTIVATION. C003: L = 1.742, ETA 14.1–37.4 d, first re-test 15 days after the panel.

Wording rule: say "back in the baseline zone by the next sample at day 45 in 3 of 4 crew", never
"recovers in 45 days". The bounds are upper bounds; true recovery may be much faster.

### 4.9 Daily Strain Score (DSS) from Cosmo check-ins — protocol, not validated

No NASA file here links daily KPIs to blood markers. This is an operational rule set with labelled
assumptions; the demo uses simulated check-ins and says so on screen.

```
KPIs k: sleep_hours (lower is worse), sleep_quality (lower), resting_hr (higher), fatigue (higher), mood (lower)
m_k = median of the previous <= 14 days (need >= 5 days)
s_k = max( 1.4826 x MAD , floor_k )      floors: 0.5 h, 0.5 pt, 3 bpm, 0.5 pt, 0.5 pt   ASSUMPTION
z_k = direction_k x ( today - m_k ) / s_k                positive = worse
DSS = 100 x mean_k( clip( z_k, 0, 3 ) / 3 )
```

Test vector (fixture): 14 calm days then sleep 5.0 h, quality 2, HR 66, fatigue 4, mood 3 gives DSS = 90.0;
a calm day gives 0.0.

### 4.10 Draw advisor (first matching rule wins) — all thresholds ASSUMPTION, in one config file

| Rule | Condition | Advice |
|---|---|---|
| A1 RETEST_DUE | a re-test date from §4.8 or A5 is today or past | draw today |
| A2 STRAIN_TRIGGER | DSS >= 50 on 3 consecutive days and last panel >= 7 days ago | draw recommended |
| A3 ROUTINE_SKIP | last panel >= 30 days ago, last class BASELINE, DSS < 25 on each of the last 7 days | skip, re-check in 7 days, kit saved |
| A4 ROUTINE_DUE | last panel >= 30 days ago | draw |
| A5 (on import) | new panel is UNEXPECTED_ACTIVATION | set re-test in 3 days + symptom check |
| A6 | otherwise | no draw needed |

Kit budget: `kitsTotal` (default 8), minus one per imported panel; "kits saved" counts A3 skips.

---

## 5. Results on the real data

### 5.1 FRI for all 16 post-flight panels (fixture)

| Crew | R+1 | R+45 | R+82 | R+194 |
|---|---|---|---|---|
| C001 | 48.2 [39.7–60.4] EXPECTED | 1.1 [0.7–2.8] BASELINE | 14.2 [13.2–21.4] BASELINE | 17.5 [4.1–22.3] BASELINE |
| C002 | 36.9 [32.6–46.4] INDETERMINATE | **53.4 [49.7–62.0] UNEXPECTED** | 18.2 [13.8–27.6] BASELINE | 13.3 [11.0–13.8] BASELINE |
| C003 | **66.9 [65.1–68.2] EXPECTED** | 12.2 [11.6–14.2] BASELINE | 30.0 [30.0–34.9] INDETERMINATE | 56.6 [56.6–57.4] UNEXPECTED |
| C004 | 36.0 [33.2–55.0] INDETERMINATE | 8.7 [8.7–20.4] BASELINE | 35.2 [34.6–48.1] INDETERMINATE | 10.7 [10.7–27.2] BASELINE |

Reading it honestly:

- R+1 is the highest of a person's four post-flight panels in 3 of 4 crew. The exception, C002 at R+45, comes
  with IL-8 at 910 pg/mL against a baseline of 19.35 (47x): a separate event.
- Only 2 of 4 crew are CLEAR at R+1, and one of those (C001, band 39.7–60.4) is borderline. C002 and C004
  have the right direction on every core marker but a magnitude inside the control range. That is the "individual-specific" finding, quantified.
- C003 at R+194 scores 56.6 six months after landing. The index detects a pattern, not its cause.
- C001 at R+82 has a broad cytokine surge (TNFa 9.8x baseline) while FRI is 14.2: FRI is specific to the
  IL-6/MCP-1 axis and blind to other patterns. The UI therefore lists other large excursions (§7.2) as
  information.

---

## 6. Code vs LLM

| Computed in code (TypeScript, deterministic, unit-tested) | Phrased by the LLM |
|---|---|
| parsing, QC, baselines, s(m), z, envelope flag | wording, order, tone, language (MN / EN) |
| FRI, band, zone, triage class, "borderline" | nothing numeric |
| half-life bound, ETA band, re-test date | |
| DSS, draw-advisor rule ID, kit counts | |
| evidence statistics (from the fixture) | |
| action list (from a lookup table keyed by class) | choosing which 1–2 actions to voice first |

Mechanism: the tool returns a `facts` JSON. The system prompt says: use only numbers present in `facts`,
round as given, end with the action and the disclaimer. A post-check (`assertNumbersGrounded`) extracts every
number from the LLM text and verifies each is in `facts.allowedNumbers`; on failure the deterministic
template is used instead. Offline demo mode always uses the template.

---

## 7. Product surface

### 7.1 Cosmo dialogue

Rules: calm, friendly, professional; at most five sentences before the action; one action; last sentence is
the disclaimer. Numbers below are fixture values for C003 and C002.

**(a) New lab panel arrives — C003, R+1, class EXPECTED_FLIGHT_RESPONSE**

EN: "Your new blood panel is in. The six markers I compare with your own pre-flight values show a clear
flight-response pattern: Flight Response Index 67 out of 100, range 65 to 68. IL-6 and MCP-1 are about
2.8 times your baseline. All four Inspiration4 crew moved in this direction one day after landing, so this is
the expected picture, not a new problem. Three of the four were back in their baseline zone by the next
sample at day 45. My suggestion: normal fluids and a full night's sleep, no extra draw this week, and a
re-test in 15 days. Tell me if you notice fever, a sore throat or a rash before then. Decision support, not a
diagnosis."

MN: "Таны цусны шинэ шинжилгээ ирлээ. Нислэгийн өмнөх өөрийн тань түвшинтэй харьцуулдаг зургаан үзүүлэлт
нислэгийн дараах хариу урвалын хэв маягийг тод харуулж байна: Нислэгийн хариу урвалын индекс 100-аас 67,
хэлбэлзэл нь 65-аас 68. IL-6 болон MCP-1 таны суурь түвшнээс ойролцоогоор 2.8 дахин өндөр байна.
Inspiration4-ийн дөрвөн гишүүнд газардсаны маргааш мөн ийм чиглэлийн өөрчлөлт гарсан тул энэ бол хүлээгдэж
буй дүр зураг, шинэ асуудал биш. Тэдний дөрвөөс гурвынх нь 45 дахь өдрийн дараагийн шинжилгээгээр суурь
түвшиндээ буцсан байсан. Миний санал: шингэнээ хэвийн ууж, шөнөдөө бүтэн унтаарай. Энэ долоо хоногт нэмэлт
цус авах шаардлагагүй, 15 хоногийн дараа давтан шинжилгээ өгье. Тэр хүртэл халуурах, хоолой өвдөх, арьсанд
тууралт гарах шинж илэрвэл надад хэлээрэй. Энэ бол шийдвэр гаргахад туслах мэдээлэл, онош биш."

**(b) Daily check-in suggests a blood draw — rule A2 (simulated check-ins)**

EN: "Thanks, that's today's check-in logged. One thing I noticed: your strain score has been above 50 for
three days in a row. You slept about 5 hours and your resting heart rate is 8 beats above your usual. Your
last blood panel was 9 days ago. This is the kind of moment where a draw is worth a kit; you have 5 of 8
left. Shall I plan it for tomorrow morning before breakfast? Decision support, not a diagnosis."

MN: "Баярлалаа, өнөөдрийн хэмжилтүүдийг бүртгэлээ. Нэг зүйл анзаарлаа: таны ачааллын оноо гурван өдөр
дараалан 50-аас дээш байна. Та 5 орчим цаг унтсан, амралтын үеийн зүрхний цохилт тань ердийнхөөсөө 8-аар
өндөр байна. Сүүлийн цусны шинжилгээнээс хойш 9 хоног өнгөрчээ. Яг ийм үед цус авах нь нэг багцыг зарцуулах
үнэ цэнтэй. Танд 8-аас 5 багц үлдсэн байна. Маргааш өглөө өглөөний цайны өмнө авахаар төлөвлөх үү? Энэ бол
шийдвэр гаргахад туслах мэдээлэл, онош биш."

**(c1) Recovery progress — C003, R+45, class BASELINE**

EN: "Good news from your re-test. Your index is 12, down from 67, so these markers are back in your baseline
zone. IL-6 is now about half of your pre-flight baseline. That matches what three of the four Inspiration4
crew showed by day 45. One note: the glucose value in this sample failed a quality check and was left out.
No further draw is needed for this episode. Decision support, not a diagnosis."

MN: "Давтан шинжилгээний мэдээ сайн байна. Таны индекс 67-оос 12 болж буурсан тул эдгээр үзүүлэлт суурь
түвшиндээ буцжээ. IL-6 одоо нислэгийн өмнөх суурь түвшний тань тал орчим байна. Энэ нь Inspiration4-ийн
дөрвөн гишүүний гуравт нь 45 дахь өдөр ажиглагдсантай таарч байна. Нэг тэмдэглэл: энэ дээжийн глюкозын утга
чанарын шалгалтад тэнцээгүй тул тооцоонд оруулаагүй. Энэ удаагийн хувьд дахин цус авах шаардлагагүй. Энэ бол
шийдвэр гаргахад туслах мэдээлэл, онош биш."

**(c2) Off-trajectory — C002, R+45, class UNEXPECTED_ACTIVATION**

EN: "This is not the recovery I expected. Your index went up from 37 to 53, and we are 45 days past landing,
outside the flight window. IL-6 is 2.7 times your baseline and IL-8 is 47 times. Blood markers cannot tell me
the cause. Let's do a quick symptom check and take your temperature now, and I recommend a re-test in 3 days
and a note to the flight surgeon at the next contact. Decision support, not a diagnosis."

MN: "Энэ бол миний хүлээж байсан сэргэлт биш байна. Таны индекс 37-оос 53 болж өссөн, газардсанаас хойш 45
хоног өнгөрсөн тул нислэгийн нөлөөний хугацаанаас гадуур байна. IL-6 таны суурь түвшнээс 2.7 дахин, IL-8 нь
47 дахин өндөр байна. Шалтгааныг цусны үзүүлэлтээр тодорхойлох боломжгүй. Одоо шинж тэмдгээ хамт шалгаад
биеийн температураа хэмжье. 3 хоногийн дараа давтан шинжилгээ өгч, дараагийн холболтоор нислэгийн эмчид
мэдэгдэхийг зөвлөж байна. Энэ бол шийдвэр гаргахад туслах мэдээлэл, онош биш."

### 7.2 UI (light clinical theme, shadcn/ui + Recharts)

Route: a "Signature" tab on the crew dashboard. Four cards, 2 x 2 on desktop, stacked on mobile.

1. **Triage card** (hero). A horizontal 0–100 track with three zones (0–20 slate, 20–40 amber tint,
   40–100 teal tint when EXPECTED / red tint when UNEXPECTED); a dot at FRI, a whisker for the band. Class
   badge, one-line reason ("day 1 after landing: inside the flight window"), panel date. Popover
   "How sure are we?": the 12 control scores as a strip plot, text "2 of 12 no-flight controls scored 36–37".
   Timepoint selector (segmented control) switches the panel for the whole tab.
2. **Fingerprint card.** Recharts horizontal `BarChart`, one row per marker (IL-6, MCP-1, IL-10, IL-27,
   glucose, monocytes %), bar = z clipped to [-4, 4], core bars solid, supporting bars lighter. Behind each
   bar a grey range = min–max z of the other three Inspiration4 crew at R+1 ("Inspiration4 envelope").
   Tooltip: value + unit, own baseline, fold, "above all your pre-flight values" yes/no. Clicking a row opens
   the existing analyte drawer (line chart over the 7 timepoints). Below: "Other large changes" — up to 3
   analytes with fold >= 3 or <= 1/3 and beyond own range, labelled "information only".
3. **Recovery & next draw card.** Recharts `ComposedChart`: FRI points with band error bars over mission
   day; dashed threshold at 20; after the last EXPECTED panel two decay curves (fast and slow half-life)
   shaded between; vertical marker at the recommended re-test day. Right side: draw advisor result with rule
   ID (A1–A6), DSS sparkline (14 days), kit chips ("5 of 8 left", "1 saved"). Caption: "Upper bounds from 3
   crew; Inspiration4 has no sample between day 1 and day 45."
4. **Evidence card** ("Why trust this — and where not to"). Table of the six markers: direction 4/4, beyond
   own range k/4, selected in 4/4 leave-one-out folds, in Kim et al. 2024 (yes / not covered). Three headline
   numbers (§8). Collapsible lists: "Tested and rejected" (lymphocytes, CRP, urine proxy) and "Data-quality
   log" (QC-1..QC-4 with old -> new values). Footer: sources with DOIs; "n = 4, descriptive only".

Interactions: timepoint selector; crew switch; "Explain" button on each card makes Cosmo speak the matching
template; demo-mode banner when simulated data is on screen.

### 7.3 Action table (lookup, keyed by class)

| Class | Actions shown | HRP link |
|---|---|---|
| BASELINE | none; next routine check per advisor | — |
| INDETERMINATE | no extra draw; keep sleep and fluids regular; look again at next panel | Sleep risk [7] |
| EXPECTED_FLIGHT_RESPONSE | rest, fluids, sleep; no extra draw before the re-test date; report fever, sore throat, rash, cold sores | Immune risk [6] (latent virus reactivation is documented in crew) |
| UNEXPECTED_ACTIVATION | symptom checklist now; temperature; re-test in 3 days; notify flight surgeon at next contact | Immune risk [6] |

The action wording is general wellness and reporting guidance (**ASSUMPTION**, to be replaced by flight-surgeon
protocol); none of it is a treatment.

---

## 8. Validation to show judges

1. **Direction consistency.** Core triad: same direction and above every pre-flight value in 4/4 crew.
   Supporting three: same direction 4/4, beyond own range 3/4. Chance expectation for the core rule: about
   0.83 of 106 analytes (2.6 if L-44 is discounted); observed 3.
2. **Leave-one-crew-out.** Re-run the selection rule on three crew, test on the fourth, four times.
   All six markers are selected in 4 of 4 folds. Of 36 marker selections, the held-out person moved >= 10 %
   in the predicted direction in 24 (67 %) and beyond their own range in 21 (58 %; chance 25 %).
   Held-out FRI at R+1: 39.5, 21.2, 38.8, 36.1 — lower than the in-sample values (48.2, 36.9, 66.9, 36.0),
   which is the size of our optimism.
3. **Noise floor.** 12 no-flight control panels: median 8.4, max 37.4. Hence the 20 / 40 zones.
4. **Second assay (see addendum).** The published analysis of the same crew lists the same cytokines as
   increased at R+1 (ref. [4]), but that is not independent replication. The independent check is the
   second serum platform in OSD-575: it confirms IL-6 (same direction in 4/4, agreement 0.65) and does not
   confirm MCP-1, IL-10 or IL-27.
4b. **Different mission, same direction (n = 1).** In the NASA Twins Study (one astronaut, one year on the
   ISS), IL-6, IL-10, CCL2/MCP-1, IL-1ra and CRP rose on landing against pre-flight means and were back at
   pre-flight levels by R+60 (ref. [9]). The authors read this landing signature as a response to gravity
   and muscle reloading rather than a purely detrimental inflammation, which is the reading behind our class
   name EXPECTED_FLIGHT_RESPONSE. Limits: one person, a one-year mission, and an assay we did not compare
   with ours. It supports the direction of the core triad, not the thresholds. CRP rose there but stayed
   inside the own pre-flight range in 3 of 4 Inspiration4 crew, so CRP is still not a marker.
5. **Negative results kept in view.** Lymphocyte "suppression" (2/4 against the median), CRP (inside own
   range in 3/4), urine proxy (1/3), and FRI's blindness to the C001 R+82 event.

Limitations (say them in the pitch): n = 4; 3-day low-Earth-orbit flight; private astronauts; all samples
taken on the ground, none in flight; R+1 mixes spaceflight with landing and re-adaptation; three baseline
draws; one batch-shifted baseline draw; no sample between day 1 and day 45; fasting state unknown; multiplex
research assays, not clinical tests; thresholds chosen on the same four people; daily-KPI rules unvalidated.
Not evidence for long-duration missions.

### 8.1 In-space measurability (decision D-SPACE)

Every number in the signature comes from ground laboratories: multiplex serum cytokine panels, a chemistry
panel and a hematology analyzer, run on blood drawn on the ground before and after flight (§1). Cosmo does
not claim that the six markers can be measured on orbit today. What is established:

- **White-cell count and differential (our monocyte % marker).** A fingerstick analyzer (HemoCue WBC DIFF)
  was flown to the ISS as a technology demonstration in December 2020 – January 2021; NASA described
  white-cell counting as a capability it did not have operationally in space (refs. [10], [11]).
- **Flow cytometry.** A miniature cytometer (rHEALTH ONE) was demonstrated on the ISS in May 2022 on prepared
  test samples, as a test bed for a later instrument (refs. [11], [12]). The same NASA report states that
  blood samples on the ISS are still collected and returned to Earth for testing (ref. [12]).
- **IL-6, MCP-1, IL-10, IL-27.** We found no demonstrated in-flight assay for these four. In-flight glucose
  and CRP testing were not checked and are not claimed.

Consequence: Cosmo scores a panel when one exists (returned sample, or a future on-board analyzer). For
flight it is the software layer such an analyzer would feed. The daily check-in is the part that needs no
laboratory.

Fixed wording. Cosmo and the pitch never say "measures in orbit". When asked whether this can be measured in
space, Cosmo answers with these statements only (no numbers; the LLM may shorten but not add):

| # | English | Mongolian |
|---|---|---|
| S1 | Everything I score comes from blood panels analysed in laboratories on Earth. I do not measure anything in orbit myself. | Миний оноо өгдөг бүх тоо дэлхий дээрх лабораторид шинжилсэн цусны хариунаас гардаг. Би өөрөө тойрог замд юу ч хэмждэггүй. |
| S2 | A fingerstick white-cell counter and a small flow cytometer have each been tried on the International Space Station, as technology demonstrations, not as routine crew monitoring. | Хурууны үзүүрийн цусаар цагаан эс тоолох төхөөрөмж болон жижиг урсгалын цитометрийг Олон улсын сансрын станц дээр туршсан. Энэ нь технологийн туршилт байсан, багийн байнгын хяналт биш. |
| S3 | I know of no demonstrated in-flight test for IL-6, MCP-1, IL-10 or IL-27. So today I score a panel when one exists, and the daily check-in is the part that needs no laboratory. | IL-6, MCP-1, IL-10, IL-27-г нислэгийн үеэр хэмжсэн туршилтыг би мэдэхгүй. Тиймээс одоогоор шинжилгээний хариу байгаа үед л оноо өгнө. Өдөр тутмын асуулга бол лаборатори шаарддаггүй хэсэг. |

---

## 9. Three-minute demo script (offline scripted mode)

| Time | Screen | Cosmo says / presenter does |
|---|---|---|
| 0:00–0:20 | Crew select -> C003, mission clock R+1, short check-in already done | Presenter: "Far from Earth, a blood draw is rare. The question is not 'what are my numbers' but 'is this the flight, or something new?'" |
| 0:20–1:00 | Triage card animates to 67, badge EXPECTED; fingerprint bars grow inside the grey Inspiration4 envelope | Cosmo speaks (a) in Mongolian, captions in English |
| 1:00–1:25 | Recovery card: decay fan, re-test marker at day 16, "5 of 8 kits" | Presenter: "NASA's data has no sample between day 1 and day 45. So we give an honest upper bound and schedule the one draw that would close that gap." |
| 1:25–1:45 | Clock jumps to R+45, C003: 12, BASELINE; note "glucose removed by quality check" | Cosmo speaks (c1), English |
| 1:45–2:20 | Switch to C002 at R+45: 53, badge UNEXPECTED, IL-8 47x under "Other large changes" | Cosmo speaks (c2). Presenter: "Same pattern, no flight. This is real Inspiration4 data, and no dashboard of averages would have flagged it." |
| 2:20–2:40 | Daily check-in view (banner "simulated check-ins"), DSS above 50 three days, rule A2 | Cosmo speaks (b) |
| 2:40–3:00 | Evidence card: 4/4, leave-one-out 4/4 folds, control max 37.4, "tested and rejected" list, QC log | Presenter: "Four people is not a study. So every claim shows its evidence, and three ideas we tested and dropped are on screen." |

Crew choice: C003 has the clearest R+1 pattern (FRI 66.9, narrow band) and a clean return at R+45; C002
supplies the unexpected event. Do not use C002 or C004 for the R+1 beat: both are INDETERMINATE.

---

## 10. Decisions recorded

1. Baseline = median of three pre-flight draws. L-3 alone and L-44 alone are both misleading.
2. Index markers: IL-6, MCP-1, IL-10 (core), IL-27, glucose, monocytes % (supporting). Lymphocytes and CRP removed.
3. Feature renamed from "Immune-Inflammation Index" to "Signature Triage"; the number is the "Flight Response Index".
4. No "immune suppression", "metabolic stress" or "recovers in 45 days" wording anywhere.
5. No urine protocol.
6. Draw scheduling ships as a protocol with assumptions and a "simulated" banner.
7. No machine learning.
8. The LLM never produces a number.
9. An alert is escalated only when two independent assays agree (addendum).

---

## 11. Sources

Datasets (NASA Open Science Data Repository)

1. OSD-569 — Whole Blood Measurements from the SpaceX Inspiration4 Mission (RNA-seq, epitranscriptome, WGS,
   clonal hematopoiesis, CBC). DOI 10.26030/e0rx-sh52. https://osdr.nasa.gov/bio/repo/data/studies/OSD-569
2. OSD-575 — SpaceX Inspiration4 Blood Serum Metabolic Panel and Immune/Cardiac Cytokine Arrays
   (Comprehensive Metabolic Panel and Multiplex). DOI 10.26030/mc5d-p710.
   https://osdr.nasa.gov/bio/repo/data/studies/OSD-575
3. OSD-656 — SpaceX Inspiration4 Urine Inflammation Panel (Multiplex, NULISAseq). DOI 10.26030/7cax-yj10.
   https://osdr.nasa.gov/bio/repo/data/studies/OSD-656

Papers

4. Kim J. et al. Single-cell multi-ome and immune profiles of the Inspiration4 crew reveal conserved,
   cell-type, and sex-specific responses to spaceflight. Nature Communications 15, 4954 (2024).
   DOI 10.1038/s41467-024-49211-2
5. Overbey E. G. et al. Collection of biospecimens from the Inspiration4 mission establishes the standards
   for the Space Omics and Medical Atlas (SOMA). Nature Communications 15 (2024).
   DOI 10.1038/s41467-024-48806-z

NASA Human Research Program risks (these have no DOI; NASA pages and report numbers are given)

6. Risk of Adverse Health Event Due to Altered Immune Response.
   https://www.nasa.gov/directorates/esdmd/hhp/risk-of-adverse-health-event-due-to-altered-immune-response/
   Evidence report: Crucian B., Sams C. F., NASA JSC, NTRS document 20140002769.
7. Risk of Performance Decrements and Adverse Health Outcomes Resulting from Sleep Loss, Circadian
   Desynchronization, and Work Overload. NASA evidence report, NTRS document 20160003864.

Other missions

9. Gertz M. L. et al. Multi-omic, single-cell, and biochemical profiles of astronauts guide pharmacological
   strategies for returning to gravity. Cell Reports 33(10), 108429 (2020).
   DOI 10.1016/j.celrep.2020.108429

In-space measurement (technology demonstrations)

10. Perusek G. P. et al. HemoCue ISS Tech Demo - Results and Lessons Learned. NASA Human Research Program
    Investigators' Workshop 2022. NTRS document 20210026808. https://ntrs.nasa.gov/citations/20210026808
11. ISS Technology Demonstrations for Future Spaceflight Medical Systems. ISS Research and Development
    Conference 2024. NTRS document 20240004905.
12. rHEALTH ONE Demonstration Aboard ISS. NASA Human Research Program Investigators' Workshop 2023.
    NTRS document 20230001079. https://ntrs.nasa.gov/citations/20230001079
    Peer-reviewed report: Rea D. J. et al. Single drop cytometry onboard the International Space Station.
    Nature Communications (2024). DOI 10.1038/s41467-024-46483-6

Other

8. Torchlight Biosovereignty Hackathon 2026, Inspiration4 guide ("Immune & Inflammatory Response" page):
   https://torchlight-summit.pages.dev/narrative/immune/ — used only for the claim discussed in §1.3.
