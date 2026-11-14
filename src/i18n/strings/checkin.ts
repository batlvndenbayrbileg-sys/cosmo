import type { AreaDicts } from "../types";

/**
 * Check-in screen strings. Keys are prefixed "checkin." and identical in en and mn.
 * Mongolian is natural, short Cyrillic; a native speaker reviews it before release.
 */
export const checkinStrings: AreaDicts = {
  en: {
    "checkin.page.label": "Daily check-in with Cosmo",
    "checkin.start.failed": "The check-in could not be started.",

    "checkin.stage.label": "Cosmo, your health companion",
    "checkin.status.idle": "Ready when you are",
    "checkin.status.listening": "Listening",
    "checkin.status.thinking": "Thinking",
    "checkin.status.speaking": "Cosmo is speaking",

    "checkin.mascot.talk": "Talk to Cosmo",
    "checkin.mascot.stop": "Stop listening and send",
    "checkin.hint.space": "Hold Space to talk, or tap Cosmo.",
    "checkin.tapToStart": "Tap to start",
    "checkin.back": "Back to crew select",

    "checkin.captions.toggle": "Captions",
    "checkin.captions.transcribing": "Writing down what you said…",

    "checkin.bubbles.title": "Captured today",
    "checkin.bubble.bp": "Blood pressure",
    "checkin.card.captured": "Captured {label}: {value}, {status}",

    "checkin.clarify.title": "One more detail: {label}",

    "checkin.keyboard.open": "Type instead",
    "checkin.keyboard.close": "Close typing",
    "checkin.text.label": "Type your answer",
    "checkin.text.placeholder": "Type your answer…",
    "checkin.text.send": "Send",

    "checkin.demo.run": "Run demo",
    "checkin.demo.stop": "Stop demo",
    "checkin.demo.running": "Demo is running",
    "checkin.demo.failed": "The demo script could not be loaded.",

    "checkin.preparing": "Preparing your dashboard…",

    "checkin.banner.browserVoice": "Using the browser voice for Cosmo",

    "checkin.error.generic": "Something went wrong. Please try again.",
    "checkin.error.network": "Connection problem. Please try again.",
    "checkin.error.stt": "I could not make out that recording. Please try again or type your answer.",
    "checkin.error.llm": "Cosmo could not reply just now. Please try again.",
    "checkin.error.wrongState": "That is not possible at this step of the check-in.",
    "checkin.error.dashboard": "The dashboard could not be loaded.",
    "checkin.dashboard.retry": "Show dashboard",
  },
  mn: {
    "checkin.page.label": "Cosmo-той өдөр тутмын үзлэг",
    "checkin.start.failed": "Үзлэгийг эхлүүлж чадсангүй.",

    "checkin.stage.label": "Cosmo, таны эрүүл мэндийн хамтрагч",
    "checkin.status.idle": "Бэлэн байна",
    "checkin.status.listening": "Сонсож байна",
    "checkin.status.thinking": "Бодож байна",
    "checkin.status.speaking": "Cosmo ярьж байна",

    "checkin.mascot.talk": "Cosmo-той ярих",
    "checkin.mascot.stop": "Сонсохоо зогсоож илгээх",
    "checkin.hint.space": "Space товчийг дарж барин ярина уу, эсвэл Cosmo дээр дарна уу.",
    "checkin.tapToStart": "Дарж эхлүүлэх",
    "checkin.back": "Багийн гишүүн сонгох руу буцах",

    "checkin.captions.toggle": "Хадмал",
    "checkin.captions.transcribing": "Таны хэлснийг бичиж байна…",

    "checkin.bubbles.title": "Өнөөдөр бүртгэсэн",
    "checkin.bubble.bp": "Цусны даралт",
    "checkin.card.captured": "{label} бүртгэгдлээ: {value}, {status}",

    "checkin.clarify.title": "Нэг зүйл тодруулъя: {label}",

    "checkin.keyboard.open": "Бичиж хариулах",
    "checkin.keyboard.close": "Бичихийг хаах",
    "checkin.text.label": "Хариултаа бичнэ үү",
    "checkin.text.placeholder": "Хариултаа бичнэ үү…",
    "checkin.text.send": "Илгээх",

    "checkin.demo.run": "Демо ажиллуулах",
    "checkin.demo.stop": "Демог зогсоох",
    "checkin.demo.running": "Демо явж байна",
    "checkin.demo.failed": "Демо хөтөлбөрийг ачаалж чадсангүй.",

    "checkin.preparing": "Хяналтын самбарыг бэлдэж байна…",

    "checkin.banner.browserVoice": "Cosmo-гийн дуунд хөтчийн дууг ашиглаж байна",

    "checkin.error.generic": "Алдаа гарлаа. Дахин оролдоно уу.",
    "checkin.error.network": "Холболтын алдаа. Дахин оролдоно уу.",
    "checkin.error.stt": "Бичлэгийг ойлгож чадсангүй. Дахин оролдох эсвэл хариултаа бичнэ үү.",
    "checkin.error.llm": "Cosmo яг одоо хариулж чадсангүй. Дахин оролдоно уу.",
    "checkin.error.wrongState": "Үзлэгийн энэ алхамд боломжгүй байна.",
    "checkin.error.dashboard": "Хяналтын самбарыг ачаалж чадсангүй.",
    "checkin.dashboard.retry": "Хяналтын самбар харуулах",
  },
};
