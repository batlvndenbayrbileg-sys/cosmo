# Signature Triage — addendum: second-assay cross-check

Added 2026-11-15 after delivery of `SIGNATURE_SPEC.md`. **Where this file and the spec disagree, this file wins.**
Numbers come from `docs/signature_reference/reference_second_assay.py` ->
`docs/signature_reference/expected_second_assay.json` (the **second fixture**). ASSUMPTION marks choices.

## 1. What was found

OSD-575 contains a file we had not used: the same serum samples measured on a second, independent platform
(Alamar NULISAseq, 203 proteins, log2 "NPQ" units). File:
`data/OSD-575_LSDS-8_Alamar_NULISA_serum_TRANSFORMED.csv` (original NASA name
`LSDS-8_Multiplex_serum.immune.AlamarPanel_TRANSFORMED.csv`; renamed so the existing loader does not confuse
it with the first panel). 27 samples: C003 has no L-44.

Comparing the two platforms on the same blood:

| Check | Result |
|---|---|
| Analytes measured on both | 55 matched pairs |
| Within-person agreement over time (median rank correlation) | 0.09; only 4 of 55 pairs reach 0.5 |
| Agreement for our cytokines | IL-6 0.65, MCP-1 0.37, IL-10 -0.02, IL-27 -0.12 |
| Markers moving the same way in 4/4 crew at R+1 on **both** platforms | IL-6 only |
| R+1 change on the second platform, log2 (C001..C004) | IL-6 +0.55, +0.07, +0.09, +0.76; MCP-1 -0.17, -0.44, +0.47, +0.06; IL-10 -0.04, -0.03, +0.80, +0.15; IL-27 -0.57, +0.03, +0.03, +0.20 |
| IL-6 over all 16 post-flight panels | same sign on both platforms in 13 of 16; rank correlation 0.63 |
| L-44 lowest pre-flight draw on the second platform | 18 % (109/609): the L-44 low batch is an artefact of the first platform |

Meaning:

- **IL-6 holds up.** MCP-1, IL-10 and IL-27 do not: their R+1 rise is seen on one platform only.
- The spec's validation point 4 ("external agreement" with the published paper) is not independent
  replication if the paper used the same measurements, which we could not verify. The second platform is the
  independent check, and it confirms one marker of four.
- **C002 at R+45 is confirmed by both platforms** (IL-6 up on both; IL-8 47x and 40x baseline).
- **C003 at R+194 is not** (IL-6 2.2x on one platform, below baseline on the other). So is C003 at R+1.
- We cannot say which platform is right. We can say when they disagree.

## 2. The feature: two-key confirmation

A blood signal counts as confirmed only when two independent measurements of the same sample agree.

```
d1 = log2( primary value / own primary pre-flight median )
d2 = second-assay NPQ - own second-assay pre-flight median          (NPQ is already log2; >= 2 baseline draws)
NO_SECOND_ASSAY   d1 or d2 missing
NOT_APPLICABLE    |d1| < 0.5                                        0.5 log2 = about +41 %  ASSUMPTION
CONFIRMED         same sign and |d2| >= 0.5
NOT_CONFIRMED     otherwise
```

Computed for IL-6 (primary `il_6`, second `il6`) and IL-8 (`il_8`, `cxcl8`).

Panel badge, only for classes EXPECTED_FLIGHT_RESPONSE and UNEXPECTED_ACTIVATION:
`TWO_ASSAY_CONFIRMED` if IL-6 is CONFIRMED, else `SINGLE_ASSAY`.

| Panel | FRI | Class | IL-6 primary / second (fold) | Badge |
|---|---|---|---|---|
| C001 R+1 | 48.2 | EXPECTED | 2.39 / 1.46 | TWO_ASSAY_CONFIRMED |
| C003 R+1 | 66.9 | EXPECTED | 2.85 / 1.06 | SINGLE_ASSAY |
| C002 R+45 | 53.4 | UNEXPECTED | 2.69 / 1.98 (IL-8: 47.04 / 40.11) | TWO_ASSAY_CONFIRMED |
| C003 R+194 | 56.6 | UNEXPECTED | 2.16 / 0.54 | SINGLE_ASSAY |

