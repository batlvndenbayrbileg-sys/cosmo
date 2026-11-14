# Claude Code prompt — build "Signature Triage" (for Sonnet 5.5)

> Entry point is `docs/PROMPT_SIGNATURE_INTEGRATE.md`. This file holds the task definitions and test numbers.

Run inside the AEGIS repo after Phase 1 (Cosmo check-in) and Phase 1B (Blood Panel) work.
Before starting, make sure these exist:

- `data/` with the five NASA CSV files (any sub-folder is fine; files are found by name fragment);
- `docs/SIGNATURE_SPEC.md`;
- `docs/signature_reference/reference_engine.py` and `docs/signature_reference/expected_values.json`;
- `docs/SIGNATURE_ADDENDUM_SECOND_ASSAY.md`, `docs/signature_reference/reference_second_assay.py`,
  `docs/signature_reference/expected_second_assay.json`, and the sixth CSV
  `data/OSD-575_LSDS-8_Alamar_NULISA_serum_TRANSFORMED.csv`.

Paste everything below the line.

---

You are implementing one feature of **AEGIS** (NASA Space Apps 2026, astronaut health monitoring):
**Signature Triage**. The design is finished and lives in `docs/SIGNATURE_SPEC.md`. Your job is to implement
it exactly. Do not redesign, rename or "improve" formulas. Budget: 8 hours, tasks of at most 45 minutes.

## Ground rules

1. Read first, in this order: `CLAUDE.md`, `docs/SIGNATURE_SPEC.md` (all of it), `docs/SIGNATURE_ADDENDUM_SECOND_ASSAY.md`, `prisma/schema.prisma`,
   the Phase 1B lab importer and lab engine, the Cosmo agent tool definitions.
   Reuse existing names, tables, i18n dictionary and UI primitives. Keep Phase 1 and 1B working.
2. `docs/signature_reference/expected_values.json` (the **fixture**) is the source of truth for numbers.
   The Python file next to it is the reference implementation: port its logic, do not reinterpret it.
   Never edit the fixture by hand. If your result disagrees with the fixture, your code is wrong.
3. All maths is deterministic TypeScript with unit tests. The LLM never computes or invents a number.
4. Tolerances for tests: FRI and band +-0.05; z +-0.01; scales +-0.0005; half-life +-0.3 d; percentages +-0.1.
5. Every threshold marked ASSUMPTION in the spec goes into `src/lib/signature/config.ts`, nowhere else.
6. Forbidden wording in UI and Cosmo text: "immune suppression", "metabolic stress", "recovers in 45 days",
   "diagnosis" (except in the fixed line "Decision support, not a diagnosis."), "normal"/"abnormal" as a verdict.
7. Commit after each task with the task ID in the message. Keep `main` runnable. Ask nothing; if something in
   the repo differs from what this prompt assumes, adapt and write one line in `docs/SIGNATURE_BUILD_NOTES.md`.
8. Order: T0–T8, then T11–T13, T14, then T9, T10. Stop after T10. Do not add features.

## Target layout (adapt paths to the repo's conventions)

```
src/lib/signature/config.ts        constants + thresholds
src/lib/signature/load.ts          CSV parsing + QC  -> LabMatrix, qcLog
src/lib/signature/engine.ts        baseline, scale, z, envelope, selectSignature, fri, friBand, classify
src/lib/signature/recovery.ts      halfLifeBound, etaDays
src/lib/signature/strain.ts        dailyStrain, drawAdvice
src/lib/signature/facts.ts         buildFacts, assertNumbersGrounded, templates (mn, en)
src/lib/signature/reference.ts     typed loader for the fixture (evidence, noise floor, LOCO)
src/data/signature_reference.json  copy of docs/signature_reference/expected_values.json
src/components/signature/*         4 cards
tests/signature/*.test.ts
```

Core types:

```ts
type Timepoint = 'L-92'|'L-44'|'L-3'|'R+1'|'R+45'|'R+82'|'R+194';
type MarkerKey = `${'cbc'|'cmp'|'cardio'|'immune'}:${string}`;      // e.g. 'immune:il_6'
type LabMatrix = Record<MarkerKey, Record<string /*crew*/, Partial<Record<Timepoint, number>>>>;
type TriageClass = 'INSUFFICIENT'|'BASELINE'|'INDETERMINATE'|'EXPECTED_FLIGHT_RESPONSE'|'UNEXPECTED_ACTIVATION';
interface MarkerResult { tier:'core'|'supporting'; value:number; baseline:number; fold:number; z:number; q:number; weight:number; envelope:'hi'|'in'|'lo' }
interface PanelResult { crew:string; timepoint:Timepoint; missionDay:number; fri:number|null; band:[number,number]|null;
  cls:TriageClass; borderline:boolean; markers:Record<string,MarkerResult>; otherLargeChanges:{analyte:string; fold:number}[] }
```

