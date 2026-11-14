# AEGIS — Signature Triage: integration prompt (entry point, for Sonnet 5.5 in Claude Code)

You are working in the existing AEGIS repository (NASA Space Apps 2026, astronaut health monitoring;
voice companion "Cosmo"). The earlier phases are built and working. Your job is to add **one** feature,
Signature Triage, without changing the behaviour of anything that exists.

The design is finished. You implement it; you do not redesign it.

## 1. Inputs (already copied into the repo)

| File | Role |
|---|---|
| `docs/SIGNATURE_SPEC.md` | Design: data findings, formulas (§4), results (§5), code-vs-LLM split (§6), product surface (§7), validation and limits (§8, §8.1), sources (§11) |
| `docs/SIGNATURE_ADDENDUM_SECOND_ASSAY.md` | Two-assay confirmation; replaces the spec's dialogues and demo script |
| `docs/PROMPT_SIGNATURE_BUILD.md` | Task definitions T0–T14 with ground rules, types, constants and test numbers |
| `docs/signature_reference/reference_engine.py`, `reference_second_assay.py` | Reference implementation (Python stdlib). Port it; do not reinterpret it |
| `docs/signature_reference/expected_values.json`, `expected_second_assay.json` | Fixtures. Source of truth for every number |
| `docs/signature_reference/MANIFEST.sha256` | Checksums of the six NASA CSV files the fixtures were computed from |
| `data/OSD-575_LSDS-8_Alamar_NULISA_serum_TRANSFORMED.csv` | The sixth data file (second serum assay). The other five are already in the repo |

Precedence when two sources disagree:
1. Numbers: the fixtures win over every document.
2. Design: addendum, then spec, then the build prompt.
3. Code style, naming, folders, commands, i18n, UI primitives: the repository (`CLAUDE.md`, existing code) wins
   over every path and library name written in these documents. Paths such as `src/lib/signature/` and
   commands such as `pnpm test` are defaults; use the repo's real ones.

## 2. Step 0 — Preflight and recon (20 min, no feature code)

1. `git status` must be clean. Create and switch to branch `feat/signature-triage`. All commits go there.
2. Run the repo's own lint, test and build commands. Record the result (pass/fail counts) so that failures
   that already exist are not confused with yours.
3. Locate the five NASA CSV files already in the repo and the sixth one from this bundle. Compare their
   SHA-256 with `MANIFEST.sha256`. A mismatch is recorded, not fatal: the fixture tests decide.
4. If `python3` is available, run both reference scripts on the data folder and diff the output against the
   two fixtures. Record "identical" or the differing keys.
5. Read `CLAUDE.md`, the database schema, the lab importer and lab engine, the Cosmo tool registration and
   system prompt, the i18n dictionary, the card components, the mission-clock mechanism and any demo mode.
6. Write `docs/SIGNATURE_INTEGRATION_MAP.md`:
   - stack actually found (framework, router, ORM, UI kit, chart library, test runner, package manager);
   - for every module in the build prompt's "Target layout": **REUSE** (existing path) or **ADD** (new path);
   - the exact existing files you will edit, and why. Expected: Cosmo tool registry, Cosmo system prompt,
     one route, one navigation entry, the i18n dictionary, and the lab importer if it is extended;
   - anything in the documents that does not fit the repo, and the smallest adaptation you chose.
   Commit the map as `T-1 integration map`.

Prefer REUSE. If the existing importer already parses these files, wrap its output into `LabMatrix`; do not
write a second parser. If an existing guard, template system or demo switch exists, extend it.

## 3. Build

Execute the tasks in `docs/PROMPT_SIGNATURE_BUILD.md` in this order:
**T0, T1, T2, T3, T4, T5, T6, T7, T8, T11, T12, T13, T14, T9, T10.** Its ground rules 1–8 apply in full.

Per task: tests first with the expected numbers, then code, then the repo's lint and test commands, then one
commit whose message starts with the task ID. After each commit append one line to
`docs/SIGNATURE_BUILD_NOTES.md`: task, commit hash, tests added, deviation if any.

## 4. Integration constraints (in addition to the build prompt)

- **Additive only.** No renames, no restyling, no refactors of existing code. Existing tests are not edited
  to make them pass; if one breaks, your change is wrong.
- **Database.** Additive migrations only (new tables or nullable columns). Never reset, drop or re-seed
  existing data. If the fixture-backed feature can run from the JSON and CSV files without a schema change,
  choose that.
- **Dependencies.** None added. If something seems required, record it in the notes and solve it with what
  the repo has.
- **Numbers.** Deterministic code computes every number. The LLM phrases tool results only.
  `assertNumbersGrounded` and `assertNoOrbitClaim` gate every Cosmo answer of this feature; on failure the
  template is sent instead.
- **Claims.** No in-orbit measurement claim anywhere (spec §8.1). No forbidden wording (build rule 6).
  Every card carries its limitation line. Simulated check-ins carry the "Simulated check-ins" banner.
- **Data files** are read-only. QC is applied in code and shown in the QC log.
- **Offline demo.** `/demo/signature` (or the repo's demo switch) makes no network call and needs no API key.
- **Failure handling.** If a task cannot be finished in about twice its budget, revert to the last green
  commit, write what blocked it in the notes, and continue with the next task. The demo (T9) plays only the
  beats whose components exist. Do not ask questions; do not stall.

## 5. Done when

1. Fixture numbers are reproduced in tests: the 16-panel table (FRI, band, class), scales and z values,
   12-entry QC log, half-life bounds, leave-one-crew-out counts, noise floor, and the second-assay statuses
   and badges.
2. The repo's lint, test and build commands are green; every test that passed in Step 0 still passes.
3. Cosmo answers "what does my panel mean?" for C001 R+1, C002 R+45 and C003 R+194 with the right template
   and badge, and answers "can you measure this on the ISS?" from statements S1–S3 only.
4. The offline demo runs end to end in under three minutes with every on-screen number equal to the fixture.
5. `docs/SIGNATURE_BUILD_NOTES.md` is complete: what was built, deviations, how to run the demo, and how to
   merge (`feat/signature-triage` into the main branch).

Stop after T10. Final message: the Done list with pass/fail per item, and nothing else added.
