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