Constants (`config.ts`): `D2_N3 = 1.693`, `S_FLOOR = ln(1.10)`, `MIN_EFFECT = ln(1.10)`, `Z_CAP = 4`,
`W_CORE = 1`, `W_SUPP = 0.5`, `T_LOW = 20`, `T_HIGH = 40`, `WINDOW_DAYS = 7`, `RETEST_MIN = 3`, `RETEST_MAX = 21`,
`UNEXPECTED_RETEST_DAYS = 3`, `DSS_TRIGGER = 50`, `DSS_TRIGGER_DAYS = 3`, `DSS_CALM = 25`, `MIN_DAYS_BETWEEN_DRAWS = 7`,
`ROUTINE_DAYS = 30`, `KITS_TOTAL = 8`, KPI directions and floors from spec §4.9.
Signature (fixed list, also re-derived in a test): core `immune:il_6`, `immune:mcp_1`, `immune:il_10`;
supporting `immune:il_27`, `cmp:glucose`, `cbc:monocytes`.

---

## Tasks

### T0 — Orientation and fixture (20 min)
- Read the files listed in ground rule 1. Copy the fixture to `src/data/signature_reference.json`.
- Add scripts: `pnpm sig:ref` = `python3 docs/signature_reference/reference_engine.py data > /tmp/ref.json`
  (optional helper; tests must not depend on Python).
- Create `config.ts` and the type file.
- **Check:** `pnpm test` still green; fixture imports with types.

### T1 — Loader + QC (45 min)
Extend the Phase 1B importer (or add `load.ts`) to read the CBC, CMP, immune and cardiovascular files per
spec §3 and apply:
- **QC-1**: for each CBC row, for each of the five differentials, compare `absolute_x` with
  `x_percent * WBC * 10`. If any differs by more than 15 %, replace all five absolutes with
  `round(percent * WBC * 10)` and delete `mch`, `mchc`, `mpv`, `platelet_count`, `rdw` for that row.
- **QC-2**: for each timepoint, if glucose < 50 mg/dL in two or more crew, delete those glucose values.
- Exclusions: `cardio:haptoglobin`, `cmp:bun_to_creatinine_ratio`, both `cmp:egfr_*`, CBC basophils and eosinophils (absolute and percent).
- Persist QC changes (`qcLog`) so the UI can show them. Seed stays idempotent.

**Tests**
- 28 rows in each of the four files; crew C001..C004; 7 timepoints each.
- `qcLog` has exactly 12 entries: C003 L-92 absolutes 10.1 -> 6826 (neutrophils), 6826 -> 1997 (lymphocytes),
  1997 -> 614 (monocytes), 614 -> 125 (eosinophils), 125 -> 38 (basophils); C003 L-92 `mchc` 29.6, `mpv` 330,
  `platelet_count` 12.9, `rdw` 32.4 -> null; glucose R+45 removed for C002 (44), C003 (36), C004 (43).
- C001 glucose at R+45 is still 84. `immune:il_6` C003 R+1 = 7.6. `NA` cells are missing, not 0.

### T2 — Baseline, scale, z, envelope (40 min)
Port `pre_vals`, `baseline`, `scale`, `zscore`, `envelope` from the reference file. `scale` is always computed
on the four reference crew (C001..C004), also when scoring someone else.

**Tests**
- scales: il_6 0.1592, mcp_1 0.2694, il_10 0.4436, il_27 0.2091, glucose 0.1185, monocytes 0.1056.
- z at R+1 (C001, C002, C003, C004): il_6 5.47, 1.56, 6.57, 2.94; mcp_1 1.66, 1.87, 3.87, 0.53;
  il_10 1.19, 0.29, 0.70, 0.65; monocytes 1.34, 3.26, 3.07, 1.11; glucose 0.99, 1.20, 2.68, 1.31;
  il_27 1.32, 1.40, 1.21, 2.31.
