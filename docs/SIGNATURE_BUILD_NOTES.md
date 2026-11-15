# Signature Triage: build notes

Entry point `docs/PROMPT_SIGNATURE_INTEGRATE.md`; tasks `docs/PROMPT_SIGNATURE_BUILD.md`; integration decisions
`docs/SIGNATURE_INTEGRATION_MAP.md`. Every decision and deviation is recorded here.

## Step 0: preflight and recon

- **Branch:** work is done directly on `main` at the user's request (the docs say `feat/signature-triage`). No
  branch created, nothing pushed. Start commit `25e8332`. `git status` before work: only the untracked bundle docs
  and the local `.claude/` folder (never committed).
- **Baseline checks at `25e8332`, before any signature work:** `pnpm exec tsc --noEmit` 0 errors;
  `pnpm exec eslint src tests scripts` clean; `pnpm exec vitest run` 47 files / 2027 tests pass; `pnpm test:pg`
  2027 pass; `pnpm build` OK. Re-run after the T-1 changes (docs, data, `.gitignore`, `.gitattributes`): tsc 0,
  eslint clean, vitest 47 / 2027 pass.
- **Data files (`data/nasa/`), SHA-256 vs `docs/signature_reference/MANIFEST.sha256`:**
  - `OSD-569_LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv` = manifest `OSD-569_CBC.csv` (same hash, different
    name: the OSDR download name). Match.
  - `OSD-575_LSDS-8_Comprehensive_Metabolic_Panel_CMP_TRANSFORMED.csv`: match.
  - `OSD-575_LSDS-8_Multiplex_serum_cardiovascular_EvePanel_TRANSFORMED.csv`: match.
  - `OSD-575_LSDS-8_Multiplex_serum_immune_EvePanel_TRANSFORMED.csv`: match.
  - `OSD-575_LSDS-8_Alamar_NULISA_serum_TRANSFORMED.csv` (sixth file, from the bundle): match.
  - `OSD-656_LSDS-64_urine_immune_TRANSFORMED.csv`: **not present**. Spec §3: not used by the engine (urine proxy
    is reported from the fixture only). Recorded, not fatal.
  - The four OSD-569/575 EvePanel/CMP/CBC files were downloaded from osdr.nasa.gov (the docs assumed they were
    already in the repo; they were not, because `.gitignore` ignored `/data/`).
- **Reference scripts:** `python -I -X utf8 docs/signature_reference/reference_engine.py data/nasa` and
  `reference_second_assay.py data/nasa` reproduce `expected_values.json` and `expected_second_assay.json`:
  **identical** (byte-for-byte after removing the CRLF that Windows text-mode stdout adds; `-X utf8` is needed
  because the cp1252 console cannot encode "α" in `tnfα`).
- **Recon:** stack, REUSE/ADD per module, files to edit and every adaptation are in
  `docs/SIGNATURE_INTEGRATION_MAP.md`. Key decisions: no Prisma / no importer / no schema change (engine runs from
  the CSV and JSON files, QC recomputed in code); crew link `bat->C001, saraa->C002, alex->C003, mira->C004`
  (engine and pages on C001..C004, always labelled Inspiration4 reference data); `/signature` page + one top-bar
  link instead of a dashboard tab; signature i18n keys `dashboard.signature.*` merged into the `dashboard` area (the
  five-area set is pinned by a test); Cosmo signature tools live in `src/server/agent/signature.ts`, not in the
  frozen `TOOL_DEFINITIONS` (six names pinned by a test), and their prompt rules ride in a directive, not in
  `SYSTEM_PROMPT`; DSS KPI mapping `sleep_hours`, `heart_rate` as `resting_hr`, `mood` (no sleep-quality or fatigue
  field in the app; skipped as the reference does); CSVs reach Vercel through `outputFileTracingIncludes` (T1).
- **Repo changes in T-1:** `.gitignore` `/data/` -> `/data/*` + `!/data/nasa/` (DB files stay ignored);
  new `.gitattributes` marks `data/nasa/*.csv` and `docs/signature_reference/**` as `-text`, because
  `core.autocrlf=true` here would otherwise rewrite line endings on checkout and break the checksums (the CSVs
  are CRLF + BOM as downloaded; the fixtures and scripts are LF); `.gitignore` also gains `__pycache__/` (the
  second reference script imports the first and leaves bytecode next to it).

## Task log

