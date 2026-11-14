# AEGIS Phase 1 — "Cosmo" daily check-in + light dashboard: implementation plan

Status: plan only, no code written. Date: 2026-11-14.
Input: `PROMPT_PHASE1_COSMO.md` (the brief). There is no separate `CLAUDE.md`: the team confirmed on 2026-11-14 that the brief is the only source document, so this plan is built from it alone.

**Evidence convention used in this document**

- `[proof: …]` — checked during the planning session (command run, page fetched, file read).
- `{unverified}` — taken from memory or from the brief without an independent check; the step that must confirm it is named.
- Untagged statements are design decisions of this plan, not claims about the outside world.

Source keys:

| Key | What was checked |
|---|---|
| ENV | `node -v`, `pnpm -v`, `npm -v`, `corepack --version`, `git rev-parse --show-toplevel`, `ls` in the working folder, `find` for `CLAUDE.md` |
| NPM | `npm view <pkg> version license engines --json`, run 2026-11-14 |
| EL-STT | https://elevenlabs.io/docs/api-reference/speech-to-text/convert |
| EL-TTS | https://elevenlabs.io/docs/api-reference/text-to-speech/stream |
| EL-MODELS | https://elevenlabs.io/docs/models |
| EL-LIST | https://elevenlabs.io/docs/api-reference/models/list |
| EL-CAP | https://elevenlabs.io/docs/capabilities/speech-to-text |
| CA | Claude API reference bundled with Claude Code (model table cached 2026-11-03) |
| BRIEF | `PROMPT_PHASE1_COSMO.md`, by section number |

The five ElevenLabs pages were fetched by a sub-agent and reported back; EL-STT and EL-MODELS were truncated in transit, so every ElevenLabs fact below is re-confirmed against the live API in step S14 before it is relied on.

---

## 0. Findings that change the brief

### 0.1 Blockers and environment

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F1 | No `CLAUDE.md` in the working folder, Desktop, Downloads or Documents (search depth 4). | `[proof: ENV]` | Resolved: the team confirmed the brief is the single source. S0 copies it into the repo as `docs/BRIEF.md`. |
| F2 | The working folder contains only three `.mp4` files and sits inside a git repository whose root is the whole Desktop. | `[proof: ENV]` | "Commit after each step" would commit into a Desktop-wide repo. S0 creates a dedicated project folder with its own `git init`. |
| F3 | The working folder is under OneDrive. | `[proof: ENV]` | OneDrive syncing `node_modules` and a live SQLite file is a known source of file locks `{unverified}`. S0 puts the project outside OneDrive (e.g. `C:\dev\aegis`). |
| F4 | Installed Node is v20.10.0. Required: shadcn CLI 4.23.0 `>=20.18.1`; `@prisma/client` 7.10.1 `^20.19 \|\| ^22.12 \|\| >=24`; `better-sqlite3` 13.2.0 `>=22`; `vitest` 5.1.0 `^22.12 \|\| ^24 \|\| >=26`; `next` 16.4.6 `>=20.9.0`. | `[proof: ENV]`, `[proof: NPM]` | Node 20.10 fails four of five. S0 installs Node 22 LTS (≥ 22.18) or 24. |
| F5 | `pnpm` is not installed; `corepack` 0.22.0 and `npm` 10.9.1 are. | `[proof: ENV]` | S0 enables pnpm. |

### 0.2 Service facts that differ from the brief

| # | Brief says | Docs say | Plan |
|---|---|---|---|
| F6 | "Use model `eleven_v3` for Mongolian" (BRIEF §1). | `eleven_v3` lists Mongolian (mn) and has a 5,000-character limit, but is labelled "previous generation"; `eleven_v4`, `eleven_v4_turbo` (~100 ms median) and `eleven_v3_conversational` (~165 ms) also list Mongolian. `eleven_multilingual_v2` and `eleven_flash_v2_5` do **not** list it. `[proof: EL-MODELS]` | Default stays `eleven_v3` as briefed, overridable by env. S14 runs a 10-minute listening comparison against `eleven_v4_turbo`; a Mongolian speaker picks. **Team decision D1.** |
| F7 | "ElevenLabs Scribe (supports Mongolian)". | Mongolian (`mon`) is supported, in the "Moderate (>25% to ≤50% WER)" accuracy tier for Scribe v2; tier for Scribe v3 not stated. `[proof: EL-CAP]` | Up to half the words may be wrong. This is the largest product risk (R1); mitigations are designed in (§4.5, §8). |
| F8 | "Use the returned language code to decide the reply language." | Response has `text`, `language_code`, `language_probability`; the page is inconsistent on format (`eng` in the field description, `en` in the example). `[proof: EL-STT]` | Reply language is decided by our code from the transcript's script (Cyrillic → `mn`, Latin → `en`), with Scribe's code as a tiebreaker. Both 2- and 3-letter codes are normalised. |
| F9 | Brief implies Claude can be steered tool-by-tool. | On `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-fable-5-2`, forced `tool_choice` (`any` / `tool`) returns HTTP 400; `temperature`/`top_p`/`top_k` return 400; thinking cannot be disabled on Opus 5.5 and its default effort is `medium`. `[proof: CA]` | Use `tool_choice: auto` + `strict: true` tools + a per-turn directive; set `output_config.effort: "low"`; send no sampling params. |
| F10 | "Check the current ElevenLabs docs … before coding". | STT: `POST /v1/speech-to-text`, header `xi-api-key`, multipart field `file`, `model_id` required (examples show `scribe_v2`; `scribe_v3` is mentioned), optional `language_code`. `[proof: EL-STT]` TTS: `POST /v1/text-to-speech/{voice_id}/stream`, `output_format` default `mp3_44100_128`. `[proof: EL-TTS]` Models: `GET /v1/models`, each with a `languages[]` of `{language_id, name}`. `[proof: EL-LIST]` Whether `eleven_v3` works on the `/stream` endpoint is not stated. `[proof: EL-TTS]` | Endpoints fixed as listed; `/stream` + `eleven_v3` is tested first thing in S14, with the non-streaming endpoint as fallback. |

### 0.3 Decisions needed from the team

