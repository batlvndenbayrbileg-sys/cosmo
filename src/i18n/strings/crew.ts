import type { AreaDicts } from "../types";

/** Crew-select screen strings. Keys are prefixed "crew." and identical in en and mn. */
export const crewStrings: AreaDicts = {
  en: {
    "crew.title": "Who is checking in?",
    "crew.subtitle": "Choose your profile to start today's check-in with Cosmo.",
    "crew.list.label": "Crew members",
    "crew.card.start": "Start check-in",
    "crew.card.starting": "Opening...",
    "crew.card.aria": "{name}, {role}. Start the daily check-in.",
    "crew.card.language": "Language: {language}",
    "crew.loading": "Loading the crew...",
    "crew.empty": "No crew members found.",
    "crew.error.load": "The crew list could not be loaded.",
    "crew.error.session": "The session could not be opened. Please try again.",
    "crew.privacy": "No health data is shown on this screen.",
    "crew.earth.link": "Earth console",
    "crew.earth.hint": "Read-only view for the ground team (simulated link)",

    "crew.role.flight_engineer": "Flight engineer",
    "crew.role.mission_specialist": "Mission specialist",
    "crew.role.commander": "Commander",
    "crew.role.medical_officer": "Medical officer",
  },
  mn: {
    "crew.title": "Хэн үзлэгт орох вэ?",
    "crew.subtitle": "Cosmo-той өнөөдрийн үзлэгээ эхлэхийн тулд өөрийн профайлыг сонгоно уу.",
    "crew.list.label": "Багийн гишүүд",
    "crew.card.start": "Үзлэг эхлэх",
    "crew.card.starting": "Нээж байна...",
    "crew.card.aria": "{name}, {role}. Өдөр тутмын үзлэгийг эхлэх.",
    "crew.card.language": "Хэл: {language}",
    "crew.loading": "Багийн жагсаалтыг ачаалж байна...",
    "crew.empty": "Багийн гишүүн олдсонгүй.",
    "crew.error.load": "Багийн жагсаалтыг ачаалж чадсангүй.",
    "crew.error.session": "Сесс нээж чадсангүй. Дахин оролдоно уу.",
    "crew.privacy": "Энэ дэлгэцэд эрүүл мэндийн мэдээлэл харуулахгүй.",
    "crew.earth.link": "Дэлхийн хяналтын самбар",
    "crew.earth.hint": "Газрын багт зориулсан зөвхөн харах горим (симуляци холбоо)",

    "crew.role.flight_engineer": "Нислэгийн инженер",
    "crew.role.mission_specialist": "Нислэгийн мэргэжилтэн",
    "crew.role.commander": "Командлагч",
    "crew.role.medical_officer": "Эмнэлгийн офицер",
  },
};