| Task | Commit | Tests added | Deviation |
|---|---|---|---|
| T-1 integration map | 88cff68 | 0 | branch = main (user request); bundle docs, data/nasa CSVs, map, notes, `.gitignore`, `.gitattributes` |
| T0 fixture, config, types | 2bb5f25 | 7 (`tests/signature/config.test.ts`) | `sig:ref` prints to stdout (no `/tmp` on Windows), runs `python3 -I -X utf8 ... data/nasa`; crew link `bat/saraa/alex/mira -> C001..C004` in `config.ts`; this row added with T1 |
| T1 loader + QC | 4c78ddd | 14 (`tests/signature/load.test.ts`) | no importer / no DB (map 4.2): pure parser `src/lib/signature/load.ts` + server fs reader `src/server/signature/files.ts` (memoised per process); `qcLog` returned by the loader, not persisted; TS matrix after QC checked identical (all 119 analytes x crew x timepoint) to the reference `load_all` once by hand; `next.config.ts` `outputFileTracingIncludes` for `/signature`, `/demo/signature`, `/api/signature/**`, `/api/checkins/**` -> `./data/nasa/**/*.csv`, verified after `pnpm build`: the 6 `/api/checkins/**` `.nft.json` traces list the 5 CSVs (the other routes do not exist yet); resumed from a builder cut off by a network outage, its WIP kept as is |
| T2 baseline, scale, z, envelope | c08a8ff | 26 (`tests/signature/engine.test.ts`) | none in the maths (straight port of `pre_vals`, `baseline`, `scale`, `zscore`, `envelope`); added small helpers `median` (Python `statistics.median`), `pctChange`, `signatureScales`; `scale` defaults to C001..C004 and takes a crew list only for leave-one-crew-out; besides the build-prompt numbers the tests check baseline, fold, z and envelope of every marker of the 16 fixture panels (93 = 96 - 3 QC-2 glucose gaps); checks: tsc 0, eslint clean, vitest 50 files / 2074 pass, `pnpm test:pg` 2074 pass |
| T3 selection, FRI, band, class | f8d509d | 34 (`tests/signature/triage.test.ts`) | none in the maths (port of `select_signature`, `fri`, `fri_band`, `classify`); added `scorePanel` (one `PanelResult`), `noiseFloor`, `isBorderline` (band low < T <= band high, raw band), `otherLargeChanges` (not in the reference engine; rule of the build prompt, `OTHER_LARGE_FOLD` 3 / `OTHER_LARGE_TOP` 3 from `config.ts`, needs >= 2 positive pre-flight draws), `DEFAULT_SIGNATURE` (config list, all +1); `PanelResult.markers` keyed by bare analyte name like the fixture, values unrounded; classify's "days since transition" = the panel's mission day; extra tests: per-marker parts of all 16 panels and the 4 LOCO folds vs the fixture; checks: tsc 0, eslint clean, vitest 51 files / 2108 pass (no server/db change, `test:pg` not needed) |
| T4 recovery bound, ETA, re-test | fc72636 | 11 (`tests/signature/recovery.test.ts`) | none in the maths (port of `half_life_bound`, `eta_days`, FRI rounded to one decimal); `src/lib/signature/recovery.ts` adds `recoveryFor(panel)` (null unless EXPECTED_FLIGHT_RESPONSE; LOO half-life band from the fixture for C001..C004, `reference_band_all` for anyone else, re-test mission day = panel day + offset on the landing-relative clock, map 4.9), `halfLifeBoundsR1toR45` (computed bounds, checked equal to the fixture); `etaDays` also returns the unclipped `retestRaw`; checks: tsc 0, eslint clean, vitest 52 files / 2119 pass. Note: another session commits unrelated emergency-guide work on `main` in parallel (e.g. 3ba2702, 414490f); only signature files are staged in these commits |
| T5 daily strain + draw advisor | 7109408 | 20 (`tests/signature/strain.test.ts`) | `dailyStrain` straight port of `daily_strain`; app KPI mapping per map 4.6 (`strainDayFromKpis`, `strainDaysFromHistory`, reuse of `asNumber` from `src/lib/kpi/registry.ts`); draw advisor without stored state (map 4.10): pure `drawAdvice(state)` returns rule A1/A2/A3/A4/A6 + kit counters + the next state, `importPanel` applies A5 (UNEXPECTED -> re-test day + 3, symptom check) and, for EXPECTED, the section 4.8 re-test day; each import uses one kit and consumes a pending re-test; `drawStateFromPanels` folds the panels up to today. Interpretations: "DSS >= 50 on 3 consecutive days" = the last 3 days ending today; "DSS < 25 on each of the last 7 days" needs 7 computable days; no panel yet counts as "last panel long ago" (A2 allowed, A4 fires); an A3 skip stores `skipRecheckDay` = today + 7 so the same skip saves one kit only, not one per day (spec silent); checks: tsc 0, eslint clean, vitest 55 files / 2261 pass (counts include the parallel session's new test files) |