- % change at R+1 vs own median: il_6 +139.0, +28.3, +184.6, +59.7; glucose +12.5, +15.3, +37.3, +16.9.
- envelope at R+1 is `hi` for il_6, mcp_1, il_10 in all four crew; il_27 is `in` for C003; glucose and
  monocytes are `in` for C004.
- context (not in the index): absolute lymphocytes R+1 vs own median = -26.8, -27.3, +0.1, +20.7 %;
  vs L-3 = -38.5, -46.4, -33.9, -26.9 %; CRP z at R+1 = 0.59, 0.03, 0.54, 0.20.

### T3 — Selection rule, FRI, band, class (45 min)
Port `select_signature`, `fri`, `fri_band`, `classify`. `borderline` = the band contains T_LOW or T_HIGH (rule in the tests below).
"Other large changes": among `immune:*` and `cardio:*` analytes not in the signature and not excluded, those
with fold >= 3 (and above all pre-flight values) or fold <= 1/3 (and below all), sorted by |ln fold|, top 3.

**Tests**
- `selectSignature(matrix, ['C001','C002','C003','C004'])` returns core {il_10, il_6, mcp_1} and supporting
  {monocytes, glucose, il_27}, all direction +1.
- FRI [band] class for all 16 panels:

| Panel | FRI | Band | Class |
|---|---|---|---|
| C001 R+1 | 48.2 | 39.7–60.4 | EXPECTED_FLIGHT_RESPONSE |
| C001 R+45 | 1.1 | 0.7–2.8 | BASELINE |
| C001 R+82 | 14.2 | 13.2–21.4 | BASELINE |
| C001 R+194 | 17.5 | 4.1–22.3 | BASELINE |
| C002 R+1 | 36.9 | 32.6–46.4 | INDETERMINATE |
| C002 R+45 | 53.4 | 49.7–62.0 | UNEXPECTED_ACTIVATION |
| C002 R+82 | 18.2 | 13.8–27.6 | BASELINE |
| C002 R+194 | 13.3 | 11.0–13.8 | BASELINE |
| C003 R+1 | 66.9 | 65.1–68.2 | EXPECTED_FLIGHT_RESPONSE |
| C003 R+45 | 12.2 | 11.6–14.2 | BASELINE |
| C003 R+82 | 30.0 | 30.0–34.9 | INDETERMINATE |
| C003 R+194 | 56.6 | 56.6–57.4 | UNEXPECTED_ACTIVATION |
| C004 R+1 | 36.0 | 33.2–55.0 | INDETERMINATE |
| C004 R+45 | 8.7 | 8.7–20.4 | BASELINE |
| C004 R+82 | 35.2 | 34.6–48.1 | INDETERMINATE |
| C004 R+194 | 10.7 | 10.7–27.2 | BASELINE |

- C003 R+1 marker q values: il_6 1.000, mcp_1 0.967, il_10 0.174, monocytes 0.767, glucose 0.669, il_27 0.303.
- C003 R+45 has no glucose (QC-2); FRI is still 12.2 (weights renormalised).
- Noise floor: scoring each pre-flight draw against the other two gives, sorted,
  0.0, 1.2, 4.4, 6.0, 7.8, 7.9, 9.0, 9.3, 18.1, 18.9, 36.5, 37.4.
- `borderline` (band[0] < T <= band[1] for T = 20 or T = 40) is true for exactly nine panels: C001 R+1, C001 R+82,
  C001 R+194, C002 R+1, C002 R+82, C004 R+1, C004 R+45, C004 R+82, C004 R+194; false for C003 R+1 and C002 R+45.
- Other large changes: C002 R+45 -> exactly one entry, il_8, fold 47.04. C003 R+1 -> il_13 (8.01), il_22 (4.04).
- A panel with only one core marker returns `fri = null`, class INSUFFICIENT.

### T4 — Recovery bound, ETA, re-test (30 min)
Port `half_life_bound` and `eta_days`. Compute half-life from FRI rounded to one decimal.
ETA and re-test are produced only for class EXPECTED_FLIGHT_RESPONSE. For C001..C004 use the leave-own-out
reference band from the fixture (`recovery.eta[crew].loo_half_life_band`); for anyone else use
`recovery.reference_band_all`.

**Tests**
- half-life bounds from R+1 -> R+45 (dt 44): C001 8.07, C003 17.92, C004 21.47; C002 returns null (FRI rose).
- C003 R+1: ETA 14.1–37.4 days after the panel, first re-test offset 15 (mission day 16).
- C001 R+1: ETA 22.7–27.2, raw re-test 23 clipped to 21.
- `etaDays` on a non-EXPECTED panel is not called / returns null.