Effect on actions (replaces the UNEXPECTED row of spec §7.3):

| Class + badge | Actions |
|---|---|
| UNEXPECTED + TWO_ASSAY_CONFIRMED | symptom checklist now; temperature; re-test in 3 days; notify flight surgeon at next contact |
| UNEXPECTED + SINGLE_ASSAY | repeat the measurement in 3 days; no escalation until a second measurement agrees |
| EXPECTED + SINGLE_ASSAY | same as EXPECTED, plus the sentence "only one of two tests shows this" |

The Flight Response Index itself is unchanged (primary platform, six markers), so `expected_values.json` and
tasks T1–T8 stay valid. MCP-1, IL-10 and IL-27 are labelled "single-assay marker" in the UI.
On a spacecraft the second key would be a second cartridge, method or duplicate run (**ASSUMPTION**).

## 3. Spec changes

1. §8 point 4 now reads: "Published analysis of the same crew lists the same cytokines [4]; this is not
   independent. Independent check: second assay confirms IL-6 only."
2. Evidence card gets a column "Second assay" (IL-6: agrees, 0.65; MCP-1, IL-10, IL-27: not confirmed;
   glucose, monocytes %: single clinical method) and one headline: "55 proteins measured twice: typical
   agreement 0.09".
3. Triage card shows the badge next to the class.
4. Demo crew for the R+1 and recovery beats changes from C003 to **C001** (confirmed by both platforms).
   C003 is used for the "false alarm caught" beat.

## 4. Dialogue (replaces spec §7.1 a, c1, c2; adds d)

**(a) New panel — C001, R+1, EXPECTED, TWO_ASSAY_CONFIRMED**

EN: "Your new blood panel is in. The six markers I compare with your own pre-flight values show a
flight-response pattern: Flight Response Index 48 out of 100, range 40 to 60, so just inside the clear zone.
IL-6 is about 2.4 times your baseline, and a second, independent test on the same blood also shows IL-6 up.
All four Inspiration4 crew moved in this direction one day after landing, so this is the expected picture,
not a new problem. My suggestion: normal fluids and a full night's sleep, no extra draw for now, and a
re-test in 21 days. Tell me if you notice fever, a sore throat or a rash before then. Decision support, not a
diagnosis."

MN: "Таны цусны шинэ шинжилгээ ирлээ. Нислэгийн өмнөх өөрийн тань түвшинтэй харьцуулдаг зургаан үзүүлэлт
нислэгийн дараах хариу урвалын хэв маягийг харуулж байна: индекс 100-аас 48, хэлбэлзэл нь 40-өөс 60, өөрөөр
хэлбэл тод бүсийн захад байна. IL-6 таны суурь түвшнээс ойролцоогоор 2.4 дахин өндөр бөгөөд ижил цусан дээр
хийсэн хоёр дахь, бие даасан шинжилгээ ч IL-6 өссөнийг баталж байна. Inspiration4-ийн дөрвөн гишүүнд
газардсаны маргааш мөн ийм чиглэлийн өөрчлөлт гарсан тул энэ бол хүлээгдэж буй дүр зураг, шинэ асуудал биш.
Миний санал: шингэнээ хэвийн ууж, шөнөдөө бүтэн унтаарай. Одоогоор нэмэлт цус авах шаардлагагүй, 21 хоногийн
дараа давтан шинжилгээ өгье. Тэр хүртэл халуурах, хоолой өвдөх, арьсанд тууралт гарах шинж илэрвэл надад
хэлээрэй. Энэ бол шийдвэр гаргахад туслах мэдээлэл, онош биш."

**(c1) Recovery — C001, R+45, BASELINE**

EN: "Good news from your re-test. Your index is 1, down from 48, so these markers are back in your baseline
zone. IL-6 is now below your pre-flight baseline. Three of the four Inspiration4 crew were back in this zone
by day 45. No further draw is needed for this episode. Decision support, not a diagnosis."

