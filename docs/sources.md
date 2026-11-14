# Sources, licences and references

Checked 2026-11-14. Licences below are the `license` field of each package as published on the npm registry (`npm view <pkg>@<installed version> license`); they are not legal advice.

## Libraries (installed versions)

| Package | Version | Licence | Used for |
|---|---|---|---|
| next | 16.4.6 | MIT | App Router, route handlers (SSE) |
| react / react-dom | 19.3.0 | MIT | UI |
| tailwindcss | 4.3.3 | MIT | styling |
| shadcn (CLI, official, ui.shadcn.com) | 4.23.0 | MIT | component source copied into `src/components/ui` (base-nova style) |
| @base-ui/react | 1.9.0 | MIT | primitives behind the shadcn components |
| lucide-react | 1.72.0 | ISC | icons |
| class-variance-authority | 0.7.1 | Apache-2.0 | component variants |
| tw-animate-css | 1.4.0 | MIT | animation utilities |
| recharts | 3.8.0 | MIT | charts (via the shadcn chart wrapper) |
| framer-motion | 14.13.0 | MIT | animation, shared-layout Cosmo transition |
| @rive-app/react-canvas | 4.39.0 | MIT | optional Rive mascot runtime (`public/cosmo.riv`) |
| @anthropic-ai/sdk | 1.8.0 | Apache-2.0 | Claude API client (server only) |
| better-sqlite3 | 13.1.1 | MIT | local SQLite persistence |
| zod | 4.6.7 | MIT | input validation |
| server-only | 0.0.1 | MIT | keeps server modules out of client bundles |
| vitest | 5.1.0 | MIT | tests |
| tsx | 4.23.15 | MIT | scripts (`db:seed`, probes) |
| typescript | 5.9.3 | Apache-2.0 | types |
| vite-tsconfig-paths | 6.1.1 | MIT | `@/` alias in tests |

Version note: `framer-motion` is pinned to 14.13.0 because pnpm's minimum-release-age policy rejects packages published in the last 24 hours (14.14.0 was about 5 hours old when installed).

## Services (terms of service apply; no licence is claimed here)

- **Anthropic API (Claude)** — LLM that only phrases replies and extracts values through tool calls; every number, status and comparison is computed in our TypeScript. Docs: https://docs.anthropic.com
- **ElevenLabs** — speech-to-text (Scribe) and text-to-speech. Facts below were read from the docs on 2026-11-14 and are re-confirmed against the live API by `pnpm probe:elevenlabs` before they are relied on:
  - STT: `POST https://api.elevenlabs.io/v1/speech-to-text`, header `xi-api-key`, multipart field `file`, `model_id` required (`scribe_v2` in the examples), optional `language_code`; response has `text`, `language_code`, `language_probability` (https://elevenlabs.io/docs/api-reference/speech-to-text/convert).
  - Mongolian is listed for Scribe in the "Moderate (>25% to <=50% WER)" tier for Scribe v2 (https://elevenlabs.io/docs/capabilities/speech-to-text). Expect transcription errors, especially numbers; the product therefore cross-checks values and always shows the transcript.
  - TTS: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream`, `output_format` default `mp3_44100_128` (https://elevenlabs.io/docs/api-reference/text-to-speech/stream). The docs page reading said Mongolian (`mn`) is listed for `eleven_v3` too, but the **live `GET /v1/models` response on this account (2026-11-14) lists Mongolian only for `eleven_v4` and `eleven_v4_turbo`** (94 languages each); `eleven_v3` and `eleven_v3_conversational` (74 languages), `eleven_multilingual_v2` and `eleven_flash_v2_5` do not. The live response wins: the default Mongolian model is `eleven_v4_turbo`. Whether these models work on the `/stream` endpoint is tested by the probe.
  - Models list: `GET /v1/models`, each model has a `languages` array (https://elevenlabs.io/docs/api-reference/models/list).

## NASA Human Research Program

Fetched 2026-11-14 (hazard names taken from the first page; our one-line summaries are paraphrases):

- https://www.nasa.gov/hrp/hazards/ — "5 Hazards of Human Spaceflight": Space Radiation; Isolation and Confinement; Distance from Earth; Gravity Fields; Hostile/Closed Environments.
- https://www.nasa.gov/hrp/risks/ — "Risks of Human Spaceflight".
- https://www.nasa.gov/hrp/ongoing-hrp-research/ — "Ongoing HRP Research".

Limits, stated plainly:

- The links between our indicators and the five hazards are **suggested, not official NASA mappings**.
- None of the three pages states numeric thresholds for blood pressure, heart rate, glucose and similar indicators. Every threshold in this prototype is therefore a **"demo parameter"**, not a clinical limit (workbook requirement R-16).
- None of the three pages states an Earth–Mars communication delay. The "Live / 3 min / 20 min" selector is a simulation setting, not a NASA figure (`MARS_COMM_DELAY` in `src/lib/nasa/hazards.ts` is `null`, unverified).
- Also listed in the workbook (not fetched): https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp

## Team inputs

- `docs/BRIEF.md` — the Phase 1 brief.
- `NASA_Health_Companion_Requirements.xlsx` (workbook, 8 sheets) — question set, daily flow, status model, hazard link, Earth dashboard; interpreted in `docs/DASHBOARD_PLAN.md`.
- Mascot — the team's own PNG renders (originals kept outside the repo; downscaled copies in `public/mascot`). Ownership and any AI-tool terms of use are the team's to confirm; they have not been checked here.

## Not clinically validated

Thresholds, the readiness score, the radar axes and the task suggestions are transparent heuristics for decision support in a prototype. The product states: *Prototype, not a medical device. Decision support, not a diagnosis.* Mongolian wording and Mongolian number-word spellings (`src/lib/numbers/mn.ts`) need review by a native speaker.