| ID | Decision | Default if nobody answers |
|---|---|---|
| D1 | Mongolian TTS model: `eleven_v3` (brief) vs `eleven_v4_turbo` (faster, newer). | `eleven_v3`, env-overridable. |
| D2 | Claude model in `ANTHROPIC_MODEL`. The reference default is `claude-opus-5-5`; `claude-haiku-5-5` and `claude-sonnet-5-5` are the lower-latency options. `[proof: CA]` Their real latency for this app is `{unverified}` until S12 measures it. | `claude-opus-5-5`, effort `low`. |
| D3 | Persistence: Prisma or better-sqlite3 (BRIEF §1 allows both). | better-sqlite3 + repo layer (§3). |
| D4 | Clinical thresholds in §7.3 are placeholders. A named person must confirm or replace them with cited values. | Ship placeholders, labelled as such in `docs/sources.md`. |
| D5 | Which crew member and language the scripted demo uses. | Bat, Mongolian, with the EN toggle shown once. |

---

## 1. Architecture in one page

```
Browser (Next.js client)
  CrewSelect → CheckInExperience (conversation view ⇄ dashboard view)
    useRecorder (MediaRecorder + VAD)         useSpeechPlayer (<audio> + AnalyserNode → amplitude)
        │ audio blob / text                         ▲ audio/mpeg stream
        ▼                                           │
POST /api/checkins/:id/turn  ── SSE ──▶  events     GET /api/checkins/:id/turns/:turnId/audio
        │
Server (route handlers, Node runtime)
  session (httpOnly cookie → crewId)
  speech/stt ──▶ ElevenLabs Scribe
  agent/machine  (pure reducer: state + event → state + effects)   ← decides what happens next
  agent/Agent    (interface)  ├─ ClaudeAgent   → Anthropic Messages API, tool use
                              └─ ScriptedAgent → fixture script (DEMO_MODE=scripted)
  agent/tools    (validate → persist → emit)                       ← only place that writes measurements
  lib/health     (baseline, flags, scores, summary findings)       ← all medical numbers
  db/repos       (every function takes crewId first)               ← only place that touches SQLite
  speech/tts ──▶ ElevenLabs TTS (stream)
```

Design rules that hold everywhere:

1. **The LLM phrases; code decides and computes.** Claude never produces a number that reaches the UI or the DB without passing a validator in `agent/tools.ts`, and never computes a comparison (BRIEF §4).
2. **One code path for live and scripted.** `DEMO_MODE=scripted` swaps three adapters (STT, agent, TTS source). The state machine, tool handlers, DB writes, SSE events and the entire UI are the same code. What is mocked is therefore exactly those three adapters.
3. **`crewId` comes from the session cookie only**, never from a request body or query string. Repos require it as the first argument.
4. **Pure logic lives in `src/lib`** (no I/O, no Next imports) so the required tests run in plain Vitest.

---

## 2. Folder structure

```
aegis/
├─ README.md
├─ .env.example
├─ package.json  pnpm-lock.yaml  tsconfig.json  next.config.ts  vitest.config.ts  components.json
├─ data/                         # aegis.db — gitignored
├─ docs/
│  ├─ BRIEF.md                   # copy of PROMPT_PHASE1_COSMO.md — the single source document
│  ├─ PLAN.md
│  └─ sources.md
├─ public/
│  ├─ cosmo.riv                  # optional; designer drops it in later
│  └─ demo/audio/                # pre-generated clips: mn-00.mp3 … en-00.mp3 …
├─ scripts/
│  ├─ seed.ts                    # 3 crew + 14 days of history each
│  ├─ gen-demo-audio.ts          # one-off, needs network + ElevenLabs key
│  └─ probe-elevenlabs.ts        # prints model/language support
├─ src/
│  ├─ instrumentation.ts         # startup hook: env check + ElevenLabs model probe + log
│  ├─ app/
│  │  ├─ layout.tsx  globals.css
│  │  ├─ page.tsx                # crew select
│  │  ├─ checkin/page.tsx        # hosts CheckInExperience
│  │  ├─ dashboard/page.tsx      # deep link / reload: latest confirmed check-in
│  │  ├─ dev/cosmo/page.tsx      # avatar playground (state, emotion, amplitude sliders)
│  │  └─ api/
│  │     ├─ health/route.ts
│  │     ├─ crew/route.ts
│  │     ├─ session/route.ts
│  │     ├─ checkins/route.ts
│  │     ├─ checkins/[id]/route.ts
│  │     ├─ checkins/[id]/turn/route.ts
│  │     ├─ checkins/[id]/turns/[turnId]/audio/route.ts
│  │     └─ dashboard/route.ts
│  ├─ components/
│  │  ├─ ui/                     # shadcn/ui primitives + chart
│  │  ├─ shell/                  # AppHeader, LanguageToggle, FallbackBanner
│  │  ├─ cosmo/                  # CosmoAvatar, PlaceholderCosmo, RiveCosmo, variants.ts
│  │  ├─ crew/                   # CrewSelect, CrewCard
│  │  ├─ checkin/                # CheckInExperience, ConversationView, TranscriptPanel,
│  │  │                          # KpiCardRail, KpiCard, MicButton, TextFallbackInput, RunDemoButton
│  │  └─ dashboard/              # DashboardView, DashboardHeader, KpiGrid, KpiStatCard,
│  │                             # Sparkline, HealthRadar, ReadinessRadial, CosmoDock
│  ├─ hooks/
│  │  ├─ useCheckIn.ts           # SSE client + reducer for the whole conversation
│  │  ├─ useRecorder.ts          # MediaRecorder + VAD + push-to-talk
│  │  ├─ useSpeechPlayer.ts      # <audio> playback, speechSynthesis fallback
│  │  └─ useAudioAmplitude.ts    # AnalyserNode → 0–1
│  ├─ i18n/
│  │  ├─ dictionary.ts           # { mn: {...}, en: {...} } — all UI strings
│  │  └─ I18nProvider.tsx
│  ├─ lib/                       # pure, isomorphic, unit-tested
│  │  ├─ kpi/registry.ts         # single source of truth for the KPI table
│  │  ├─ kpi/types.ts
│  │  ├─ numbers/mn.ts           # Mongolian number-words parser
│  │  ├─ numbers/extract.ts      # digits + words → candidate numbers in a text
│  │  ├─ language.ts             # script-based mn/en decision
│  │  ├─ health/baseline.ts  flags.ts  scores.ts  summary.ts  recommendations.ts
│  │  └─ sse.ts                  # event types shared by server and client
│  └─ server/                    # `import "server-only"`
│     ├─ env.ts                  # zod-validated env, DEMO_MODE
│     ├─ session.ts              # signed cookie ⇄ crewId
│     ├─ db/client.ts  schema.sql
│     ├─ db/repos/crew.ts  checkin.ts  measurement.ts  turn.ts
│     ├─ agent/machine.ts        # pure reducer
│     ├─ agent/tools.ts          # tool schemas + handlers
│     ├─ agent/directive.ts      # per-turn instruction built by code
│     ├─ agent/prompt.ts         # Cosmo system prompt (frozen text)
│     ├─ agent/agent.ts          # Agent interface
│     ├─ agent/claudeAgent.ts
│     ├─ agent/scriptedAgent.ts
│     ├─ agent/scripts/demo.mn.ts  demo.en.ts
│     └─ speech/stt.ts  tts.ts  elevenlabs.ts  probe.ts
└─ tests/
   ├─ numbers.mn.test.ts
   ├─ baseline.test.ts  flags.test.ts  scores.test.ts
   ├─ machine.test.ts
   ├─ isolation.test.ts
   └─ scripted-flow.test.ts
```