MN: "Давтан шинжилгээний мэдээ сайн байна. Таны индекс 48-аас 1 болж буурсан тул эдгээр үзүүлэлт суурь
түвшиндээ буцжээ. IL-6 одоо нислэгийн өмнөх суурь түвшнээс тань доогуур байна. Inspiration4-ийн дөрвөн
гишүүний гурав нь 45 дахь өдөр гэхэд энэ бүсэд буцсан байсан. Энэ удаагийн хувьд дахин цус авах шаардлагагүй.
Энэ бол шийдвэр гаргахад туслах мэдээлэл, онош биш."

**(c2) Off-trajectory — C002, R+45, UNEXPECTED, TWO_ASSAY_CONFIRMED**

EN: "This is not the recovery I expected. Your index went up from 37 to 53, and we are 45 days past landing,
outside the flight window. Two independent tests on the same blood agree: IL-6 is up on both, and IL-8 is
about 47 times your baseline on one and about 40 times on the other. Blood markers cannot tell me the cause.
Let's do a quick symptom check and take your temperature now, and I recommend a re-test in 3 days and a note
to the flight surgeon at the next contact. Decision support, not a diagnosis."

MN: "Энэ бол миний хүлээж байсан сэргэлт биш байна. Таны индекс 37-оос 53 болж өссөн, газардсанаас хойш 45
хоног өнгөрсөн тул нислэгийн нөлөөний хугацаанаас гадуур байна. Ижил цусан дээр хийсэн бие даасан хоёр
шинжилгээ хоорондоо таарч байна: IL-6 хоёуланд нь өссөн, IL-8 нэгд нь суурь түвшнээс тань 47 орчим дахин,
нөгөөд нь 40 орчим дахин өндөр гарсан. Шалтгааныг цусны үзүүлэлтээр тодорхойлох боломжгүй. Одоо шинж тэмдгээ
хамт шалгаад биеийн температураа хэмжье. 3 хоногийн дараа давтан шинжилгээ өгч, дараагийн холболтоор нислэгийн
эмчид мэдэгдэхийг зөвлөж байна. Энэ бол шийдвэр гаргахад туслах мэдээлэл, онош биш."

**(d) Single-assay signal — C003, R+194, UNEXPECTED, SINGLE_ASSAY**

EN: "Your index is 57, which would normally count as unexpected activation this long after landing. But the
two tests on this sample disagree: one shows IL-6 at about 2.2 times your baseline, the other shows it below
baseline. With only one test saying so, I would not act on it yet. Let's repeat the measurement in 3 days and
decide then. Decision support, not a diagnosis."

MN: "Таны индекс 57 байна. Газардсанаас хойш ийм удсаны дараа энэ нь ердийн үед гэнэтийн идэвхжилд тооцогдоно.
Гэвч энэ дээжийн хоёр шинжилгээ хоорондоо зөрж байна: нэг нь IL-6-г суурь түвшнээс тань 2.2 орчим дахин өндөр,
нөгөө нь суурь түвшнээс доогуур гэж үзүүлсэн. Зөвхөн нэг шинжилгээ ингэж хэлж байгаа тул би одоохондоо үүн
дээр тулгуурлан арга хэмжээ авахгүй. 3 хоногийн дараа хэмжилтийг давтаад тэгээд шийдье. Энэ бол шийдвэр
гаргахад туслах мэдээлэл, онош биш."

## 5. Demo script (replaces spec §9)

| Time | Screen | Cosmo / presenter |
|---|---|---|
| 0:00–0:20 | Crew select -> C001, mission clock R+1 | Presenter: "Far from Earth a blood draw is rare. The question is not 'what are my numbers' but 'is this the flight, or something new — and can I trust the test?'" |
| 0:20–0:55 | Triage card 48 (40–60), EXPECTED, badge "Confirmed by two assays"; fingerprint bars | Cosmo (a), Mongolian, English captions |
| 0:55–1:10 | Recovery card: decay fan, re-test marker at day 22, kit chips | Presenter: "NASA has no sample between day 1 and day 45, so we give an upper bound and schedule the draw that closes the gap." |
| 1:10–1:25 | Clock R+45, C001: 1, BASELINE | Cosmo (c1), English |
| 1:25–2:00 | C002 at R+45: 53, UNEXPECTED, "Confirmed by two assays", IL-8 47x / 40x | Cosmo (c2). Presenter: "No flight, same pattern, two independent tests agree. Real Inspiration4 data." |
| 2:00–2:25 | C003 at R+194: 57, UNEXPECTED, badge "Single assay" | Cosmo (d). Presenter: "Here one test says alarm and the other says no. AEGIS does not escalate on one key." |
| 2:25–2:40 | Daily check-in (banner "simulated check-ins"), rule A2 | Cosmo (b) from spec §7.1 |
| 2:40–3:00 | Evidence card with the "Second assay" column, rejected ideas, QC log | Presenter: "Four people is not a study. We show what held up — IL-6 — and what did not." |