### T5 — Daily strain + draw advisor (40 min)
Port `daily_strain`. Implement `drawAdvice(state)` with rules A1–A6 from spec §4.10 (first match wins) and
the kit counters. Map Phase 1 KPI field names to `sleep_hours, sleep_quality, resting_hr, fatigue, mood`.

**Tests**
- History of 14 days with `sleep_hours = 7.0 + 0.1*(i%3)`, `sleep_quality = 4`, `resting_hr = 58 + (i%2)`,
  `fatigue = 2`, `mood = 4`; today {7.1, 4, 58, 2, 4} -> DSS 0.0; today {5.0, 2, 66, 4, 3} -> DSS 90.0.
- Fewer than 5 history days -> null.
- A2 fires with DSS >= 50 on 3 consecutive days and last panel 9 days ago; does not fire at 6 days.
- A3 returns SKIP and increments `kitsSaved` when last panel was 31 days ago, class BASELINE, 7 calm days.
- A1 beats A2 when a re-test date is due. Importing an UNEXPECTED panel sets a re-test 3 days later.

### T6 — Facts, grounding guard, templates, Cosmo tools (45 min)
- `buildFacts(panelResult, context)` returns a flat JSON with: class, fri, band, borderline, top two core
  markers by z with `foldRounded` (1 decimal), previous FRI if any, reference statements
  (`crewSameDirection: "4 of 4"`, `crewBackByDay45: "3 of 4"`), ETA/re-test if any, QC notes for this panel,
  action list from spec §7.3, and `allowedNumbers` (every number above as the exact strings to be spoken:
  integers for FRI and band, one decimal for folds; plus the fixed reference numbers used by the templates:
  100 for the scale, 45 for the Inspiration4 follow-up day, and for draw advice 50, days since last panel, kits left, kits total).
- `assertNumbersGrounded(text, facts)`: remove known tokens (`IL-6`, `IL-8`, `IL-10`, `IL-27`, `MCP-1`,
  `Inspiration4`), extract `\d+(?:[.,]\d+)?`, require each to be in `allowedNumbers`. Return false otherwise.
- Templates `mn` and `en` for the four situations in spec §7.1 (a, b, c1, c2): copy the sentences from the
  spec verbatim and replace the numbers with placeholders. Do not re-translate the Mongolian.
- Cosmo tools: `get_signature_triage(crewId, panelId?)` -> facts; `get_draw_advice(crewId)` -> rule ID + facts.
  System-prompt addition: "Use only numbers present in the tool result. At most five sentences, one action,
  end with: Decision support, not a diagnosis. / Энэ бол шийдвэр гаргахад туслах мэдээлэл, онош биш."
- After the LLM answers: if `assertNumbersGrounded` fails or the disclaimer is missing, send the template.
- Hook into the existing flow: after KPI confirmation, if an undiscussed panel exists, Cosmo offers the
  triage summary; after the daily summary, Cosmo voices draw advice only for A1, A2, A3.

**Tests**
- Template (a) rendered for C003 R+1 contains "67", "65", "68", "2.8", "15" and passes the guard.
- Template (c2) for C002 R+45 contains "37", "53", "2.7", "47", "3" and passes the guard.
- A text containing "72" for C003 R+1 fails the guard. A text without the disclaimer is rejected.
- No forbidden wording (ground rule 6) in any template, both languages.

### T7 — UI: Triage card + Fingerprint card (45 min)
Per spec §7.2 items 1 and 2. shadcn `Card`, `Badge`, `Popover`, `ToggleGroup`; Recharts horizontal `BarChart`.
Light clinical theme, existing tokens. Inspiration4 envelope for a crew member = min–max z of the other three
crew at R+1 (compute from the matrix). i18n keys in both languages.
- **Check:** for C003 R+1 the track shows 67 with whisker 65–68, badge "Expected flight response"; IL-6 bar is
  capped at 4 with tooltip "7.6 pg/mL, baseline 2.67, x2.8, above all your pre-flight values";
  timepoint selector switches all cards; "How sure are we?" shows 12 control dots, max 37.4.

