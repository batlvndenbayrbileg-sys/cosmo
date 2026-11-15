# Claude Code prompt — Phase 1: "Cosmo" daily check-in + light dashboard

Paste everything below the line into Claude Code (run it in an empty folder, or in the repo that holds CLAUDE.md).

---

You are building Phase 1 of **Cosmo**, our NASA Space Apps Challenge 2026 entry ("Create Health Monitoring
Software for Astronauts on Space Missions"). We have ~20 hours in total; this phase must be demo-ready in
about 6–8 hours. Work in small, verifiable steps, keep `main` runnable, and commit after each step.

## 0. What to build in this phase (the only feature that matters right now)
A voice-first daily health check-in led by an AI companion named **Cosmo**, followed by a light, clean
dashboard that shows the results and a friendly, professional summary.

User flow (must work end to end):
1. **Crew select.** Start screen shows the crew (3 members, seeded). Tap a member to "enter".
2. **Full-screen Cosmo.** Cosmo fills the screen and greets first, by name, in the crew member's
   preferred language. Example (MN): "Сайн уу, Бат! Би Cosmo байна. Өнөөдөр ямар байна даа?"
   Example (EN): "Hi Bat, I'm Cosmo. How are you feeling today?"
3. **Small talk (1–2 turns).** Astronaut answers by voice (or text). Cosmo replies warmly and briefly,
   then proposes: MN "Хоёулаа өнөөдрийн хэмжилтүүдээ хийх үү?" / EN "Shall we log today's measurements together?"
4. **Guided KPI capture, one question at a time** (list in §3). While the astronaut speaks:
   - the live transcript is shown under Cosmo,
   - each understood value is written onto the screen immediately as a card (label, value, unit,
     and a small "from your words: …" snippet),
   - unclear or out-of-range answers get a short, polite clarification question.
5. **Confirm.** Cosmo reads back a compact summary and asks: MN "Бүгд зөв үү?" / EN "Is everything correct?"
   The astronaut can correct by voice ("No, I slept 7 hours") — update that card and ask again.
6. **Transition to dashboard.** On "yes": Cosmo animates down into a docked corner widget and the
   dashboard animates in with today's values.
7. **Summary.** Cosmo speaks and shows an overall assessment: 1 line overall status, up to 2 notable
   findings compared with the person's own baseline, up to 2 concrete recommendations, and the line
   "Decision support, not a diagnosis." Friendly and professional, never alarmist, never cute-silly.

## 1. Stack (use exactly this unless something is broken)
- Next.js (App Router) + TypeScript + Tailwind CSS + **official** shadcn/ui (ui.shadcn.com) +
  shadcn charts (Recharts) + framer-motion.
- Local persistence: SQLite via Prisma (or better-sqlite3 + a thin repo layer). No external DB.
- LLM: Anthropic API (Claude) from a Next.js route handler with **tool use**. Model from env
  `ANTHROPIC_MODEL`. Keys only on the server.
- Speech-to-text: **ElevenLabs Scribe** (supports Mongolian). Record with MediaRecorder; use simple
  voice-activity detection (silence > 900 ms ends the utterance) plus a push-to-talk button fallback.
  Send audio to our server route, which calls Scribe. Use the returned language code to decide the
  reply language.
- Text-to-speech: **ElevenLabs**. Use model `eleven_v3` for Mongolian (`mn` is in its language list).
  For English you may use a lower-latency model if it sounds good. On startup, call ElevenLabs'
  supported-languages / models endpoint and log the choice. Check the current ElevenLabs docs for
  exact endpoint names and model ids before coding; do not guess. Stream audio to the browser.
- Env: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID_MN`,
  `ELEVENLABS_VOICE_ID_EN`. Provide `.env.example`.

## 2. Bilingual behavior
- Cosmo understands and answers in **Mongolian (Cyrillic) and English**. Reply in the language the
  astronaut just used; if they mix, follow the dominant one. Each crew profile has `preferredLanguage`
  used for the first greeting.
- All UI strings in an i18n dictionary (`mn`, `en`), switchable in a header toggle.
- Numbers spoken in Mongolian ("долоон цаг", "ерэн найм") must be parsed correctly. Implement a
  Mongolian number-words parser with unit tests (0–200, decimals like "гуч зургаа аравны тав").

## 3. KPIs to capture (one question each, in this order)
| key | question intent | type / unit | valid range |
|---|---|---|---|
| sleep_hours | hours slept | number, h | 0–14 |
| sleep_quality | sleep quality | 1–10 | 1–10 |
| resting_hr | resting heart rate | bpm | 30–200 |
| bp_systolic / bp_diastolic | blood pressure | mmHg | 70–220 / 40–140 |
| spo2 | oxygen saturation | % | 70–100 |
| body_mass | body mass | kg | 30–200 |
| exercise_resistive_min | resistive exercise | min | 0–240 |
| exercise_aerobic_min | aerobic exercise | min | 0–240 |
| headache | headache now? | yes/no + 0–10 | — |
| vision_change | blurred vision / change? | yes/no | — |
| back_pain | back pain | 0–10 | 0–10 |
| mood | mood | 1–10 | 1–10 |
| fatigue | fatigue | 1–10 | 1–10 |
| notes | anything else | free text | — |
Cosmo may skip a question the astronaut already answered earlier in the conversation.

## 4. Agent design (server)
- One conversation state machine on the server: `GREETING → SMALL_TALK → KPI_CAPTURE → CONFIRM →
  SUMMARY → DONE`. The LLM speaks; the state machine decides what comes next.
- Tools exposed to Claude:
  `record_measurement(key, value, unit, source_text, confidence)`,
  `request_clarification(key, reason)`, `correct_measurement(key, value)`,
  `get_baseline(crewId)` (14-day personal mean/sd per KPI), `finish_confirmation(confirmed: boolean)`,
  `compose_summary()` which returns structured findings computed by our code.
- **All medical numbers and comparisons are computed in our TypeScript code**, not by the LLM. The LLM only
  phrases them. Flag a KPI as notable when it is outside the person's baseline mean ± 2 sd, or outside a
  fixed safety range. Red-flag rules (e.g. SpO2 < 90, vision change + headache) make Cosmo say calmly that
  the crew medical officer and ground should be informed.
- System prompt for Cosmo: warm, calm, concise (1–2 sentences per turn), professional medical-companion
  tone, no jokes about health, no emojis, never diagnoses, always offers the next step.
- Keep the last 20 turns plus a running KPI JSON in context. Log every turn to the DB.

## 5. Data model & privacy
- `CrewMember { id, name, role, preferredLanguage, mascotVariant, avatarSeed }`
- `CheckIn { id, crewId, startedAt, confirmedAt, language, summaryJson }`
- `Measurement { id, checkInId, crewId, key, value, unit, sourceText, confidence, createdAt }`
- `Turn { id, checkInId, speaker, text, language, createdAt }`
- Every query is scoped by `crewId`. One member can never read another member's data in the UI or API
  (add a test). Seed 14 days of plausible history for each member so baselines exist.

## 6. Cosmo mascot (designer will deliver a Rive file later — build so it drops in)
- Create `<CosmoAvatar variant state amplitude emotion />` with this **contract**:
  - `state`: `idle | listening | thinking | talking`
  - `emotion`: `neutral | happy | concerned`
  - `amplitude`: 0–1, from a Web Audio `AnalyserNode` on the TTS audio (drives the mouth)
  - `variant`: per crew member (same character, different face/color details)
- Implement it now as a **placeholder**: an original, minimal SVG/CSS character (soft rounded shape,
  two eyes that blink, a mouth that opens with `amplitude`, subtle breathing in idle, attentive tilt in
  listening, slow pulse in thinking). Do NOT imitate any existing film/TV character.
- Add a `RiveCosmo` implementation behind the same props using `@rive-app/react-canvas`, loading
  `/public/cosmo.riv` with state machine `Cosmo` and inputs: `isTalking` (bool), `isListening` (bool),
  `isThinking` (bool), `emotion` (number 0/1/2), `mouthOpen` (number 0–100), `variant` (number).
  Use Rive automatically when the file exists, otherwise the placeholder.
- Lip sync: amplitude-based (works for Mongolian and English). No phoneme pipeline in this phase.

## 7. Screens & visual design
- **Light theme**, clean and clinical: white/very light grey background, one accent color, generous
  spacing, large readable type, rounded cards, no clutter. Must look professional on a projector.
- Check-in screen: Cosmo centered (60–70% height), live transcript below, captured KPI cards slide in on
  the right (desktop) or below (mobile), a mic button with clear listening/thinking/speaking states, a
  text-input fallback, and a language toggle.
- Dashboard (after confirm): header with crew member + mission day; KPI cards with value, unit and delta vs
  personal baseline (small sparkline of 14 days); a **Health Radar** (shadcn radar chart) with 6 axes
  (Sleep, Cardiovascular, Musculoskeletal, Neuro-ocular, Behavioral, Activity), scored 0–100 by our code;
  an "Overall readiness" radial chart; Cosmo docked bottom-right with the summary text and a replay button.

## 8. Reliability for the live demo
- `DEMO_MODE=scripted`: no network needed. Pre-recorded/pre-generated TTS clips and a scripted dialogue
  for one crew member, triggered by a "Run demo" button; transcript and cards animate as if live.
- If ElevenLabs fails at runtime, fall back to browser `speechSynthesis` for TTS and the text box for input,
  and show a small non-blocking banner.
- Target: the time from end of speech to start of Cosmo's audio under ~2.5 s in live mode; show the thinking
  state immediately so it never feels frozen.

## 9. Deliverables & definition of done
- `pnpm dev` runs the app; `pnpm test` passes (number parser, baseline/flag logic, crew data isolation).
- README with setup, env vars, and how to drop in `cosmo.riv`.
- `docs/sources.md`: every library/service with license (shadcn/ui MIT, Recharts MIT, Rive runtime, ElevenLabs,
  Anthropic) and NASA HRP references.
- Before you finish, run the full flow yourself in scripted mode and report what works, what is mocked, and
  the next steps.

Start by proposing the folder structure and the state machine in a short plan, then implement.
