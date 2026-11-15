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

## Emergency guide (built-in lay first-aid content)

Checked 2026-11-15. Each page was read and the built-in steps in `src/lib/emergency/guides/<id>.ts` were compared with it; every guide stores its sources (title, URL, date checked) in its data. Paraphrased, never copied. `https://www.nhs.uk/conditions/first-aid/cpr/` now redirects to the St John Ambulance page, so St John Ambulance is the main source. ERC and AHA pages were not fetched; the American Red Cross page was used as the second CPR source.

| Guide (`id`) | Sources |
|---|---|
| Not breathing: CPR (`not-breathing`) | St John Ambulance, How to do CPR, https://www.sja.org.uk/first-aid-advice/cpr/ (100 to 120 a minute, 5-6 cm, 30:2 if trained, swap every 1-2 minutes, use the defibrillator); American Red Cross, CPR steps, https://www.redcross.org/take-a-class/cpr/performing-cpr/cpr-steps (100 to 120 a minute) |
| Fainting or feeling faint (`fainting`) | St John Ambulance, Fainting, https://www.sja.org.uk/first-aid-advice/fainting/; recovery position line from the St John Ambulance CPR page |
| Choking (`choking`) | St John Ambulance, Choking, https://www.sja.org.uk/first-aid-advice/choking/ |
| Severe bleeding (`severe-bleeding`) | St John Ambulance, Severe bleeding, https://www.sja.org.uk/first-aid-advice/severe-bleeding/ |
| Burns and scalds (`burns`) | St John Ambulance, Burns and scalds, https://www.sja.org.uk/first-aid-advice/burns-and-scalds/ |
| Seizure (`seizure`) | St John Ambulance, Seizures, https://www.sja.org.uk/first-aid-advice/seizure/ |
| Chest pain (`chest-pain`) | St John Ambulance, Heart attack, https://www.sja.org.uk/first-aid-advice/heart-attack/ (its medicine steps are left out on purpose) |
| Severe allergic reaction (`anaphylaxis`) | St John Ambulance, Anaphylaxis, https://www.sja.org.uk/first-aid-advice/anaphylaxis/ (source of the one medicine line: the person's own adrenaline auto-injector; no dose, no repeat timing) |
| Head injury (`head-injury`) | St John Ambulance, Head injury, https://www.sja.org.uk/first-aid-advice/head-injury/ |
| Get help now (`call-for-help`) | none: no medical content, only "get help, stay together, follow the crew's procedures" |

Rules the tests enforce (`tests/emergency-guides.test.ts`): step 1 is always getting help (crew medical officer and flight surgeon; the local emergency number on Earth); lay first aid only; no diagnosis; no medicine or dose names except the auto-injector line; English and Mongolian have the same steps and sentence count; every guide is `reviewedBy: "PENDING"` and the app shows "not yet reviewed by a medical professional".

Not from the cited pages (written for the space setting, flagged as such in the UI under "In space"): the notes that the station's own procedures decide how to hold a person for CPR and how to cool a burn (no running tap on the station), and that after landing or a long time in weightlessness standing up can make a person feel faint (orthostatic intolerance). These need review by the flight surgeon. The Mongolian texts need review by a native speaker with first-aid training.