Package set and licences `[proof: NPM]`: `next` 16.4.6 MIT · `react` 19.3.1 MIT · `tailwindcss` 4.3.5 MIT · `shadcn` CLI 4.23.0 MIT · `recharts` 3.10.1 MIT · `framer-motion` 14.14.0 MIT · `@rive-app/react-canvas` 4.39.0 MIT · `@anthropic-ai/sdk` 1.8.0 Apache-2.0 · `@elevenlabs/elevenlabs-js` 2.78.0 MIT · `better-sqlite3` 13.2.0 MIT · `vitest` 5.1.0 MIT · `zod` 4.6.7 MIT.

`.env.example`:

```
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-5-5
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID_MN=
ELEVENLABS_VOICE_ID_EN=
# optional
DEMO_MODE=live                      # live | scripted
ELEVENLABS_TTS_MODEL_MN=eleven_v3
ELEVENLABS_TTS_MODEL_EN=            # empty = chosen by startup probe
ELEVENLABS_STT_MODEL=scribe_v2
SESSION_SECRET=                     # empty = random per process (sessions reset on restart)
MISSION_START_DATE=2026-10-01
```

---

## 3. Data model

SQLite file `data/aegis.db`, accessed through better-sqlite3 behind a repo layer (D3). Reason for the default: the repo layer is where the `crewId` rule is enforced and tested, there is no code-generation step, and the schema is four tables. Prisma remains a drop-in alternative behind the same repo functions.

```sql
CREATE TABLE crew_member (
  id                 TEXT PRIMARY KEY,          -- 'bat', 'saraa', 'alex'
  name               TEXT NOT NULL,
  role               TEXT NOT NULL,
  preferred_language TEXT NOT NULL CHECK (preferred_language IN ('mn','en')),
  mascot_variant     INTEGER NOT NULL,
  avatar_seed        TEXT NOT NULL
);

CREATE TABLE check_in (
  id            TEXT PRIMARY KEY,
  crew_id       TEXT NOT NULL REFERENCES crew_member(id),
  started_at    TEXT NOT NULL,                 -- ISO-8601 UTC
  confirmed_at  TEXT,
  language      TEXT NOT NULL,
  summary_json  TEXT,
  state         TEXT NOT NULL DEFAULT 'GREETING',   -- addition, see below
  state_json    TEXT NOT NULL DEFAULT '{}'           -- addition, see below
);
CREATE INDEX idx_checkin_crew_time ON check_in (crew_id, started_at);

CREATE TABLE measurement (
  id           TEXT PRIMARY KEY,
  check_in_id  TEXT NOT NULL REFERENCES check_in(id),
  crew_id      TEXT NOT NULL REFERENCES crew_member(id),
  key          TEXT NOT NULL,
  value        REAL,                           -- numbers; booleans as 0/1
  value_text   TEXT,                           -- addition: free text for `notes`
  unit         TEXT,
  source_text  TEXT,
  confidence   REAL,
  created_at   TEXT NOT NULL,
  UNIQUE (check_in_id, key)                    -- a correction updates the row
);
CREATE INDEX idx_measurement_crew_key ON measurement (crew_id, key, created_at);

CREATE TABLE turn (
  id           TEXT PRIMARY KEY,
  check_in_id  TEXT NOT NULL REFERENCES check_in(id),
  speaker      TEXT NOT NULL CHECK (speaker IN ('crew','cosmo','system')),
  text         TEXT NOT NULL,
  language     TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
```

Additions to BRIEF §5, each needed for a stated requirement:

| Addition | Why |
|---|---|
| `check_in.state`, `check_in.state_json` | The server state machine must survive between HTTP requests. `state_json` holds `{ smallTalkTurns, proposed, clarifyCount: {key: n}, skipped: [keys] }`. |
| `measurement.value_text` | `notes` is free text; everything else fits `REAL`. |
| `UNIQUE (check_in_id, key)` | "update that card" on correction (BRIEF §0.5); the audit trail of what was said is the `turn` log. |
| speaker value `system` | Logs tool calls and validator rejections as turns, so the DB shows why a value was accepted or refused. |

Stored keys (16, from the 14 questions in BRIEF §3): the blood-pressure question writes `bp_systolic` and `bp_diastolic`; the headache question writes `headache` (0/1) and, when 1, `headache_severity` (0–10).

**Repo contract.** Every exported function has `crewId` as its first parameter and puts it in the `WHERE` clause, including lookups by primary key: `getCheckIn(crewId, checkInId)` returns `null` for another member's id. No repo exports a function that reads health data without `crewId`. `listCrew()` returns roster fields only.

**Seed.** Three members (two `mn`, one `en`). For each, 14 confirmed check-ins on the 14 days before today, values drawn from a per-member profile (mean, sd per KPI) with a deterministic PRNG keyed by `avatar_seed`, so tests and demo deltas are reproducible. Baselines are computed from these rows at read time, never stored.

---

## 4. Server state machine

### 4.1 States and transitions

`machine.ts` exports a pure function `transition(ctx, event) → { ctx, effects[] }`. No I/O; effects are data (`persistMeasurement`, `emit`, `computeSummary`, …) executed by the route handler.