### T8 — UI: Recovery & next draw card + Evidence card (45 min)
Per spec §7.2 items 3 and 4. Evidence numbers come from `signature_reference.json` (`evidence`, `loco`,
`noise_floor`, `selection`, `lymphocytes`, `crp`, `L44_batch_check`, `qc_log`); do not hard-code them in JSX.
- **Check:** C003 timeline shows 66.9 -> 12.2 -> 30.0 -> 56.6 with bands, threshold line at 20, decay fan
  after R+1, re-test marker at day 16. Evidence card shows "24 of 36" and "21 of 36 (chance 25 %)",
  "selected in 4 of 4 folds" for all six markers, the three rejected ideas, and the QC log with old -> new.
  Footer lists the three dataset DOIs: 10.26030/e0rx-sh52, 10.26030/mc5d-p710, 10.26030/7cax-yj10.

### T11–T13 — Second-assay cross-check (do these now, before T9)
Tasks, formulas, tests and replacement dialogue are in `docs/SIGNATURE_ADDENDUM_SECOND_ASSAY.md` §6.
Where the addendum and the spec differ, the addendum wins.

### T14 — Honesty guards: space measurability + Twins Study row (25 min, after T13, before T9)
Spec §8.1 and §8 item 4b are binding.
- `src/lib/signature/spaceMeasurability.ts`: export statements S1–S3 from the §8.1 table as constants, `en`
  and `mn`, copied verbatim (do not re-translate the Mongolian).
- Cosmo tool `get_space_measurability()` returns the three statements for the session language. System-prompt
  addition: "For questions about measuring in space, in orbit or on the ISS, call get_space_measurability and
  answer only from its result."
- `assertNoOrbitClaim(text)`: returns false when assistant text claims in-flight measurement, i.e. matches
  `/\b(measure[sd]?|measuring|track(s|ed|ing)?|monitor(s|ed|ing)?)\b[^.]{0,40}\b(in|on) (orbit|space|the ISS|flight)\b/i`
  and the sentence has no negation (`not`, `no`, `never`, `cannot`, `n't`). Run it next to
  `assertNumbersGrounded`; on failure send S1 + S3.
- Triage card: one-line caption "Scored on ground laboratory panels" / "Дэлхий дээрх лабораторийн хариугаар
  оноо өгсөн" with a popover showing S1–S3.
- Evidence card: add the row "Different mission, same direction (n = 1)" with the two limiting sentences of
  spec §8 item 4b and reference [9]. Static text; Cosmo does not speak the percentages of that paper.
- **Tests:** S1–S3 pass both guards in both languages; "AEGIS measures IL-6 in orbit" fails
  `assertNoOrbitClaim`; "I do not measure anything in orbit myself" passes; the tool returns three strings.

### T9 — Offline scripted demo (45 min)
**Use the demo script in the addendum §5 (crew C001, C002, C003), not spec §9.**
- Route `/demo/signature` (or the repo's existing demo switch) that plays the addendum §5 script beat by beat with a
  "Next" key (Space / right arrow) and an auto-play option. No network calls: no Anthropic, no ElevenLabs.
- Text comes from the templates. Audio: if `public/demo/audio/<beat>_<lang>.mp3` exists, play it; otherwise
  show captions only. Add `pnpm demo:audio` that pre-generates those files through the existing ElevenLabs
  helper when a key is present (run once before the pitch, commit the files).
- Simulated check-ins for beat (b): `src/data/demo_checkins.json`, generated by a script from the T5 test
  rule (14 calm days, then 3 days {5.0, 2, 66, 4, 3}), last panel 9 days before, kits 5 of 8. Show a visible
  banner "Simulated check-ins" on that beat.
- Mission clock override per beat as listed in the addendum §5 table.
- A beat whose component was not built is skipped, never a blank screen.
- **Check:** with Wi-Fi off, the whole script runs in under 3 minutes and every number on screen matches the
  fixture.

### T10 — Close-out (30 min)
- `pnpm lint && pnpm test && pnpm build` green.
- Append to `docs/sources.md` all references from spec §11 (twelve).
- Add a "Limitations" line under each card title tooltip (spec §8, one sentence each).
- Write `docs/SIGNATURE_BUILD_NOTES.md`: what was built, any deviation, how to run the demo.

## Done when

1. All tests above pass, including the 16-panel table.
2. `/demo/signature` plays offline end to end.
3. Cosmo cannot emit a number that is not in the tool facts (guard test passes).
4. No forbidden wording appears anywhere (add a test that greps templates and i18n files).
