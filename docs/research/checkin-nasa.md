# The daily check-in: what a sensor gives, what only the astronaut can say

Research note behind the check-in redesign (2026-11-15). It answers one question from the team: which parts of a daily
health check does NASA take from devices, and which must be asked? The redesign follows from it. Cosmo no longer asks
for numbers a wearable or a station device already records. It asks six short questions that only the astronaut can
answer, including a short wellbeing (mental-health) check.

**Honesty notes**

- AEGIS is a hackathon prototype. Nothing here is a clinical instrument.
- The wellbeing items are **adapted** from NASA self-report tools (see below). They are not those tools, and they are
  not validated. The 1-5 wording and the "watch" thresholds are demo parameters.
- The sensor feed in AEGIS is **simulated**. It is deterministic and built from each crew member's own recent records.
  Every such value is labelled "from your sensors" and "simulated" in the UI.

## Measured by a sensor vs asked

| Item | Where it comes from on the ISS | In AEGIS now |
|---|---|---|
| Heart rate, ECG | Bio-Monitor smart shirt and headband (CSA) | sensor (simulated), not asked |
| Blood pressure | Bio-Monitor | sensor (simulated), not asked |
| Skin / body temperature | Bio-Monitor (skin temperature) | sensor (simulated), not asked |
| Breathing rate, SpO2, activity | Bio-Monitor | not stored as keys yet; the reference answers already know SpO2 and breathing |
| Sleep timing and duration | wrist actigraph (Standard Measures, Lighting Effects) | sensor (simulated), not asked |
| Exercise minutes | exercise devices (CEVIS logs workload and heart rate) | sensor (simulated), not asked |
| Water | no confirmed per-person sensor. Food and fluid intake is self-logged on board. | simulated "drink dispenser log" (an assumption); asked only when there is no feed |
| Glucose | not a daily ISS measurement. Blood is drawn periodically and analysed on the ground. CGM was first used on the ISS on Axiom Ax-4 (2025). | simulated "glucose patch" (an assumption); asked only when there is no feed |
| Body mass | SLAMMD / BMMD, periodic | not part of the daily check |
| Blood and urine labs | periodic collections (Biochemical Profile, Repository) | separate Signature Triage and urine panels |
| CO2, radiation, temperature, humidity | station environment sensors | not part of the daily check |
| Sleep **quality** | self-report (sleep log on waking; RST sleep-quality scale) | **asked** |
| Mood / how you feel | self-report (Standard Measures bedtime questionnaire, VAS) | **asked** |
| Symptoms (headache, dizziness, nausea, blurry vision) | self-report (vision has periodic eye exams) | **asked**, one question |
| Fatigue / energy | self-report (RST: mental fatigue, physical exhaustion, tiredness) | **asked** |
| Stress | self-report (RST stress VAS) | **asked** |
| Feeling connected (crew, home) | team cohesion items in Standard Measures; isolation from home is a named stressor (OCHMO-TB-016) | **asked** |
| Workload | self-report (RST evening workload, NASA-TLX) | taken when volunteered, not asked daily |
| Pain | self-report | the existing pain check (body map), on any words |

## The spoken questions (at most six, plus one follow-up)

