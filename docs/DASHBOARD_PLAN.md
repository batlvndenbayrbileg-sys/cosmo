# Cosmo — question set, status model and dashboard creative plan (v1)

Date: 2026-11-14. Source: `NASA_Health_Companion_Requirements.xlsx` (8 sheets, read in full) layered on `docs/BRIEF.md`.
Types for everything below live in `src/lib/types.ts` (the contract). Where this document and `docs/PLAN.md` disagree, **this document wins** for the question set, statuses and dashboard; `PLAN.md` still governs architecture, state machine, API shape and risks.

## 0. What the workbook changes (decisions recorded)

| Topic | Brief (`BRIEF.md`) | Workbook | Decision for Phase 1 |
|---|---|---|---|
| Questions / indicators | 14 KPIs incl. SpO2, body mass, back pain, fatigue, sleep quality | BP, pulse, glucose, temperature, sleep, mood 1–5, symptoms (headache/dizziness/nausea + note), exercise, water, vision check, workload, day note (sheets *Data model*, *Daily flow*, R-09…R-14) | **Workbook set wins** (§1). SpO2, body mass, back pain, fatigue, sleep quality are dropped. |
| Language | Mongolian + English | "Хэл: Англи хэл" (STT/LLM more reliable, NASA sources English) | **Keep both** (brief), English is the recommended demo language; Mongolian text needs a native-speaker review. |
| Crew size | 3 | 2–4 profiles | **4 crew**. |
| Status model | "notable" at mean ± 2 sd or outside a safety range | green / yellow / red / no-data, personal baseline, never show "normal" when data is missing (R-15) | **Workbook model** (§2). |
| Thresholds | fixed safety ranges | no sourced numeric thresholds exist on the NASA HRP pages; each must be sourced or marked "demo parameter" (R-16) | **All thresholds are `demo parameter`**, shown as such in the UI. None is a clinical limit. |
| Radar axes | Sleep, Cardiovascular, Musculoskeletal, Neuro-ocular, Behavioral, Activity | — | Indicators changed, so axes are: **Sleep, Cardiovascular, Metabolic, Neuro-ocular, Behavioral, Musculoskeletal** (Activity merged into Musculoskeletal; Metabolic added for glucose/temperature/water). |
| Dashboard | astronaut-side, after check-in | Earth dashboard for flight surgeons (R-28), alerts (R-29), link delay (R-30), hazard link (R-18/R-19), daily tasks with "why" (R-17), prototype notice (R-33), accessibility (R-32), routing test (R-37) | **Both**: crew dashboard (§3) and a read-only **Earth console** (§4), fed from local SQLite. Link delay is **simulated**. |
| Electron overlay, Supabase, Vercel, sync queue, wearable | — | R-01…R-05, R-25…R-27, Decisions sheet | **Out of Phase 1** (brief stack stays). Local SQLite stands in for "cloud"; labelled simulated. |

Honest labelling that must appear in the product: *Prototype, not a medical device* · *Decision support, not a diagnosis* · *demo parameter* on every threshold · *simulated* on seeded history and on the Earth link.

## 1. Canonical question set

Cosmo asks these in this order, one question per turn. A question is skipped if all its keys are already filled. Stored keys (16): `sleep_hours, mood, symptom_headache, symptom_dizziness, symptom_nausea, symptom_note, bp_systolic, bp_diastolic, heart_rate, temperature_c, glucose_mgdl, water_ml, exercise_min, vision_check, workload, day_note`.