| State | On entry | Event | Guard | Next |
|---|---|---|---|---|
| `GREETING` | Greeting text rendered **from the i18n template in code** (exact wording from BRIEF §0.2, zero LLM latency), logged as a Cosmo turn. | `USER_TURN` | — | `SMALL_TALK` |
| `SMALL_TALK` | — | `USER_TURN` | `smallTalkTurns < 1` and reply is not a request to start | stay; Cosmo replies warmly |
| | | `USER_TURN` | otherwise | stay, `proposed = true`; directive tells Cosmo to propose measurements |
| | | `USER_TURN` | `proposed` and reply is not an explicit refusal (`үгүй`, `дараа`, `no`, `later`, `not now`) | `KPI_CAPTURE` |
| | | `USER_TURN` | `proposed` and explicit refusal | stay; Cosmo acknowledges and offers again |
| `KPI_CAPTURE` | Cursor = first KPI in §3 order that has no value and is not skipped. | `MEASUREMENT_ACCEPTED` | KPIs remain | stay; cursor recomputed |
| | | `MEASUREMENT_ACCEPTED` | none remain | `CONFIRM` |
| | | `MEASUREMENT_REJECTED` / `CLARIFICATION` | `clarifyCount[key] < 2` | stay; same cursor |
| | | `MEASUREMENT_REJECTED` / `CLARIFICATION` | `clarifyCount[key] ≥ 2` | mark skipped, advance (Cosmo says it can be added at confirmation) |
| `CONFIRM` | Read-back list built **by code** from stored values; Cosmo asks "Бүгд зөв үү?" / "Is everything correct?" | `CORRECTION_ACCEPTED` | — | stay; card updated, ask again |
| | | `CONFIRMATION(false)` | no correction given | stay; Cosmo asks what to change |
| | | `CONFIRMATION(true)` | — | `SUMMARY` |
| `SUMMARY` | Code runs baseline → flags → scores → findings, stores `summary_json`, sets `confirmed_at`. Cosmo phrases the findings. | `SUMMARY_SPOKEN` | — | `DONE` |
| `DONE` | — | `USER_TURN` | — | stay; short closing reply, all write tools refused |

Values volunteered early are accepted in any pre-`CONFIRM` state, which is how "Cosmo may skip a question the astronaut already answered" (BRIEF §3) works: the cursor simply never lands on a filled key.

### 4.2 Tools (constant list, strict schemas)

The same six tools are sent on every request so the request prefix stays byte-stable; the machine refuses calls that are illegal in the current state by returning an error `tool_result`, instead of varying the tool list. Reason: the cache prefix is ordered `tools → system → messages` and any change in it invalidates the cache `[proof: CA]`.

| Tool | Input | Handler (code) | Legal in |
|---|---|---|---|
| `record_measurement` | `key, value, unit, source_text, confidence` | Validate key, type, unit, range (§7.1); cross-check `value` against numbers found in `source_text` (§4.5); upsert; emit `measurement`. | `SMALL_TALK`, `KPI_CAPTURE` |
| `request_clarification` | `key, reason` | Increment `clarifyCount`; emit `clarification`. | `KPI_CAPTURE`, `CONFIRM` |
| `correct_measurement` | `key, value` | Same validation; upsert; emit `measurement` with `status: "corrected"`. | `CONFIRM` |
| `get_baseline` | — (`crewId` injected from session, never from the model) | 14-day mean/sd per KPI. | any |
| `finish_confirmation` | `confirmed: boolean` | Raise `CONFIRMATION`; when `true`, the tool result already contains the `compose_summary` payload. | `CONFIRM` |
| `compose_summary` | — | Returns `SummaryFindings` (§7.5) computed by code. | `SUMMARY`, `DONE` |

`get_baseline` and `compose_summary` are exposed as BRIEF §4 requires, but the machine pre-computes and injects their results on entering `SUMMARY`, which saves one model round trip. If the model calls them anyway it gets the same data.

### 4.3 What the model receives each turn

1. Frozen system prompt (`prompt.ts`): Cosmo's persona and rules from BRIEF §4, the KPI table with ranges, and the tool-use rules. Never interpolated.
2. The last 20 turns (BRIEF §4).
3. A **directive** built by code and attached after the cached prefix: `{ state, replyLanguage, expectedKpi, missingKpis[], recordedKpis{…}, pendingClarification, instruction }`. Mid-conversation `role: "system"` messages are supported on Opus 5.5, Sonnet 5.5 and Haiku 5.5 without a beta header `[proof: CA]`; if the configured model rejects them, the directive is sent as a text block in the user turn instead.

Request settings: streaming; `tool_choice: auto`; `strict: true` on every tool; `output_config.effort: "low"`; no `temperature`/`top_p`/`top_k`; no assistant prefill; `stop_reason` checked for `refusal` and `max_tokens` before any tool runs; refusal fallbacks enabled (`fallbacks: "default"` with beta `server-side-fallback-2026-07-01`) `[proof: CA]`. All `tool_result` blocks for one assistant message go back in a single user message `[proof: CA]`.

### 4.4 One model call per turn (latency design)

A naïve tool loop costs two model calls per spoken turn (call → tool results → call again for the reply). The plan avoids that on the happy path:

- The directive tells the model to emit, in one assistant message, its short spoken reply **and** the tool calls: "record what you heard, acknowledge in a few words, then ask about the first key in `missingKpis` you did not just record".
- The server validates the tool calls. If all pass, the turn ends there; the `tool_result` blocks are stored and sent at the start of the next user message.
- Only if a call is rejected does the server make a second call with the error results, and the first reply is discarded (it has not been spoken yet, because TTS starts only after validation).

Whether `tool_result` blocks may share a user message with the next utterance is `{unverified}`; S12 confirms it against the SDK reference before building on it. Fallback: the classic two-call loop.

### 4.5 Defence against wrong transcripts (R1)

Because Mongolian STT may be 25–50 % wrong (F7), a value reaches a card only if:

1. the model's `value` is in range for the key, **and**
2. `source_text` is a substring of the transcript, **and**
3. the number our own parser extracts from `source_text` (digits, or Mongolian/English number words) equals `value`; if the parser finds no number, the value is accepted with `confidence` capped at 0.6 and the card shows an "unconfirmed" dot.

