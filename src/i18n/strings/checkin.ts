import type { AreaDicts } from "../types";

/**
 * Check-in screen strings. Keys are prefixed "checkin." and identical in en and mn.
 * Mongolian is natural, short Cyrillic; a native speaker reviews it before release.
 */
export const checkinStrings: AreaDicts = {
  en: {
    "checkin.page.label": "Daily check-in with Cosmo",
    "checkin.starting": "Starting your check-in...",
    "checkin.start.failed": "The check-in could not be started.",

    "checkin.stage.label": "Cosmo, your health companion",
    "checkin.status.idle": "Ready when you are",
    "checkin.status.listening": "Listening",
    "checkin.status.thinking": "Thinking",
    "checkin.status.speaking": "Cosmo is speaking",

    "checkin.transcript.label": "Conversation",
    "checkin.transcript.empty": "Your conversation appears here.",
    "checkin.transcript.you": "You",
    "checkin.transcript.cosmo": "Cosmo",
    "checkin.transcript.transcribing": "Listening to what you said...",

    "checkin.cards.title": "Captured today",
    "checkin.cards.count": "{count} of {total} measurements",
    "checkin.cards.empty": "Measurements appear here as you say them.",
    "checkin.card.fromYourWords": "from your words: \"{text}\"",
    "checkin.card.corrected": "Corrected",
    "checkin.card.captured": "Captured {label}: {value}, {status}",
    "checkin.card.reason.fixed_range": "Outside the demo range",
    "checkin.card.reason.baseline": "Differs from your usual",
    "checkin.card.reason.combo_rule": "Flagged by a combined rule",
    "checkin.card.reason.keyword_rule": "Flagged by a keyword rule",
    "checkin.card.reason.missing": "No value",

    "checkin.clarify.title": "Cosmo needs one more detail: {label}",
    "checkin.clarify.dismiss": "Dismiss this note",

    "checkin.mic.idle": "Tap to talk",
    "checkin.mic.listening": "Listening. Tap to send",
    "checkin.mic.pushToTalk": "Release to send",
    "checkin.mic.thinking": "Thinking",
    "checkin.mic.speaking": "Cosmo is speaking",
    "checkin.mic.unavailable": "Microphone not available",
    "checkin.mic.aria.idle": "Start talking to Cosmo",
    "checkin.mic.aria.listening": "Stop listening and send what you said",
    "checkin.mic.aria.thinking": "Cosmo is thinking",
    "checkin.mic.aria.speaking": "Interrupt Cosmo and talk",
    "checkin.mic.aria.unavailable": "Microphone not available, use the text box",
    "checkin.mic.hint": "Tap to talk. Hold the button, or hold Space while it is focused, for push-to-talk.",

    "checkin.text.label": "Type your answer",
    "checkin.text.placeholder": "Or type your answer here",
    "checkin.text.send": "Send",

    "checkin.demo.run": "Run demo",
    "checkin.demo.stop": "Stop demo",
    "checkin.demo.running": "Demo is running",
    "checkin.demo.hint": "Scripted mode is on. Press Run demo to play the full check-in.",
    "checkin.demo.failed": "The demo script could not be loaded.",

    "checkin.banner.browserVoice": "Using the browser voice for Cosmo",
    "checkin.banner.noSpeaker": "Cosmo cannot speak here. Replies are shown as text.",

    "checkin.error.generic": "Something went wrong. Please try again.",
    "checkin.error.network": "Connection problem. Please try again.",
    "checkin.error.stt": "I could not make out that recording. Please try again or type your answer.",
    "checkin.error.llm": "Cosmo could not reply just now. Please try again.",
    "checkin.error.wrongState": "That is not possible at this step of the check-in.",
    "checkin.error.dashboard": "The dashboard could not be loaded.",
    "checkin.dashboard.retry": "Show dashboard",
    "checkin.dashboard.opening": "Opening your dashboard...",
  },
  mn: {
    "checkin.page.label": "Cosmo-той өдөр тутмын үзлэг",
    "checkin.starting": "Үзлэгийг эхлүүлж байна...",
    "checkin.start.failed": "Үзлэгийг эхлүүлж чадсангүй.",

    "checkin.stage.label": "Cosmo, таны эрүүл мэндийн хамтрагч",
    "checkin.status.idle": "Бэлэн байна",
    "checkin.status.listening": "Сонсож байна",
    "checkin.status.thinking": "Бодож байна",
    "checkin.status.speaking": "Cosmo ярьж байна",

    "checkin.transcript.label": "Яриа",
    "checkin.transcript.empty": "Таны яриа энд харагдана.",
    "checkin.transcript.you": "Та",
    "checkin.transcript.cosmo": "Cosmo",
    "checkin.transcript.transcribing": "Таны хэлснийг сонсож байна...",

    "checkin.cards.title": "Өнөөдөр бүртгэсэн",
    "checkin.cards.count": "{total} хэмжилтийн {count}",
    "checkin.cards.empty": "Таны хэлсэн хэмжилтүүд энд гарч ирнэ.",
    "checkin.card.fromYourWords": "таны үгнээс: \"{text}\"",
    "checkin.card.corrected": "Засварласан",
    "checkin.card.captured": "{label} бүртгэгдлээ: {value}, {status}",
    "checkin.card.reason.fixed_range": "Демо хязгаараас гадуур",
    "checkin.card.reason.baseline": "Таны ердийн түвшнээс өөр",
    "checkin.card.reason.combo_rule": "Хосолсон дүрмээр тэмдэглэсэн",
    "checkin.card.reason.keyword_rule": "Түлхүүр үгийн дүрмээр тэмдэглэсэн",
    "checkin.card.reason.missing": "Утга алга",

    "checkin.clarify.title": "Cosmo нэг зүйлийг тодруулах хэрэгтэй: {label}",
    "checkin.clarify.dismiss": "Энэ тэмдэглэлийг хаах",

    "checkin.mic.idle": "Ярихын тулд дарна уу",
    "checkin.mic.listening": "Сонсож байна. Илгээхийн тулд дарна уу",
    "checkin.mic.pushToTalk": "Илгээхийн тулд тавина уу",
    "checkin.mic.thinking": "Бодож байна",
    "checkin.mic.speaking": "Cosmo ярьж байна",
    "checkin.mic.unavailable": "Микрофон ашиглах боломжгүй",
    "checkin.mic.aria.idle": "Cosmo-той ярьж эхлэх",
    "checkin.mic.aria.listening": "Сонсохоо болиод хэлснийг илгээх",
    "checkin.mic.aria.thinking": "Cosmo бодож байна",
    "checkin.mic.aria.speaking": "Cosmo-г таслан ярих",
    "checkin.mic.aria.unavailable": "Микрофон ашиглах боломжгүй, бичих талбарыг ашиглана уу",
    "checkin.mic.hint": "Ярихын тулд дарна уу. Товчийг дарж барьж, эсвэл товч дээр байхдаа Space дарж барьж ярьж болно.",

    "checkin.text.label": "Хариултаа бичнэ үү",
    "checkin.text.placeholder": "Эсвэл хариултаа энд бичнэ үү",
    "checkin.text.send": "Илгээх",

    "checkin.demo.run": "Демо ажиллуулах",
    "checkin.demo.stop": "Демог зогсоох",
    "checkin.demo.running": "Демо явж байна",
    "checkin.demo.hint": "Бэлдсэн хөтөлбөрийн горим асаалттай. Бүтэн үзлэгийг тоглуулахын тулд Демо ажиллуулах товчийг дарна уу.",
    "checkin.demo.failed": "Демо хөтөлбөрийг ачаалж чадсангүй.",

    "checkin.banner.browserVoice": "Cosmo-гийн дуунд хөтчийн дууг ашиглаж байна",
    "checkin.banner.noSpeaker": "Cosmo энд дуугаар ярих боломжгүй. Хариултыг бичвэрээр харуулна.",

    "checkin.error.generic": "Алдаа гарлаа. Дахин оролдоно уу.",
    "checkin.error.network": "Холболтын алдаа. Дахин оролдоно уу.",
    "checkin.error.stt": "Бичлэгийг ойлгож чадсангүй. Дахин оролдох эсвэл хариултаа бичнэ үү.",
    "checkin.error.llm": "Cosmo яг одоо хариулж чадсангүй. Дахин оролдоно уу.",
    "checkin.error.wrongState": "Үзлэгийн энэ алхамд боломжгүй байна.",
    "checkin.error.dashboard": "Хяналтын самбарыг ачаалж чадсангүй.",
    "checkin.dashboard.retry": "Хяналтын самбар харуулах",
    "checkin.dashboard.opening": "Хяналтын самбарыг нээж байна...",
  },
};