| # | Question id | Slot | Keys written | Type / unit | Hard range (reject outside) | EN prompt | MN prompt |
|---|---|---|---|---|---|---|---|
| 1 | `sleep` | morning | `sleep_hours` | number, h | 0–14 | How many hours did you sleep? | Хэдэн цаг унтсан бэ? |
| 2 | `mood` | morning | `mood` | scale 1–5 | 1–5 | How is your mood, from 1 to 5? | Сэтгэл санаа ямар байна, 1-ээс 5 хүртэл? |
| 3 | `symptoms` | morning | `symptom_headache`, `symptom_dizziness`, `symptom_nausea` (boolean 0/1), `symptom_note` (text, optional) | — | — | Any headache, dizziness or nausea? | Толгой өвдөх, толгой эргэх, дотор муухайрах зүйл байна уу? |
| 4 | `blood_pressure` | morning | `bp_systolic`, `bp_diastolic` | integer, mmHg | 70–220 / 40–140 | What is your blood pressure? | Цусны даралт хэд байна? |
| 5 | `heart_rate` | morning | `heart_rate` | integer, bpm | 30–200 | What is your pulse? | Пульс хэд байна? |
| 6 | `temperature` | morning | `temperature_c` | number, °C | 34–42 | What is your body temperature? | Биеийн температур хэд байна? |
| 7 | `glucose` | midday | `glucose_mgdl` | integer, mg/dL | 40–400 | What is your blood glucose, in mg/dL? | Цусны сахар хэд байна (mg/dL)? |
| 8 | `water` | midday | `water_ml` | integer, ml | 0–6000 | How much water have you had today, in millilitres? | Өнөөдөр хэдэн мл ус уусан бэ? |
| 9 | `exercise` | afternoon | `exercise_min` | integer, min | 0–240 | How many minutes did you exercise? | Хэдэн минут дасгал хийсэн бэ? |
| 10 | `vision` | afternoon | `vision_check` | category: 0 clear · 1 slightly blurred · 2 clearly blurred | 0–2 | Quick vision check: cover one eye, then the other, and read a line of text. Is it sharp, slightly blurred or clearly blurred? | Хараа шалгая: нэг нүдээ, дараа нь нөгөөгөө таглаад нэг мөр бичвэр уншаарай. Тод уу, бага зэрэг бүдэг үү, эсвэл бүдэг үү? |
| 11 | `workload` | evening | `workload` | scale 1–5 | 1–5 | How heavy was today's workload, from 1 to 5? | Өнөөдрийн ажлын ачаалал хэр байсан, 1-ээс 5? |
| 12 | `day_note` | evening | `day_note` | text, optional | — | Anything else you want to note about today? | Өнөөдрийн талаар нэмж тэмдэглэх зүйл байна уу? |

Notes: `vision_check` method is a placeholder (workbook R-14: "exact test unknown, find a source") — the UI says "self-check, method TBD". Symptom answers are yes/no per symptom; "no headache" is a recorded `0`, not a missing value. Mood is asked once per check-in in Phase 1 (workbook wants several per day — later).

### 1.1 Per-key registry (implement in `src/lib/kpi/registry.ts`)

Thresholds use the `ThresholdSpec` semantics in `types.ts`. **All values are demo parameters {unverified clinically}.**

| key | axis | hazards | thresholds | maxLevel | sdFloor |
|---|---|---|---|---|---|
| `sleep_hours` | sleep | isolation_confinement | low {yellow 7, red 5} | — | 0.3 |
| `mood` | behavioral | isolation_confinement | low {yellow 3, red 2} | — | 0.4 |
| `symptom_headache` | neuro_ocular | gravity | high {yellow 0, red 1} (1 → yellow) | yellow | — |
| `symptom_dizziness` | neuro_ocular | gravity | high {yellow 0, red 1} | yellow | — |
| `symptom_nausea` | metabolic | hostile_closed_environment | high {yellow 0, red 1} | yellow | — |
| `symptom_note` | — | — | none (keyword rule only) | — | — |
| `bp_systolic` | cardio | gravity | low {yellow 100, red 90}, high {yellow 129, red 139} | — | 3 |
| `bp_diastolic` | cardio | gravity | low {yellow 60, red 55}, high {yellow 84, red 89} | — | 2 |
| `heart_rate` | cardio | gravity | low {yellow 50, red 40}, high {yellow 90, red 110} | — | 2 |
| `temperature_c` | metabolic | hostile_closed_environment | low {yellow 36.0, red 35.5}, high {yellow 37.5, red 38.0} | — | 0.15 |
| `glucose_mgdl` | metabolic | hostile_closed_environment | low {yellow 70, red 60}, high {yellow 140, red 180} | — | 5 |
| `water_ml` | metabolic | gravity | low {yellow 2000, red 1000} | yellow | 150 |
| `exercise_min` | musculoskeletal | gravity | low {yellow 45, red 15} | yellow | 5 |
| `vision_check` | neuro_ocular | gravity | high {yellow 0, red 1} (1 → yellow, 2 → red) | — | 0.3 |
| `workload` | behavioral | isolation_confinement | high {yellow 3, red 6} | yellow | 0.4 |
| `day_note` | — | — | none | — | — |