Before the first question, Cosmo says the sensors already logged sleep and the morning vitals. It then reads back
anything unusual against the person's own 14-day baseline or the demo range. When the unusual reading is a body reading
(pulse, blood pressure, temperature, glucose), Cosmo asks one follow-up question ("did you exercise, or are you feeling
stressed or unwell?"). Unusual sleep, water or exercise is only mentioned.

| # | id | English | Mongolian |
|---|---|---|---|
| (0) | sensor_check (only when a body reading is unusual) | Did you exercise, or are you feeling stressed or unwell? | Дасгал хийсэн үү, эсвэл стресстэй юм уу биеэ тавгүй байна уу? |
| 1 | mood | Overall, how are you feeling today, from 1 to 5? | Ерөнхийдөө өнөөдөр ямар байна, 1-ээс 5 хүртэл? |
| 2 | symptoms | Any headache, dizziness, nausea or blurry vision? | Толгой өвдөх, толгой эргэх, дотор муухайрах эсвэл хараа бүдгэрэх зүйл байна уу? |
| 3 | sleep_quality | How well did you sleep, from 1, very badly, to 5, very well? | Хэр сайн унтсан бэ? 1 бол маш муу, 5 бол маш сайн. |
| 4 | energy | How is your energy right now, from 1, worn out, to 5, full of energy? | Одоо эрч хүч тань ямар байна? 1 бол туйлдсан, 5 бол эрч хүчтэй. |
| 5 | stress | How stressed do you feel today, from 1, calm, to 5, very stressed? | Өнөөдөр хэр их стресстэй байна? 1 бол тайван, 5 бол маш их стресстэй. |
| 6 | connection | How connected do you feel to your crew and to people at home, from 1 to 5? | Багийнхан болон гэрийнхэнтэйгээ хэр ойр байгаа мэт санагдаж байна, 1-ээс 5 хүртэл? |

- Answers can be a number or plain words in either language, e.g. "pretty stressed" (4), "ядарсан" (2) or
  "like a log" (5).
- A value can still be volunteered at any time ("my pulse is 72"). It replaces the sensor reading and goes through the
  same range checks.
- Without a sensor feed (`SENSOR_FEED=off`, e.g. no wearable), the measurement questions are asked as before, after
  the six spoken ones.

## The wellbeing (mental-health) items and why

**Mood, sleep quality, energy, stress, feeling connected.** Each is one 1-5 item.

**Why these.** NASA's Reaction Self Test runs on ISS crews, morning and evening. Its self-report part is short
11-point visual-analog items:

- sleep quality, in the morning;
- workload, in the evening;
- stress, mental fatigue, physical exhaustion, tiredness and sleepiness.

The Spaceflight Standard Measures add two short questionnaires:

- on waking: sleep quality and duration;
- before bed: mood, team cohesion and performance, and habitability.

These are the parts short enough for a one-minute voice check. We kept one item for each:

| Our item | NASA source |
|---|---|
| mood | the bedtime mood item |
| sleep quality | the waking item and the RST sleep-quality scale |
| energy | RST fatigue and exhaustion, merged into one item |
| stress | the RST stress scale |
| feeling connected | team cohesion, plus contact with home, which NASA names as a stressor |

**Left out of the daily voice check**, because they take too long:

- the PVT-B reaction test (3 minutes);
- the full Cognition battery (about 16 minutes);
- WinSCAT (monthly);
- weekly depression and team surveys (20 items or more);
- POMS-type mood lists;
- NASA-TLX (six subscales).

Workload stays a volunteered value.

**What Cosmo does with a low answer.** A low answer is mood, sleep quality, energy or connection at 1-2, or stress at
4-5. Cosmo says one warm sentence and one practical suggestion: a short break, slow breaths, a word with a crewmate or a
call home, and that the flight surgeon and the psychological support team on Earth are there to talk. NASA's support
includes private psychological conferences and family conferences.

- No diagnosis.
- No drug.
- On the dashboard a low answer is a yellow "watch", never a red alert of its own. Mood keeps its existing rules.
- The crisis path is unchanged and always comes first: crisis words give the crisis reply and a red alert to Earth.

## Sources

All URLs were read during this research, on 2026-11-15:

- CSA, Bio-Monitor: https://www.asc-csa.gc.ca/eng/sciences/astroskin.asp
- NASA, Spaceflight Standard Measures: https://www.nasa.gov/humans-in-space/spaceflight-standard-measures-characterizing-how-humans-adapt-in-space
- Jones, Basner et al. (2022), Reaction Self Test on ISS, *Sleep*: https://pmc.ncbi.nlm.nih.gov/articles/PMC8919197
- Cognition battery (UPenn): https://www.med.upenn.edu/uep/cognition.html
- Lighting Effects, actigraphy and sleep logs (NTRS 20160006727): https://ntrs.nasa.gov/api/citations/20160006727/downloads/20160006727.pdf
- WinSCAT validation, NASA-TLX as a pre-test (NTRS 20180007947): https://ntrs.nasa.gov/api/citations/20180007947/downloads/20180007947.pdf
- Biochemical Profile, Repository, Dose Tracker, Journals (NTRS 20170000811): https://ntrs.nasa.gov/api/citations/20170000811/downloads/20170000811.pdf
- APEX, BHP measures and team cohesion (NTRS, 2026): https://ntrs.nasa.gov/api/citations/20260002661/downloads/Bell_APEX_IWS_2026_final.pdf
- OCHMO technical brief, behavioral health (support, stressors, monitoring): https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-016-behavioral-health.pdf
- NASA, astronaut exercise (ARED, T2, CEVIS): https://www.nasa.gov/missions/station/iss-research/astronaut-exercise
- NASA, SLAMMD: https://www.nasa.gov/?p=433463
- NASA JSC, behavioral health (private psychological conferences): https://www.nasa.gov/reference/jsc-behavioral-health/
- Mars-500 psychological measures (VAS, POMS-SF, PVT): https://pmc.ncbi.nlm.nih.gov/articles/PMC3968121/
- ISS environment sensor data (NTRS 20230009560): https://ntrs.nasa.gov/citations/20230009560
- Axiom Space, first CGM on the ISS (Ax-4): https://axiomspace.com/release/suite-ride-research-unlocks-potential-for-first-astronaut-with-diabetes

**Not confirmed:**

- a per-person water-intake sensor on the ISS;
- the exact actigraph model;
- daily glucose checks on the ISS (none found);
- a validated loneliness scale in use on the ISS (none found).