On disagreement the tool returns an error and Cosmo asks a short clarification. The `CONFIRM` read-back and the always-visible transcript are the last line of defence. When the crew member's preferred language is `mn`, the STT request sends `language_code` as a hint; the reply language still comes from the script check (F8).

---

## 5. API contracts

All routes run on the Node runtime. JSON errors use `{ "error": { "code": string, "message": string } }`. Codes: `NO_SESSION` 401 · `NOT_FOUND` 404 (also returned for another member's resource) · `BAD_INPUT` 400 · `STT_FAILED` 502 · `LLM_FAILED` 502 · `TTS_FAILED` 502 · `WRONG_STATE` 409.

| Method + path | Request | Response |
|---|---|---|
| `GET /api/health` | — | `{ mode, llm: {model}, stt: {model, available}, tts: {mn: {model, available}, en: {model, available}}, rive: boolean }` |
| `GET /api/crew` | — | `CrewPublic[]` — `{ id, name, role, preferredLanguage, mascotVariant, avatarSeed }`. No health data. |
| `POST /api/session` | `{ crewId }` | `204`, sets httpOnly, SameSite=Lax, HMAC-signed cookie `aegis_session`. |
| `DELETE /api/session` | — | `204` |
| `POST /api/checkins` | `{ language? }` | `{ checkInId, state: "GREETING", language, greeting: { turnId, text } }`. Resumes today's unconfirmed check-in if one exists. |
| `GET /api/checkins/:id` | — | `{ checkIn, measurements[], turns[] }` for reload/resume. |
| `POST /api/checkins/:id/turn` | `multipart/form-data` with `audio` (blob), **or** `application/json` `{ text }` | `text/event-stream` (below) |
| `GET /api/checkins/:id/turns/:turnId/audio` | — | `audio/mpeg`, streamed. Looks the text up from the `turn` row, so no text travels in a URL. Used for live playback and for the replay button. |
| `GET /api/dashboard?checkInId=` | — | `DashboardPayload` (below). Defaults to the latest confirmed check-in. |

This is isolation between crew members inside one app, not authentication: anyone at the keyboard can pick any member on the start screen. That is the briefed flow (BRIEF §0.1); a PIN is out of scope for Phase 1.

### 5.1 Turn stream events

```ts
type TurnEvent =
  | { type: "transcript";    turnId: string; text: string; language: "mn" | "en" }
  | { type: "state";         state: ConversationState; expectedKpi?: KpiKey }
  | { type: "measurement";   key: KpiKey; value: number | string | boolean; unit: string | null;
                             sourceText: string; confidence: number; status: "recorded" | "corrected" }
  | { type: "clarification"; key: KpiKey; reason: string }
  | { type: "assistant";     turnId: string; text: string; language: "mn" | "en";
                             emotion: "neutral" | "happy" | "concerned" }
  | { type: "summary";       summary: SummaryPayload }
  | { type: "timing";        sttMs: number; llmMs: number; totalMs: number }
  | { type: "error";         code: string; message: string; recoverable: boolean }
  | { type: "done" };
```

Order within a turn: `transcript` → (`measurement` | `clarification`)* → `state` → `assistant` → `summary`? → `timing` → `done`. The client switches Cosmo to `thinking` the moment the utterance ends, before any event arrives (BRIEF §8). `emotion` is set by code: `concerned` for a red flag or an out-of-range clarification, `happy` for greeting and confirmation, otherwise `neutral`.

### 5.2 Summary and dashboard payloads

```ts
type Finding = { key: KpiKey; value: number; unit: string; baselineMean: number | null;
                 baselineSd: number | null; z: number | null;
                 reason: "baseline" | "safety_range"; direction: "high" | "low" };

type SummaryFindings = {                       // computed by code, stored in summary_json
  overall: "nominal" | "watch" | "attention";
  readiness: number;                           // 0–100
  notable: Finding[];                          // max 2, ranked by severity
  recommendations: RecommendationKey[];        // max 2, from a rules table
  redFlags: RedFlagKey[];
};

type SummaryPayload = SummaryFindings & {
  text: string;                                // phrased by Claude, or by template
  disclaimer: string;                          // appended by code, never left to the model
  audioTurnId: string;
};

type DashboardPayload = {
  crew: CrewPublic; missionDay: number; checkInId: string; confirmedAt: string;
  kpis: Array<{ key: KpiKey; value: number | string | boolean; unit: string | null;
                baselineMean: number | null; delta: number | null;
                status: "ok" | "notable" | "red"; history: Array<{ date: string; value: number }> }>;
  radar: Array<{ axis: RadarAxis; score: number }>;   // 6 axes, 0–100
  readiness: number;
  summary: SummaryPayload;
};
```

---

## 6. Component tree

```
RootLayout
└─ I18nProvider                               # mn | en, persisted per viewer
   ├─ AppHeader ─ LanguageToggle
   ├─ FallbackBanner                          # small, non-blocking: "voice unavailable — using text"
   │
   ├─ / ─ CrewSelect
   │        └─ CrewCard ×3 ─ CosmoAvatar(variant, state="idle")
   │
   ├─ /checkin ─ CheckInExperience            # owns useCheckIn; view = "conversation" | "dashboard"
   │   ├─ ConversationView
   │   │   ├─ CosmoStage ─ CosmoAvatar        # 60–70% height; motion layoutId="cosmo"
   │   │   ├─ TranscriptPanel                 # live transcript under Cosmo
   │   │   ├─ KpiCardRail                     # right on desktop, below on mobile
   │   │   │   └─ KpiCard ×n                  # label · value · unit · "from your words: …"
   │   │   └─ ControlBar
   │   │       ├─ MicButton                   # idle / listening / thinking / speaking
   │   │       ├─ TextFallbackInput
   │   │       └─ RunDemoButton               # rendered only when mode = scripted
   │   └─ DashboardView
   │       ├─ DashboardHeader                 # crew member + mission day
   │       ├─ KpiGrid ─ KpiStatCard ×n ─ Sparkline
   │       ├─ HealthRadar                     # shadcn chart (Recharts RadarChart), 6 axes
   │       ├─ ReadinessRadial                 # shadcn chart (RadialBarChart)
   │       └─ CosmoDock                       # bottom-right; same layoutId="cosmo"
   │           ├─ CosmoAvatar
   │           ├─ SummaryCard                 # status line · ≤2 findings · ≤2 recommendations · disclaimer
   │           └─ ReplayButton
   │
   ├─ /dashboard ─ DashboardView              # from GET /api/dashboard
   └─ /dev/cosmo ─ avatar playground
```

`CosmoAvatar` contract (BRIEF §6), identical for both implementations:

```ts
type CosmoProps = {
  variant: number;                                         // per crew member
  state: "idle" | "listening" | "thinking" | "talking";
  emotion: "neutral" | "happy" | "concerned";
  amplitude: number;                                       // 0–1
  size?: number;
};
```

- `CosmoAvatar` picks the implementation. `hasRive` is decided on the server (`fs.existsSync("public/cosmo.riv")`) and passed down, so there is no client probe request; `RiveCosmo` is loaded with a dynamic import so the Rive runtime is not shipped when the file is absent.
- `PlaceholderCosmo`: an original rounded SVG character; blink on a randomised timer, mouth height driven by `amplitude`, slow scale "breathing" in `idle`, slight head tilt in `listening`, slow opacity pulse in `thinking`. `variant` changes accent colour and one face detail.
- `RiveCosmo`: state machine `Cosmo`; inputs `isTalking`, `isListening`, `isThinking` (bool), `emotion` (0/1/2), `mouthOpen` (0–100 = `amplitude × 100`), `variant` (number) — exactly as BRIEF §6.
- The conversation → dashboard transition is one shared element: both views render `CosmoAvatar` inside a `motion.div` with `layoutId="cosmo"`, so Cosmo travels to the corner while `DashboardView` fades and slides in. It fires on the `state: SUMMARY` event; the summary audio then plays from the dock.

Hooks: `useRecorder` is half-duplex (the mic is closed while Cosmo speaks, so Cosmo never transcribes itself); VAD ends an utterance after 900 ms below an RMS threshold, with a 300 ms minimum and 30 s maximum; push-to-talk is the fallback (BRIEF §1). `useSpeechPlayer` plays the same-origin audio URL through an `<audio>` element wired to a `MediaElementAudioSourceNode` → `AnalyserNode`, which `useAudioAmplitude` turns into the 0–1 value.

Visual system: light theme; background white / very light grey; one accent colour; shadcn radius and spacing tokens; base type size raised for projector legibility; no gradients or decorative chrome (BRIEF §7).

---

## 7. Domain logic (all in `src/lib`, all unit-tested)

### 7.1 KPI registry

One table drives the prompt text, the validators, the cards, the read-back, the dashboard and the seed: `{ key, questionIntent{mn,en}, type, unit, min, max, order, radarAxis, higherIsBetter, parentQuestion? }`. Ranges are exactly BRIEF §3.

### 7.2 Mongolian number-words parser

Scope from BRIEF §2: integers 0–200 and decimals such as "гуч зургаа аравны тав" → 36.5.

- Tokens: units, tens, `зуу/зуун`, in both the bare form and the attributive form ending in `-н` (e.g. `долоо` / `долоон`).
- Grammar: `[hundred] [tens] [unit]`, then optional fraction `аравны <unit>` (tenths); also `хагас` (half) after a unit of measure, and digits anywhere ("7 цаг", "98").
- API: `parseMnNumber(text): number | null` and `extractNumbers(text): Array<{ value, start, end }>`.
- Tests: the two brief examples ("долоон цаг" → 7, "ерэн найм" → 98); a generated round-trip for every integer 0–200 in both forms; decimals; digits mixed with words; negatives (no number present).

The word list and the fraction grammar above are from memory `{unverified}`. A Mongolian speaker on the team reviews the test table in S3 before the parser is trusted.

### 7.3 Baseline and flags

- `baseline(history) → { mean, sd, n }` per KPI over the 14 days before today, today excluded. `n < 5` → no baseline, safety range only.
- **Notable** when `|value − mean| > 2 × max(sd, sdFloor[key])` (the floor prevents a near-constant history from flagging trivia) or when outside the fixed safety range (BRIEF §4).
- **Red flags** (Cosmo calmly says the crew medical officer and ground should be informed): `spo2 < 90`; `vision_change && headache` — both from BRIEF §4.

Safety ranges — **placeholders pending D4**, all `{unverified}`: SpO2 < 94 %; resting HR < 40 or > 100 bpm; systolic < 90 or ≥ 140 mmHg; diastolic < 60 or ≥ 90 mmHg; sleep < 6 h; headache severity ≥ 7; back pain ≥ 7; mood ≤ 3; fatigue ≥ 8.

### 7.4 Scores

- KPI sub-score 0–100: `100 − 25 × min(|z|, 4)` in the unfavourable direction only; a value outside its safety range is capped at 50; without a baseline, distance from a target value is used.
- Radar axes: Sleep (`sleep_hours`, `sleep_quality`) · Cardiovascular (`resting_hr`, `bp_*`, `spo2`) · Musculoskeletal (`back_pain`, `body_mass`, `exercise_resistive_min`) · Neuro-ocular (`headache`, `headache_severity`, `vision_change`) · Behavioral (`mood`, `fatigue`) · Activity (`exercise_resistive_min`, `exercise_aerobic_min` against a daily target). Axis = mean of its sub-scores.
- Readiness = mean of the six axes, capped at 60 when any red flag is present.

The formula is a transparent heuristic for decision support, stated as such in the README; it is not a validated clinical score.

### 7.5 Summary

`composeSummary()` produces `SummaryFindings`: `overall` from flags, the two most severe notables, and up to two recommendations from a rules table keyed by finding (e.g. low sleep → earlier wind-down; missed resistive exercise → reschedule the session). Claude receives this object and phrases it in the reply language. Before it is shown, code checks that every numeral in Claude's text appears in the findings; on any mismatch, on refusal, or on API failure, the template-rendered summary is used instead. "Decision support, not a diagnosis." (and its Mongolian equivalent from the dictionary) is appended by code.

---

## 8. Risk list

| ID | Risk | L | I | Mitigation | Where |
|---|---|---|---|---|---|
| R1 | Mongolian STT is in the 25–50 % WER tier (F7); spoken numbers are misheard. | High | High | Three-way value check (§4.5); always-visible transcript; `CONFIRM` read-back; `language_code` hint; try `scribe_v3`; text input always available; scripted demo does not depend on STT. | S5, S13 |
| R2 | End-of-speech → audio exceeds ~2.5 s (STT + thinking-always-on model + TTS). | High | Med | One model call per turn (§4.4); effort `low`; templated greeting; TTS streamed; `thinking` state shown instantly; per-turn `timing` event so the bottleneck is measured, not guessed; D2 as the lever. | S12–S14 |
| R3 | `eleven_v3` is not accepted on `/stream`, or is too slow (F6, F10). | Med | Med | Tested first in S14; fallback to the non-streaming endpoint or `eleven_v4_turbo` (D1). | S14 |
| R4 | Network or API failure during the live demo. | Med | High | `DEMO_MODE=scripted` runs with zero network on the real pipeline; clips are committed; runtime fallback to `speechSynthesis` + text box + banner (BRIEF §8). | S11, S14 |
| R5 | No Mongolian `speechSynthesis` voice on the demo laptop `{unverified}`. | High | Low | Fallback for `mn` is text plus a timed mouth animation; pre-generated clips cover the scripted path. | S14 |
| R6 | Node 20.10 breaks installs (F4). | Certain | High | S0 upgrades Node before anything else. | S0 |
| R7 | Project inside OneDrive / Desktop-wide git repo (F2, F3). | Certain | Med | S0 creates a separate folder and repo. | S0 |
| R8 | `better-sqlite3` native build fails on Windows `{unverified}`. | Low | Med | Switch the repo layer to Prisma or Node's built-in `node:sqlite` `{unverified}`; only `db/client.ts` changes. | S2 |
| R9 | Model asks the wrong next question or drifts in tone. | Med | Low | Code-built directive every turn; cursor is recomputed from stored data, so a wrong question self-corrects next turn; refused tool calls return a reason. | S12 |
| R10 | Model states a number that code did not compute. | Low | High | Numeral check + template fallback (§7.5); disclaimer appended by code. | S4, S12 |
| R11 | A member sees another member's data. | Low | High | Cookie-only `crewId`; `crewId`-first repos; repo-level and route-level tests. | S2, S6 |
| R12 | 14 questions by voice take 3–4 minutes — too long for a judged demo. | High | Med | The demo script has the astronaut give several values per utterance, target ≤ 90 s to dashboard. | S5, S11 |
| R13 | Mic permission, echo, or noisy room at the venue. | Med | Med | Half-duplex; push-to-talk; text input; headset recommended in README. | S13 |
| R14 | Thresholds and score formula are not clinically sourced (D4). | Certain | Med | Labelled placeholders; "decision support" line; `docs/sources.md` records the gap honestly. | S4, S16 |
| R15 | Rive file arrives late or with different input names. | Med | Low | Placeholder is the default; `RiveCosmo` maps inputs in one file; README documents the contract. | S15 |
| R16 | Scope exceeds 6–8 h (§9 totals ≈ 10 h sequential). | High | High | Milestone A (offline demo) first; two parallel lanes; explicit cut list. | §9 |

L = likelihood, I = impact; both are planning judgements, not measurements.

---

## 9. Step-by-step task list

Each step is ≤ 45 min, leaves `main` runnable, and ends with a commit. Estimates are planning judgements. "Accept" is a check someone can run and see pass or fail.

### Milestone A — complete offline demo (S0–S11, ≈ 7 h sequential)

| # | Step | Est. | Accept |
|---|---|---|---|
| S0 | **Environment.** Install Node 22 LTS (≥ 22.18); enable pnpm; create the project folder outside OneDrive; `git init`; copy the brief (`docs/BRIEF.md`) and this plan (`docs/PLAN.md`) into it. | 20 m | `node -v` ≥ 22.18; `pnpm -v` prints a version; `git rev-parse --show-toplevel` prints the project folder. |
| S1 | **Scaffold.** Next.js App Router + TS + Tailwind; `shadcn init` and add `button card badge input toggle-group alert chart`; framer-motion; Vitest; `server/env.ts` with zod; `.env.example`. | 30 m | `pnpm dev` serves `/`; `pnpm test` runs one passing test; `pnpm build` succeeds; app boots with an empty `.env` in scripted mode. |
| S2 | **Database.** `schema.sql`, `db/client.ts`, four repos (`crewId` first), `scripts/seed.ts`, repo isolation test. | 40 m | `pnpm db:seed` → 3 crew, 42 confirmed check-ins; `isolation.test.ts` proves `getCheckIn(A, idOfB)` is `null` and list functions never return B's rows. |
| S3 | **KPI registry + number parser.** `kpi/registry.ts`, `numbers/mn.ts`, `numbers/extract.ts`, `language.ts`, tests. | 35 m | `numbers.mn.test.ts` green: both brief examples, 0–200 round trip in both forms, "гуч зургаа аравны тав" → 36.5; test table reviewed by a Mongolian speaker. |
| S4 | **Health logic.** `baseline`, `flags`, `scores`, `recommendations`, `summary` + tests. | 40 m | Tests green for: mean/sd on a fixed series; ±2 sd boundary; sd floor; safety range; both red-flag rules; readiness cap; at most 2 findings and 2 recommendations; numeral check rejects an invented number. |
| S5 | **State machine + tools + scripted agent.** `machine.ts`, `tools.ts`, `directive.ts`, `Agent` interface, `ScriptedAgent`, `demo.mn.ts` / `demo.en.ts`. | 45 m | `machine.test.ts` covers every row of §4.1; `scripted-flow.test.ts` drives the whole script from `GREETING` to `DONE` and asserts 16 stored keys and a non-null `summary_json`. |
| S6 | **API routes.** session, crew, checkins, turn (SSE, JSON text input), audio (serves demo clips in scripted mode), dashboard, health. | 40 m | A scripted test walks select → check-in → turns → dashboard over HTTP; with crew A's cookie, B's check-in id returns 404 on every route. |
| S7 | **Shell + i18n + crew select.** Theme tokens, `AppHeader`, `LanguageToggle`, dictionary, `CrewSelect`. | 25 m | `/` shows three crew cards; the toggle switches every visible string; no hard-coded UI strings outside `dictionary.ts` (grep check). |
| S8 | **Cosmo placeholder.** `CosmoAvatar`, `PlaceholderCosmo`, `variants.ts`, `useAudioAmplitude`, `/dev/cosmo` playground. | 35 m | In the playground all 4 states and 3 emotions are visibly distinct; the mouth follows the amplitude slider; three variants differ. |
| S9 | **Check-in screen.** `useCheckIn`, `ConversationView`, `TranscriptPanel`, `KpiCardRail`, `MicButton` (states only), `TextFallbackInput`. | 45 m | Typing answers in scripted mode: greeting appears by name; cards slide in with value, unit and "from your words"; an out-of-range answer produces a clarification; a correction at `CONFIRM` updates the card. |
| S10 | **Dashboard + transition.** `DashboardView`, KPI cards with delta and sparkline, `HealthRadar`, `ReadinessRadial`, `CosmoDock`, shared-element transition. | 45 m | After "yes", Cosmo moves to the corner and the dashboard animates in; values equal `GET /api/dashboard`; radar shows 6 axes; summary shows ≤ 2 findings, ≤ 2 recommendations and the disclaimer; layout holds at 1280×720 and 375 px. |
| S11 | **Run demo.** `RunDemoButton`, script player, pre-generated clips through `useSpeechPlayer`, lip sync. | 30 m | With the network cable out and `DEMO_MODE=scripted`, one click plays the full flow to the dashboard in ≤ 90 s with audible speech and a moving mouth. If clips are not generated yet: same flow, text and timed mouth, banner shown. |

### Milestone B — live voice (S12–S16, ≈ 3 h)

| # | Step | Est. | Accept |
|---|---|---|---|
| S12 | **Claude agent.** `prompt.ts`, `claudeAgent.ts` (streaming, strict tools, directive, refusal handling, single-call turn), turn logging, `timing` event. Read the TypeScript SDK tool-use reference first. | 45 m | In live mode with typed input, a full check-in in English and in Mongolian reaches the dashboard; a refused tool call leads to a clarification; `llmMs` is printed per turn and reported for D2. |
| S13 | **Speech in.** `useRecorder` (MediaRecorder, VAD 900 ms, push-to-talk), `speech/stt.ts`, multipart branch of the turn route, language decision. | 45 m | Speaking an English and a Mongolian sentence shows the transcript and a reply in the same language; push-to-talk works with VAD disabled; an STT failure shows the banner and leaves the text box usable. |
| S14 | **Speech out.** `probe.ts` + `instrumentation.ts` (startup log of chosen models from `GET /v1/models`), `speech/tts.ts` (stream), audio route in live mode, `speechSynthesis` fallback, banner, `gen-demo-audio.ts`, D1 listening test. | 45 m | Startup log names the STT and TTS models and whether `mn` is supported; Cosmo speaks both languages with lip sync; blocking `api.elevenlabs.io` falls back without breaking the flow; demo clips are generated and committed; end-of-speech → first audio is measured and reported against 2.5 s. |
| S15 | **Rive drop-in.** `RiveCosmo` behind the same props, server-side existence check, dynamic import. | 25 m | Without `public/cosmo.riv` the placeholder renders and no Rive code is downloaded; with any `.riv` exposing the `Cosmo` state machine, it renders and the inputs change with state. |
| S16 | **Docs + final run.** README (setup, env, `cosmo.riv`), `docs/sources.md` (licences from §2, ElevenLabs, Anthropic, NASA HRP references fetched and linked, threshold gaps), full scripted run, written report. | 30 m | A clean clone + `pnpm i && pnpm db:seed && pnpm dev` works from the README alone; `pnpm test` green; the report lists what works, what is mocked, what was measured, and next steps. |

### Schedule reality

- Sequential total ≈ 10 h, above the 6–8 h target (R16). Milestone A alone is ≈ 7 h and is demo-ready by itself.
- With two people, after S1: **lane 1** (server) S2 → S3 → S4 → S5 → S6 → S12 → S13 → S14; **lane 2** (UI) S7 → S8 → S9 → S10 → S11 → S15, working against the contracts in §5 with a fixture until S6 lands. Wall-clock ≈ 6 h.
- **Cut list, in order:** S15 (Rive) → English demo script → sparklines → live STT (keep typed input + live TTS) → radial chart. Never cut: S2 isolation test, S3, S4, S11.

---

## 10. Definition of done (BRIEF §9)

- `pnpm dev` runs the app; `pnpm test` passes the number parser, baseline/flag and crew-isolation suites.
- The seven-step flow in BRIEF §0 works end to end in scripted mode with no network, and in live mode in both languages.
- README and `docs/sources.md` exist and match what was built.
- A final report states plainly what works, what is mocked (STT, LLM and TTS adapters in scripted mode; clinical thresholds; the placeholder mascot), and what was measured.

Out of scope for Phase 1: authentication, wearable or device ingestion, multi-day trend analysis beyond the 14-day baseline, a phoneme lip-sync pipeline, deployment.

---

## 11. Progress log

- **S0 — done 2026-11-14.** Node v24.22.1 replaced Node 20.10.0 system-wide, installed with `winget` from the official nodejs.org MSI; winget lists no 22.x, only 24.x and 26.x, and the plan allowed 22 or 24. pnpm 12.18.0 is installed in `%APPDATA%\npm` (`corepack enable` needs admin rights, so it was not used). The project lives in `C:\dev\aegis`, outside OneDrive, in its own git repo with `docs/BRIEF.md` and `docs/PLAN.md`. Node 24.22.1 satisfies the engine ranges of next, shadcn, @prisma/client, better-sqlite3, vitest, vite, recharts, pnpm and @elevenlabs/elevenlabs-js. `[proof: S0 run 2026-11-14 — node -v, pnpm -v from a clean PATH, git rev-parse --show-toplevel, semver check against the engine ranges in §2]`
- **Environment trap for S1+:** `C:\Users\Dell\package.json` pins `packageManager: yarn@3.6.4`, and pnpm 12 refuses to run in any folder beneath `C:\Users\Dell` (`ERR_PNPM_OTHER_PM_EXPECTED`). Keep the project at `C:\dev\aegis`. `[proof: pnpm -v failed from the old working folder with that error; the ancestor walk found C:\Users\Dell\package.json]`
- Terminals opened before S0 keep the old PATH; open a new terminal to see Node 24 and `pnpm`.