Hazard links are **suggested, not official NASA mappings** (workbook README §4). The five hazard keys are `radiation`, `isolation_confinement`, `distance_from_earth`, `gravity`, `hostile_closed_environment`; `radiation` and `distance_from_earth` have no indicator in this prototype and are shown as **"not monitored here"**. Display names and source URLs come from `src/lib/nasa/hazards.ts` (fetched from nasa.gov/hrp/hazards — see §6).

## 2. Status model (all computed in `src/lib/health`, never by the LLM)

Per indicator, evaluated in this order:

1. **No value** → `no_data`, reason `missing`. Never rendered as normal (R-15).
2. **Fixed range** (demo parameter): `red` / `yellow` / `green` per `thresholds`; clamp to `yellow` when `maxLevel: "yellow"`. Reason `fixed_range` for yellow/red.
3. **Personal baseline**: from the person's last 14 confirmed days (today excluded), requires n ≥ 5. `z = (value − mean) / max(sd, sdFloor)`. If the fixed result is green and `|z| > 2` → `yellow`, reason `baseline`. Baseline never escalates to red. Numeric keys only. `delta = value − mean`.
4. **Combo / keyword rules** (set a **red flag**, the person is told calmly that the crew medical officer and ground are being informed):
   - `VITAL_RED`: any of `bp_systolic, bp_diastolic, heart_rate, temperature_c, glucose_mgdl` is red, or `vision_check = 2`, or `mood = 1`.
   - `HEADACHE_PLUS_VISION`: `symptom_headache = 1` and `vision_check ≥ 1` (fluid-shift-related eye changes are a NASA-named concern; link is suggested). Reason `combo_rule`.
   - `SERIOUS_SYMPTOM_WORD`: `symptom_note` or `day_note` contains a serious word (EN: chest pain, can't breathe, cannot breathe, faint, fainted, unconscious, severe pain; MN: цээж өвд, амьсгал давс, ухаан алд, ухаан балр, хүчтэй өвд). Reason `keyword_rule`. Keep the lists in one editable array.
   - Two or more symptoms flagged (`headache`, `dizziness`, `nausea`) → at least `yellow` for each (already) and the summary mentions it.
5. **Overall status**: `red` if any red flag or any red indicator; else `yellow` if any yellow; else `green` if ≥ 10 of the 14 numeric/boolean keys have values; else `no_data`.
6. **Readiness (0–100)**: indicator sub-score green 100 · yellow 60 · red 20 · no_data ignored; readiness = mean of the six axis scores that have data, rounded; capped at 60 when any red flag; `null`/0 handling: if fewer than 3 axes have data → readiness 0 and overall `no_data`.
7. **Axes** (6): axis score = mean of its indicators' sub-scores (null if none). `baseline` per axis = mean of that axis' daily scores over the 14 history days (compute the same way per day). `status` = worst indicator status in the axis.
8. **Hazards** (5): status = worst status among linked indicators that have data; `no_data` if linked indicators exist but none has data; `not_monitored` if no indicator is linked.
9. **Findings** (summary, max 2): non-green indicators ranked red before yellow, then by `|z|` descending; text templates in both languages produced by code, e.g. "Sleep was 5.5 h, about 1.7 h below your usual 7.2 h."
10. **Tasks** (3–4, shown on the dashboard) and **recommendations** (the top 2 of those tasks, shown in the summary). Rules in `src/lib/health/tasks.ts`, each task has `title`, `why` (one sentence, numbers from code), `hazard`, `relatedKeys`, both languages. Lifestyle only — **never diagnosis, drugs or treatment** (guardrail R-21); anything medical says "ask your crew medical officer / flight surgeon". Rules: low sleep → wind-down/lights; low water → drink a set amount, spread through the day; low exercise → scheduled session; mood low or workload high → short break / call crew or family; vision yellow → repeat the self-check this evening and report if it persists; glucose out of green → keep next meal on schedule and recheck later (no dose, no advice on medication); fill with defaults (hydration plan, light exposure, stretching) up to 3 minimum.

Rendering rule (accessibility R-32): status is never colour alone. Glyphs: green **● Normal**, yellow **▲ Watch**, red **◆ Alert**, no-data **○ No data**. Wording is "alert", never "diagnosis".

## 3. Crew dashboard — creative plan: "Quiet Mission Control"

Idea: one calm screen that answers three questions in this order — *How am I overall? What changed versus my own normal? What should I do today?* — and always shows *why* (source, baseline, which NASA hazard it relates to). Light, clinical, projector-friendly: white/very light grey surfaces, one accent (deep teal `#0B6E7F`), status colours used only for status, large type, generous spacing, rounded cards, motion only to explain (cards slide in on capture, Cosmo glides to the corner).

Design tokens (CSS variables, light theme): `--background #F6F8FA`, `--card #FFFFFF`, `--foreground #0F1B2D`, `--muted #5B6678`, `--border #E3E8EF`, `--accent #0B6E7F`, `--ok #1F8A4C`, `--watch #B7791F`, `--alert #C53030`, `--nodata #8A94A6`. Font: Geist (via `next/font`) or system UI; base size 17 px, KPI numerals 36–44 px, tabular numerals.

Signature elements:

1. **Vitals Constellation** (`ConstellationGlyph`): 16-position ring (one star per indicator, ordered by slot), star shape by status (●▲◆○), readiness number in the centre. Used as the hero on the dashboard, as each crew member's identity on the Earth console, and on the crew-select cards (last status).
2. **Readiness orb**: shadcn radial chart, big number, one-line status, "vs your usual" delta.
3. **Health radar** (shadcn radar, 6 axes): today's polygon (solid accent) against the person's own 14-day polygon (dashed grey) — "you vs your usual".
4. **Vital cards** ×14 numeric/boolean + 2 text: value + unit, status pill with glyph, delta line ("▲ 1.7 h below your usual"), 14-day sparkline with the personal **baseline band** (mean ± 2 sd shaded) and today's point, `rangeText` micro-label ("Normal 7–… h · demo parameter"), `simulated` chip where the source is simulated. Symptoms collapse into one "Symptoms" card; BP into one "Blood pressure 124/82" card.
5. **Hazard lens**: five chips named by NASA's hazards (status-coloured, `not monitored here` hatched). Clicking a chip highlights and sorts the related vital cards and tasks, and opens a small card with one-sentence context and the nasa.gov/hrp source link. Caption: "Links are suggested, not official."
6. **Day arc**: Morning · Midday · Afternoon · Evening · Bedtime with ticks for what is logged and a "next" marker (from the *Daily flow* sheet).
7. **Today's plan**: 3–4 task cards, each "Do this" + "Because…" + hazard tag.
8. **Alerts strip** (only when present): calm text, "Alert, not a diagnosis. Your crew medical officer and ground have been informed (simulated link)." + acknowledge.
9. **Earth link card**: `online · last sent 14:07 · simulated delay 0 s` with a Live / 3 min / 20 min selector that only changes the simulated delay shown (workbook R-30 / Mars ≈ 20 min — verify the figure on the NASA HRP page before quoting it).
10. **Cosmo dock** bottom-right (brief §0.6–0.7): avatar, summary (1-line status, ≤ 2 findings, ≤ 2 recommendations, "Decision support, not a diagnosis."), replay button.
11. **Footer ribbon**: "Prototype — not a medical device. Thresholds are demo parameters, not clinical limits. History is simulated."

Layout (≥1280 px): header · row 1 [Constellation + Readiness orb | Radar | Alerts/Earth link] · row 2 hazard lens + day arc · row 3 today's plan · row 4 vitals grid (4 columns) · Cosmo dock fixed bottom-right. Mobile: single column, same order.

## 4. Earth console (read-only "ground" role)

`/earth`: header "Earth console — simulated link"; 4 crew cards (name, role, constellation glyph, overall pill, readiness, last check-in time, open alerts); an alerts list (newest first, level, text, time); a link-delay selector (Live / 3 min / 20 min) that **hides check-ins confirmed more recently than the delay** so the console visibly lags (simulation, labelled). Click a card → `/earth/[crewId]` renders the same `DashboardView` read-only (no Cosmo dock, no replay, no check-in controls). The ground role never sees conversation turns or free-text notes (`symptom_note`, `day_note`) — only values, statuses, summary and alerts. Privacy note shown on the page: "All data is sent automatically (team decision D-10); crew consent switch is a planned addition."

Routing/isolation (R-37): every ground response is keyed by `crewId`, tests assert that crew X's rows never appear in crew Y's payload, and that role `crew` can never call `/api/ground/*` while role `ground` can never call crew routes.

## 5. Data model changes to `PLAN.md` §3

- `measurement.source TEXT NOT NULL DEFAULT 'typed'` ∈ `typed|voice|simulated`; seeded history and scripted demo use `simulated`.
- New table `alert(id, crew_id, check_in_id, created_at, level, rule, text_json, acknowledged_at)`; a row is created on `SUMMARY` when `overall = red` (level `red`) and optionally for a notable yellow (not in Phase 1).
- Session cookie carries `{ role: "crew", crewId } | { role: "ground" }`; `POST /api/session` accepts `{ crewId }` or `{ role: "ground" }`.
- New routes: `GET /api/ground/crew?delayMs=` → `CrewStatusCard[]`; `GET /api/ground/crew/:crewId/dashboard?delayMs=` → `DashboardPayload` with `summary.spoken.text`/free-text values redacted; `GET /api/ground/alerts?delayMs=` → `AlertRow[]`; `POST /api/alerts/:id/ack` (crew role, own alerts only).
- Repos: ground reads use separately named functions (`groundListCrewStatus`, …) so no crew-scoped repo function ever drops its `crewId` parameter.

## 6. Seed data (4 crew, deterministic)

`bat` (MN, Flight engineer), `saraa` (MN, Mission specialist), `alex` (EN, Commander), `mira` (EN, Medical officer). 14 days each, source `simulated`, deterministic PRNG keyed by `avatarSeed`. Stories that make the dashboards interesting: **Bat** normal baseline (sleep ≈ 7.2 h, HR ≈ 66, BP ≈ 120/78, water ≈ 2300 ml); the scripted demo check-in is Bat today with sleep 5.5 h, mood 4, no symptoms, BP 124/82, HR 68, temp 36.7, glucose 98, water 1800 ml, exercise 40 min, vision clear, workload 3 → overall *Watch* (sleep and water) with 2 findings and 2 tasks. **Saraa** steady/green. **Alex** slow BP creep over the last 6 days (yesterday yellow). **Mira** yesterday's confirmed check-in has `symptom_headache = 1` and `vision_check = 1` → red flag `HEADACHE_PLUS_VISION` + an alert row, so the Earth console shows an alert from the start.

## 7. NASA references

`docs/sources.md` and `src/lib/nasa/hazards.ts` must cite: https://www.nasa.gov/hrp/hazards/ · https://www.nasa.gov/hrp/risks/ · https://www.nasa.gov/hrp/ongoing-hrp-research/ (listed in the workbook README). Hazard and risk names are copied from the fetched pages, not from memory; if a page cannot be fetched the file says so and the UI falls back to the workbook's wording.