## 6. Build tasks (do after T8, before T9; T9 then uses §5 above)

### T11 — Load the second assay (30 min)
- Copy `expected_second_assay.json` to `src/data/signature_second_assay.json`.
- `loadSecondAssay()`: find the CSV whose name contains `Alamar`; BOM; first column `Sample ID`
  (`C001_serum_L-92`: part 0 crew, part 2 timepoint); use columns matching `^(.+)_concentration_npq$`.
- **Tests:** 27 rows, 203 analytes; C003 has no L-44; `il6` C004 R+1 = 14.53 (2 decimals);
  the main loader still returns the same matrix (run the T1–T3 tests again: all green).

### T12 — Cross-check engine (40 min)
Port `dev_primary`, `dev_second`, `status` and the badge rule from `reference_second_assay.py`.
`CONFIRM_LOG2 = 0.5` goes into `config.ts`. Add `secondAssay` to `PanelResult`:
`{ il6:{primaryFold, secondFold, status}, il8:{...}, badge }`. Extend `buildFacts` and `allowedNumbers`.
- **Tests (second fixture):**
  IL-6 status: C001 R+1 CONFIRMED (2.39 / 1.46); C003 R+1 NOT_CONFIRMED (2.85 / 1.06);
  C002 R+45 CONFIRMED (2.69 / 1.98); C003 R+194 NOT_CONFIRMED (2.16 / 0.54); C004 R+1 CONFIRMED (1.60 / 1.69);
  C002 R+1 NOT_APPLICABLE. IL-8 C002 R+45 CONFIRMED (47.04 / 40.11).
  Badges: exactly two TWO_ASSAY_CONFIRMED (C001 R+1, C002 R+45), two SINGLE_ASSAY (C003 R+1, C003 R+194),
  twelve null. Over the 16 panels IL-6 status counts: 4 CONFIRMED, 7 NOT_CONFIRMED, 5 NOT_APPLICABLE.
  C003 baseline on the second assay uses two draws (L-92, L-3).

### T13 — UI, templates, actions (45 min)
- Triage card: badge "Confirmed by two assays" (teal outline) or "Single assay" (amber outline) + tooltip
  with the two IL-6 folds. Fingerprint card: small "single-assay marker" tag on MCP-1, IL-10, IL-27.
- Evidence card: "Second assay" column and headline from `signature_second_assay.json`
  (`agreement`, `same_direction_4of4_on_both_assays_at_R1`, `L44_lowest_on_second_assay`).
- Templates: replace (a), (c1), (c2) with §4 and add (d); copy the Mongolian verbatim; placeholders for
  numbers. Template choice: UNEXPECTED + SINGLE_ASSAY -> (d); UNEXPECTED + TWO_ASSAY_CONFIRMED -> (c2).
- Actions table per §2. Draw advisor A5: re-test in 3 days for both badges; escalation flag only when
  TWO_ASSAY_CONFIRMED.
- **Tests:** (a) for C001 R+1 contains "48", "40", "60", "2.4", "21" and passes the number guard;
  (c2) for C002 R+45 contains "37", "53", "47", "40", "3"; (d) for C003 R+194 contains "57", "2.2", "3" and
  does not contain the words "flight surgeon"; C001 first re-test offset is 21 (mission day 22).

## 7. Sources

Same dataset as spec ref. [2]: OSD-575, DOI 10.26030/mc5d-p710, file
`LSDS-8_Multiplex_serum.immune.AlamarPanel_TRANSFORMED.csv`. NPQ = log2 of normalised counts, per the OSD-575
protocol text.
