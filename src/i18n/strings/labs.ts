import type { AreaDicts } from "../types";

/**
 * Dashboard "Labs" tab: the urine panel (NASA OSDR OSD-656, Inspiration4 urine, Alamar NULISA). Keys are
 * "dashboard.labs.*" and live in the dashboard area (src/i18n/dictionary.ts). Display only: the wording describes change
 * against the person's own pre-flight urine and never names a disease. Mongolian still needs a native-speaker review.
 */
export const labsStrings: AreaDicts = {
  en: {
    "dashboard.labs.titleLight": "Urine",
    "dashboard.labs.titleStrong": "panel",
    "dashboard.labs.caption": "Changes versus your own pre-flight urine. Not a clinical test or a diagnosis.",
    "dashboard.labs.dilution": "Urine is easily diluted, so Borderline means: confirm before acting.",
    "dashboard.labs.source":
      "Data: NASA OSDR OSD-656, Inspiration4 urine, Alamar NULISA panel (NPQ, log2). Linked Inspiration4 reference crew member {person}, shown for demonstration.",
    "dashboard.labs.loading": "Loading the urine panel...",
    "dashboard.labs.error": "Could not load the urine panel. Try again later.",
    "dashboard.labs.retry": "Try again",
    "dashboard.labs.unlinked": "No reference urine panel is linked to this crew member.",

    "dashboard.labs.tp.label": "Post-flight time point",
    "dashboard.labs.tp.day": "Day {n} after landing",
    "dashboard.labs.tp.noSample": "No sample",
    "dashboard.labs.tp.aria": "{tp}: {normal} Normal, {borderline} Borderline, {abnormal} Abnormal, {insufficient} Insufficient",
    "dashboard.labs.tp.ariaNoSample": "{tp}: no urine sample",
    "dashboard.labs.noSample": "No urine sample at this time point.",

    "dashboard.labs.group.normal": "Normal",
    "dashboard.labs.group.borderline": "Borderline",
    "dashboard.labs.group.abnormal": "Abnormal",
    "dashboard.labs.group.insufficient": "Insufficient",

    "dashboard.labs.list.title": "Flagged at {tp}",
    "dashboard.labs.list.count": "{n} of {total} analytes",
    "dashboard.labs.list.none": "Nothing flagged at this time point: every analyte is inside the personal range or has too little data.",
    "dashboard.labs.list.hint": "Choose an analyte to see its course.",
    "dashboard.labs.dir.up": "higher",
    "dashboard.labs.dir.down": "lower",
    "dashboard.labs.foldAria": "{fold} versus baseline",

    "dashboard.labs.status.baseline": "Baseline",
    "dashboard.labs.status.normal": "Normal",
    "dashboard.labs.status.borderline_high": "Borderline high",
    "dashboard.labs.status.borderline_low": "Borderline low",
    "dashboard.labs.status.abnormal_high": "Abnormal high",
    "dashboard.labs.status.abnormal_low": "Abnormal low",
    "dashboard.labs.status.not_detected": "Not detected",
    "dashboard.labs.status.insufficient_data": "Insufficient data",

    "dashboard.labs.note.baseline": "Used to set personal baseline",
    "dashboard.labs.note.not_detected": "Not detected in this sample",
    "dashboard.labs.note.moderate": "Moderate change; confirm before acting",
    "dashboard.labs.note.dilution": "Outside range only before sample-level adjustment (possible dilution effect)",
    "dashboard.labs.note.outside_both": "Outside personal range, also after sample-level adjustment",
    "dashboard.labs.note.few_baseline": "Baseline has fewer than 2 detected values",

    "dashboard.labs.chart.title": "{analyte} over time",
    "dashboard.labs.chart.empty": "Choose an analyte in the list to see its course.",
    "dashboard.labs.chart.band": "Personal range",
    "dashboard.labs.chart.baseline": "Pre-flight baseline (mean)",
    "dashboard.labs.chart.pre": "Pre-flight sample (baseline)",
    "dashboard.labs.chart.post": "Post-flight sample",
    "dashboard.labs.chart.axisX": "Days from launch (L-) and from landing (R+)",
    "dashboard.labs.chart.axisY": "NPQ (log2)",
    "dashboard.labs.chart.range": "Personal range {low} to {high}, baseline {baseline}.",
    "dashboard.labs.chart.noRange": "No personal range: the baseline has fewer than 2 detected values.",
    "dashboard.labs.chart.point": "{tp}: {value}",
    "dashboard.labs.chart.notDetected": "not detected",
    "dashboard.labs.chart.method":
      "Range: baseline plus or minus the larger of 1.0 log2 (2-fold) or 3 times the typical pre-flight variation. Abnormal: outside the range before and after the sample-level adjustment.",
  },
  mn: {
    "dashboard.labs.titleLight": "Шээсний",
    "dashboard.labs.titleStrong": "шинжилгээ",
    "dashboard.labs.caption": "Нислэгийн өмнөх өөрийн шээстэй харьцуулсан өөрчлөлт. Эмнэлгийн шинжилгээ эсвэл онош биш.",
    "dashboard.labs.dilution": "Шээс амархан шингэрдэг тул «Хязгаарт ойр» гэдэг нь: арга хэмжээ авахаасаа өмнө дахин шалгана уу.",
    "dashboard.labs.source":
      "Өгөгдөл: NASA OSDR OSD-656, Inspiration4-ийн шээс, Alamar NULISA (NPQ, log2). Холбосон Inspiration4-ийн жишиг багийн гишүүн {person}, үзүүлэх зорилгоор.",
    "dashboard.labs.loading": "Шээсний шинжилгээг ачаалж байна...",
    "dashboard.labs.error": "Шээсний шинжилгээг ачаалж чадсангүй. Дараа дахин оролдоно уу.",
    "dashboard.labs.retry": "Дахин оролдох",
    "dashboard.labs.unlinked": "Энэ багийн гишүүнд холбосон жишиг шээсний шинжилгээ алга.",

    "dashboard.labs.tp.label": "Нислэгийн дараах хугацаа",
    "dashboard.labs.tp.day": "Газардсанаас хойш {n} дэх өдөр",
    "dashboard.labs.tp.noSample": "Дээж алга",
    "dashboard.labs.tp.aria": "{tp}: {normal} хэвийн, {borderline} хязгаарт ойр, {abnormal} хэвийн бус, {insufficient} хангалтгүй",
    "dashboard.labs.tp.ariaNoSample": "{tp}: шээсний дээж алга",
    "dashboard.labs.noSample": "Энэ хугацаанд шээсний дээж аваагүй.",

    "dashboard.labs.group.normal": "Хэвийн",
    "dashboard.labs.group.borderline": "Хязгаарт ойр",
    "dashboard.labs.group.abnormal": "Хэвийн бус",
    "dashboard.labs.group.insufficient": "Хангалтгүй",

    "dashboard.labs.list.title": "{tp}-д тэмдэглэгдсэн",
    "dashboard.labs.list.count": "{total} үзүүлэлтээс {n}",
    "dashboard.labs.list.none": "Энэ хугацаанд тэмдэглэгдсэн зүйл алга: бүх үзүүлэлт хувийн хүрээндээ байна эсвэл мэдээлэл хангалтгүй.",
    "dashboard.labs.list.hint": "Явцыг харахын тулд үзүүлэлт сонгоно уу.",
    "dashboard.labs.dir.up": "өндөр",
    "dashboard.labs.dir.down": "бага",
    "dashboard.labs.foldAria": "суурьтай харьцуулахад {fold}",

    "dashboard.labs.status.baseline": "Суурь",
    "dashboard.labs.status.normal": "Хэвийн",
    "dashboard.labs.status.borderline_high": "Хязгаарт ойр, өндөр",
    "dashboard.labs.status.borderline_low": "Хязгаарт ойр, бага",
    "dashboard.labs.status.abnormal_high": "Хэвийн бус, өндөр",
    "dashboard.labs.status.abnormal_low": "Хэвийн бус, бага",
    "dashboard.labs.status.not_detected": "Илрээгүй",
    "dashboard.labs.status.insufficient_data": "Мэдээлэл хангалтгүй",

    "dashboard.labs.note.baseline": "Хувийн суурь түвшинг тогтооход ашигласан",
    "dashboard.labs.note.not_detected": "Энэ дээжинд илрээгүй",
    "dashboard.labs.note.moderate": "Дунд зэргийн өөрчлөлт; арга хэмжээ авахаасаа өмнө дахин шалгана уу",
    "dashboard.labs.note.dilution": "Зөвхөн дээжийн тохируулгын өмнө хүрээнээс гадуур (шингэрэлтийн нөлөө байж болзошгүй)",
    "dashboard.labs.note.outside_both": "Дээжийн тохируулгын дараа ч хувийн хүрээнээс гадуур",
    "dashboard.labs.note.few_baseline": "Суурь түвшинд илэрсэн утга 2-оос цөөн",

    "dashboard.labs.chart.title": "{analyte}-ийн явц",
    "dashboard.labs.chart.empty": "Явцыг харахын тулд жагсаалтаас үзүүлэлт сонгоно уу.",
    "dashboard.labs.chart.band": "Хувийн хүрээ",
    "dashboard.labs.chart.baseline": "Нислэгийн өмнөх суурь (дундаж)",
    "dashboard.labs.chart.pre": "Нислэгийн өмнөх дээж (суурь)",
    "dashboard.labs.chart.post": "Нислэгийн дараах дээж",
    "dashboard.labs.chart.axisX": "Хөөрөхөөс өмнөх (L-) ба газардсанаас хойших (R+) өдөр",
    "dashboard.labs.chart.axisY": "NPQ (log2)",
    "dashboard.labs.chart.range": "Хувийн хүрээ {low}-{high}, суурь {baseline}.",
    "dashboard.labs.chart.noRange": "Хувийн хүрээ алга: суурь түвшинд илэрсэн утга 2-оос цөөн.",
    "dashboard.labs.chart.point": "{tp}: {value}",
    "dashboard.labs.chart.notDetected": "илрээгүй",
    "dashboard.labs.chart.method":
      "Хүрээ: суурь дээр нэмэх хасах нь 1.0 log2 (2 дахин) эсвэл нислэгийн өмнөх ердийн хэлбэлзлийн 3 дахиныг, аль ихийг нь. Хэвийн бус: дээжийн тохируулгын өмнө ч, дараа ч хүрээнээс гадуур.",
  },
};
