# NASA Space Apps 2026 — submission text (Cosmo)

Ready-to-paste text for the project page. Every link below answered HTTP 200 on 2026-11-15.
Items marked **(in progress)** are being built now; update them before you submit.

---

## Project name

**Cosmo — a voice-first health companion for astronauts**

## Challenge

Create Health Monitoring Software for Astronauts on Space Missions

## Links

- Live demo: https://cosmo-nine-phi.vercel.app/
- Source code: https://github.com/batlvndenbayrbileg-sys/cosmo
- Demo video: _(add your link)_

## High-level summary (short)

Cosmo is a health companion for astronauts: a friendly assistant you talk to. It speaks Mongolian and English. You open the app and talk; Cosmo works out who is speaking and answers health questions. It runs a short daily check-up and explains results step by step with charts and a body map. It compares today with your own past days and with real NASA spaceflight data (the SpaceX Inspiration4 blood and urine panels from NASA's Open Science Data Repository). When something is wrong it opens first-aid guidance and sends an urgent alert to Mission Control on Earth. It supports decisions and never gives a diagnosis.

## What it does

1. **Assistant first.** The app opens straight into Cosmo. From the first words Cosmo picks the language, and the voice decides which crew profile is speaking. The crew member can ask anything ("what is a normal pulse?", "how did I sleep last time?").
2. **Daily check-up.** A "Daily check-up" button opens a short spoken check-up. Spoken numbers in both languages are understood: units, Mongolian number words, "120 over 80". Impossible or dangerous values get explained, not ignored. **(in progress)** Values a wearable would measure (heart rate, SpO2, blood pressure, temperature, sleep time) come from the sensor feed instead of being asked. Only what a sensor cannot know is asked, plus a short mental-health check.
3. **Cosmo explains.** "How am I today?" or "Was it like this before?" starts a step-by-step walkthrough: a chart of each value, the person's own baseline, and what to do next.
4. **Signature triage on NASA data.** Blood (CBC, metabolic panel, cytokines) and urine inflammation panels from the Inspiration4 crew are compared with each person's own pre-flight baseline. A flagged pattern is shown with the evidence behind it.
5. **"It hurts."** An interactive body map shows where it hurts, the related data from the person's own records, and first-aid steps. A report goes to Earth, marked urgent if it is serious.
6. **SOS to Earth.** One tap, or the words "tell Earth", sends an urgent alert with a face photo to the ground console, where a siren sounds. **(in progress)** The crew member can delete the photo, and the SOS screen is being redesigned.
7. **Earth console.** Mission Control sees each crew member's status, SOS alerts with photos, pain reports and trends.
8. **lil cosmo (in progress).** A small desktop pet version of Cosmo for Windows and macOS.

## How it works / technology

- Web app: Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui, Recharts, framer-motion. Hosted on Vercel; data in Neon Postgres (SQLite locally).
- Speech: ElevenLabs Scribe for speech-to-text, ElevenLabs for text-to-speech, in Mongolian and English. Voice activity detection and noise handling run in the browser.
- AI: Claude (Anthropic) phrases the replies and extracts values through tool calls. Every number, threshold and comparison is computed in our own TypeScript code, and model replies pass checks before anyone sees them: numbers must come from the data, no diagnosis, no drug names. Offline rules take over if the model is unavailable.
- Safety: crisis and emergency words always win; emergency guides are lay first aid and cite their sources. Every screen states "Decision support, not a diagnosis".
- Tests: about 3,300 automated tests (Vitest), run on both SQLite and Postgres.

## Benefits / impact

- Long missions (Moon, Mars) have communication delays. The crew needs a companion that notices changes early, explains them clearly and knows when to call Earth.
- Talking is faster than forms and works while the hands are busy.
- Comparing each person with their own baseline, not a population average, reflects how real astronaut data behaves.
- Bilingual by design: Mongolian and English from day one.

## Use of artificial intelligence

- Claude (Anthropic API) for conversation wording and value extraction, guarded by code checks. The model never decides a number or a status.
- ElevenLabs for speech recognition and voice.
- Higgsfield for two illustrations: the holographic body map and the Earth background.
- Claude Code helped write the software.
- Mascot artwork: the team's own renders.

## Space agency data used

| # | Resource | Link | How we used it |
|---|---|---|---|
| 1 | NASA OSDR **OSD-569**: Inspiration4 whole blood (CBC). DOI 10.26030/e0rx-sh52 | https://osdr.nasa.gov/bio/repo/data/studies/OSD-569 | `data/nasa/OSD-569_LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv`, used by Signature triage |
| 2 | NASA OSDR **OSD-575**: Inspiration4 serum metabolic panel and immune/cardiac cytokines. DOI 10.26030/mc5d-p710 | https://osdr.nasa.gov/bio/repo/data/studies/OSD-575 | CMP, immune and cardiovascular Eve panels, Alamar NULISA serum (4 CSV files in `data/nasa/`) |
| 3 | NASA OSDR **OSD-656**: Inspiration4 urine inflammation panel (Alamar NULISA). DOI 10.26030/7cax-yj10 | https://osdr.nasa.gov/bio/repo/data/studies/OSD-656 | The Labs → urine tab: each person's post-flight values against their own pre-flight baseline (L-92, L-44, L-3) |
| 4 | NASA Human Research Program, 5 Hazards of Human Spaceflight | https://www.nasa.gov/hrp/hazards/ | Links each health indicator to a hazard on the dashboard (our mapping, not NASA's) |
| 5 | NASA HRP, Risks of Human Spaceflight | https://www.nasa.gov/hrp/risks/ | Background for the risk list |
| 6 | NASA HRP, Ongoing HRP Research | https://www.nasa.gov/hrp/ongoing-hrp-research/ | Background |
| 7 | NASA HRP risk: Adverse Health Event Due to Altered Immune Response | https://www.nasa.gov/directorates/esdmd/hhp/risk-of-adverse-health-event-due-to-altered-immune-response/ | Why immune markers are watched |
| 8 | NASA evidence report, altered immune response (Crucian & Sams), NTRS 20140002769 | https://ntrs.nasa.gov/citations/20140002769 | Same |
| 9 | NASA evidence report, sleep loss, circadian desynchronization and work overload, NTRS 20160003864 | https://ntrs.nasa.gov/citations/20160003864 | Sleep and workload questions |
| 10 | HemoCue ISS Tech Demo, results and lessons learned, NTRS 20210026808 | https://ntrs.nasa.gov/citations/20210026808 | What blood measurement on the ISS can do |
| 11 | rHEALTH ONE demonstration aboard ISS, NTRS 20230001079 | https://ntrs.nasa.gov/citations/20230001079 | Same |
| 12 | ISS Technology Demonstrations for Future Spaceflight Medical Systems, NTRS 20240004905 | https://ntrs.nasa.gov/citations/20240004905 | Same |
| 13 | CSA (Canadian Space Agency): monitoring radiation and astronaut health | https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp | Listed in the team workbook; not fetched by us |

**(in progress)** The check-up redesign adds a research note (`docs/research/checkin-nasa.md`) with further NASA sources on sensors and behavioral health. Add its links here when it lands.

## Other references

- Kim J. et al., Nature Communications 15, 4954 (2024): Inspiration4 single-cell immune profiles. https://doi.org/10.1038/s41467-024-49211-2
- Overbey E. G. et al., Nature Communications (2024): SOMA biospecimens. https://doi.org/10.1038/s41467-024-48806-z
- Gertz M. L. et al., Cell Reports 33(10) 108429 (2020). https://doi.org/10.1016/j.celrep.2020.108429
- Rea D. J. et al., Nature Communications (2024): single-drop cytometry on the ISS. https://doi.org/10.1038/s41467-024-46483-6
- First-aid guides: St John Ambulance (https://www.sja.org.uk/first-aid-advice/) and American Red Cross CPR steps (https://www.redcross.org/take-a-class/cpr/performing-cpr/cpr-steps).
- General vital-sign ranges: the team's reference workbook, `data/reference/vital_signs_reference.xlsx`.

## Limits (state these honestly)

- A prototype, not a medical device. Thresholds are demo parameters, not clinical limits, and nothing has been clinically validated.
- The Mongolian wording needs a native-speaker review, and the first-aid guides need review by a medical professional.
- Real microphone, camera and wearable hardware were not tested on orbit-like equipment. The sensor feed is simulated.

## Tags

astronaut health, voice assistant, AI, Mongolian, NASA OSDR, Inspiration4, telemedicine, mental health, first aid
