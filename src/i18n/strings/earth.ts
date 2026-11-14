import type { AreaDicts } from "../types";

/**
 * Earth console (ground role), docs/DASHBOARD_PLAN.md section 4. Keys are prefixed "earth.".
 * Mongolian is short, natural Cyrillic and still needs a native-speaker review.
 */
export const earthStrings: AreaDicts = {
  en: {
    "earth.title": "Earth console - simulated link",
    "earth.subtitle": "Read-only view of crew status as it would arrive on Earth.",
    "earth.simulatedBadge": "Simulated link",

    "earth.delay.label": "Simulated link delay",
    "earth.delay.live": "Live",
    "earth.delay.3min": "3 min",
    "earth.delay.20min": "20 min",
    "earth.delay.hint": "Check-ins confirmed more recently than the delay are not shown yet.",
    "earth.delay.notNasa": "Delay options are a simulation setting, not NASA figures.",

    "earth.crew.title": "Crew",
    "earth.crew.readiness": "Readiness {value}",
    "earth.crew.readinessNone": "Readiness not available",
    "earth.crew.lastCheckIn": "Last check-in {time}",
    "earth.crew.noCheckIn": "No check-in visible yet",
    "earth.crew.openAlerts": "Open alerts: {count}",
    "earth.crew.alertBadge": "Alert raised",
    "earth.crew.open": "Open dashboard",
    "earth.crew.cardLabel": "{name}, {role}",

    "earth.alerts.title": "Alerts",
    "earth.alerts.subtitle": "Newest first",
    "earth.alerts.empty": "No alerts visible at this delay.",
    "earth.alerts.acknowledged": "Acknowledged",
    "earth.alerts.open": "Open",

    "earth.privacy.title": "Privacy",
    "earth.privacy.note":
      "All data is sent automatically (team decision); a crew consent switch is a planned addition.",
    "earth.privacy.noText": "Conversation turns and free-text notes are never shown here.",

    "earth.loading": "Loading crew status",
    "earth.error": "Could not load the Earth console.",

    "earth.crewPage.back": "All crew",
    "earth.crewPage.loading": "Loading dashboard",
    "earth.crewPage.error": "Could not load this dashboard.",
    "earth.crewPage.emptyTitle": "No data visible yet",
    "earth.crewPage.emptyBody":
      "Nothing from this crew member has reached Earth at this link delay. Try Live or a shorter delay.",
  },
  mn: {
    "earth.title": "Дэлхийн хяналтын төв - симуляци холболт",
    "earth.subtitle": "Багийн төлөв Дэлхийд хүрэх хэлбэрээрээ зөвхөн харах горимд харагдана.",
    "earth.simulatedBadge": "Симуляци холболт",

    "earth.delay.label": "Холболтын симуляци саатал",
    "earth.delay.live": "Шууд",
    "earth.delay.3min": "3 мин",
    "earth.delay.20min": "20 мин",
    "earth.delay.hint": "Саатлаас хойш баталгаажсан шалгалтууд хараахан харагдахгүй.",
    "earth.delay.notNasa": "Саатлын сонголтууд нь симуляцийн тохиргоо, НАСА-гийн тоо биш.",

    "earth.crew.title": "Баг",
    "earth.crew.readiness": "Бэлэн байдал {value}",
    "earth.crew.readinessNone": "Бэлэн байдлын оноо байхгүй",
    "earth.crew.lastCheckIn": "Сүүлийн шалгалт {time}",
    "earth.crew.noCheckIn": "Харагдах шалгалт хараахан алга",
    "earth.crew.openAlerts": "Нээлттэй сэрэмжлүүлэг: {count}",
    "earth.crew.alertBadge": "Сэрэмжлүүлэг гарсан",
    "earth.crew.open": "Самбар нээх",
    "earth.crew.cardLabel": "{name}, {role}",

    "earth.alerts.title": "Сэрэмжлүүлэг",
    "earth.alerts.subtitle": "Хамгийн сүүлийнх эхэнд",
    "earth.alerts.empty": "Энэ саатал дээр харагдах сэрэмжлүүлэг алга.",
    "earth.alerts.acknowledged": "Хүлээн зөвшөөрсөн",
    "earth.alerts.open": "Нээлттэй",

    "earth.privacy.title": "Нууцлал",
    "earth.privacy.note":
      "Бүх өгөгдлийг автоматаар илгээнэ (багийн шийдвэр). Багийн гишүүний зөвшөөрлийн унтраалга нэмэхээр төлөвлөсөн.",
    "earth.privacy.noText": "Яриа болон чөлөөт бичвэр тэмдэглэл энд хэзээ ч харагдахгүй.",

    "earth.loading": "Багийн төлвийг ачаалж байна",
    "earth.error": "Дэлхийн хяналтын төвийг ачаалж чадсангүй.",

    "earth.crewPage.back": "Бүх баг",
    "earth.crewPage.loading": "Самбарыг ачаалж байна",
    "earth.crewPage.error": "Энэ самбарыг ачаалж чадсангүй.",
    "earth.crewPage.emptyTitle": "Харагдах өгөгдөл хараахан алга",
    "earth.crewPage.emptyBody":
      "Энэ саатал дээр энэ гишүүнээс Дэлхийд хүрсэн мэдээлэл алга. Шууд эсвэл богино саатлыг сонгоно уу.",
  },
};
