import type { CrewPublic, KpiKey, Lang, MeasurementValue, QuestionId } from "@/lib/types";
import { KPI_DEFS, formatValue } from "@/lib/kpi/registry";
import { namesConditionOrDrug } from "./companion";
import { cursorQuestion, type MachineCtx } from "./machine";
import { greetingName } from "./templates";
import { detectAskedQuestion, isHealthTopic } from "./questions";

/**
 * Assistant mode: the default conversation of the "/" screen (team request 2026-11-15: "first of all it should simply be
 * a friendly helper, like a nurse who gives advice; the daily check-up opens only when it is asked for").
 *
 * It lives on today's check-in row as a flag next to the check-up (MachineCtx.assistant), like friend mode: while it is
 * on the check-up waits exactly where it was, the machine produces no check-up reply (machine.ts), and nothing is
 * recorded unless the astronaut volunteers a value and says yes to "shall I add it?". "Start my daily check-up" (or the
 * button) switches it off and the check-up picks up where it stands; "back to assistant" (or the button) switches it on
 * again, keeping the check-up's progress.
 *
 * This module is pure (no I/O): the commands, the two switches, the code-written replies in both languages, and the
 * sanity check for wording written by the live model. assistantTurn.ts runs it.
 */

/* ───────────── commands ───────────── */

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`]/gu, "'")
    .replace(/[«»"“”]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** a question about the check-up rather than an order to start it ("what is the daily check-up?") */
const QUESTION_ABOUT = /[?？]|\b(?:what|why|how|when|which|is|does|did)\b|(?<![\p{L}])(?:вэ|бэ|юу|уу|үү|юү|ямар|яагаад|хэзээ|хэд)(?![\p{L}])/u;

const CHECKUP_EN = /\b(?:start|begin|do|open|continue|resume|restart|run|go\s+to|go\s+on\s+with|get\s+(?:back\s+)?to|back\s+to|let'?s\s+(?:do|start|begin|continue))\s+(?:with\s+)?(?:my\s+|the\s+|our\s+|today'?s\s+)*(?:daily\s+)?(?:check[\s-]?ups?|check[\s-]?ins?|health\s+check)\b/u;
const CHECKUP_MN = /(?:өдрийн\s+)?(?:үзлэг|шалгалт)(?:ээ|ийг|ийгээ|аа|ыг|ыгаа)?\s+(?:эхл|эхэл|үргэлжл|хий|нээ)|(?:өдрийн\s+)?(?:үзлэг|шалгалт)(?:ээ|аа)?\s+(?:руу|рүү)\s+(?:буц|ор)|үзлэгт\s+ор/u;
/** the button's own words, said or typed alone ("Daily check-up", "Continue daily check-up", "Өдрийн үзлэг") */
const CHECKUP_BARE = /^(?:continue\s+)?(?:my\s+)?(?:the\s+)?daily\s+check[\s-]?up[.!]*$|^(?:өдрийн\s+)?үзлэг(?:ээ)?\s*(?:үргэлжлүүлэх)?[.!]*$|^өдрийн\s+үзлэг(?:ээ)?\s+үргэлжлүүлэх[.!]*$/u;

/** "start my daily check-up", "өдрийн үзлэг эхлүүлье", "continue my check-up" (never a question about it) */
export function isStartCheckup(text: string): boolean {
  const t = normalise(text);
  if (t.length === 0) return false;
  if (CHECKUP_BARE.test(t)) return true;
  if (!(CHECKUP_EN.test(t) || CHECKUP_MN.test(t))) return false;
  // "how do I start my check-up?" is a question; "can we start my check-up?" / "эхлүүлэх үү" is a polite order
  if (/^(?:can|could|shall|may|will)\s+(?:we|you|i)\b/u.test(t)) return true;
  if (/(?:эхл|эхэл|үргэлжл)[\p{L}]*\s+(?:үү|уу)[?？]?$/u.test(t)) return true;
  return !QUESTION_ABOUT.test(t);
}

const BACK_EN = /\b(?:(?:go\s+|get\s+|take\s+me\s+|switch\s+)?back\s+to\s+(?:the\s+)?(?:assistant|cosmo|chat|helper|talking|main\s+screen)|(?:stop|pause|leave|exit|quit)\s+(?:the\s+|my\s+)?(?:daily\s+)?check[\s-]?up)\b/u;
const BACK_MN = /(?:туслах|туслагч|cosmo|космо|ярианд|яриа|чат)(?:\s*(?:руу|рүү|луу|лүү))?(?:гаа|гээ)?\s*буц|үзлэг(?:ээ|ийг)?\s+(?:зогсоо|түр\s+зогсоо|орхи|болиу|боль)/u;
/** a bare "back" / "буцах" (the control's word); while friend mode is on it means "back to the check-in" instead */
const BACK_BARE = /^(?:go\s+)?back[.!]*$|^(?:буцах|буц|буцъя|буцая)[.!]*$/u;

/** "back to assistant", "буцах", "туслах руу буцъя", "stop the check-up" */
export function isBackToAssistant(text: string, companionOn: boolean): boolean {
  const t = normalise(text);
  if (t.length === 0) return false;
  if (BACK_EN.test(t) || BACK_MN.test(t)) return true;
  return !companionOn && BACK_BARE.test(t);
}

const DASHBOARD_EN = /\b(?:show|open|see|display|pull\s+up|go\s+to|bring\s+up)\s+(?:me\s+)?(?:my\s+|the\s+)?(?:health\s+)?(?:dashboard|results?\s+(?:page|screen|dashboard))\b|^(?:my\s+)?dashboard[.!]*$/u;
const DASHBOARD_MN = /(?:хяналтын\s+)?самбар(?:аа|ыг|ыгаа|ын)?\s*(?:харуул|нээ|үзүүл|харъя|харах|руу)/u;

/** "show my dashboard", "самбараа харуул" */
export function isShowDashboard(text: string): boolean {
  const t = normalise(text);
  return t.length > 0 && (DASHBOARD_EN.test(t) || DASHBOARD_MN.test(t));
}

const SWITCH_EN = /\b(?:switch|change)\s+(?:the\s+)?(?:person|user|profile|crew\s*member|astronaut|speaker)\b|\bsomeone\s+else\s+(?:is\s+)?(?:here|speaking|talking)\b|\bnew\s+person\b/u;
const SWITCH_MN = /хүн\s+солих|хүн\s+сольё|хэрэглэгч\s+солих|профайл\s+солих|өөр\s+хүн\s+(?:ярьж|байна)/u;

/** "switch person", "хүн солих": the screen forgets who is speaking and listens again */
export function isSwitchPerson(text: string): boolean {
  const t = normalise(text);
  return t.length > 0 && (SWITCH_EN.test(t) || SWITCH_MN.test(t));
}

const HELLO = /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|hiya|howdy|greetings|сайн\s+уу|сайн\s+байна\s+уу|сайн\s+байцгаана\s+уу|өглөөний\s+мэнд|мэнд\s+хүргэе|сайн\s+байна)(?:[\s,!.]+(?:cosmo|космо|there|everyone))?[\s,!.?]*$/u;

/** a plain hello, nothing else */
export function isHello(text: string): boolean {
  return HELLO.test(normalise(text));
}

/** questions about the person's own numbers and results (answered from the latest confirmed check-in) */
const RESULTS_WORDS =
  /\b(?:my\s+(?:results?|data|numbers|values|readings|vitals|health|trends?|history|scores?|readiness|status|sleep|mood|pulse|heart\s+rate|blood\s+pressure|temperature|glucose|water|exercise|workload)|how\s+am\s+i\s+doing|how\s+(?:did|was)\s+(?:i|my)\b|yesterday|last\s+check[\s-]?(?:up|in)|trend|lately)\b|(?:миний|минийх|өөрийн)\s+\p{L}+|үр\s+дүн|өчигдөр|сүүлийн\s+үзлэг|хандлага|би\s+ямар\s+байна|ямар\s+байгаа\s+вэ/iu;

export function asksAboutOwnData(text: string): boolean {
  return RESULTS_WORDS.test(text);
}

/* ───────────── the two switches ───────────── */

/** where the check-up picks up when the astronaut starts or continues it */
export type CheckupResume = "greeting" | "propose" | "question" | "readBack" | "dashboard";

export type CheckupProgress = "not_started" | "in_progress" | "done";

/** how far today's check-up is: nothing said yet, under way (or paused), or confirmed */
export function checkupProgress(ctx: Pick<MachineCtx, "state" | "filled" | "smallTalkTurns">): CheckupProgress {
  if (ctx.state === "DONE" || ctx.state === "SUMMARY") return "done";
  if (ctx.state === "GREETING" && ctx.smallTalkTurns === 0) return "not_started";
  return "in_progress";
}

/** assistant mode on: the check-up is paused where it is (friend mode inside the check-up ends; a crisis stays known) */
export function enterAssistant(ctx: MachineCtx): MachineCtx {
  return { ...ctx, assistant: true, assistantOffer: null, assistantTalkTurns: 0, companion: false, companionTurns: 0 };
}

/**
 * Assistant mode off: the check-up resumes where it stands. A check-up that never started is greeted (its first answer is
 * the small talk, as on the old check-in screen); small talk goes on with the proposal; the measurements re-ask the open
 * question; the read-back is read again; a confirmed check-up opens the dashboard.
 */
export function startCheckup(ctx: MachineCtx): { ctx: MachineCtx; resume: CheckupResume; question: QuestionId | null } {
  const base: MachineCtx = { ...ctx, assistant: false, assistantOffer: null, assistantTalkTurns: 0 };
  switch (ctx.state) {
    case "GREETING":
      return { ctx: base, resume: "greeting", question: null };
    case "SMALL_TALK":
      return { ctx: { ...base, proposed: true }, resume: "propose", question: null };
    case "KPI_CAPTURE": {
      const next = cursorQuestion(base);
      if (next === null) return { ctx: { ...base, state: "CONFIRM" }, resume: "readBack", question: null };
      return { ctx: base, resume: "question", question: next };
    }
    case "CONFIRM":
      return { ctx: base, resume: "readBack", question: null };
    case "SUMMARY":
    case "DONE":
      return { ctx: base, resume: "dashboard", question: null };
  }
}

/* ───────────── code-written words ───────────── */

export function nameGreeting(crew: CrewPublic, lang: Lang): string {
  const name = greetingName(crew, lang);
  return lang === "mn" ? `Сайн уу, ${name}!` : `Hi ${name}!`;
}

/** the first Cosmo line of a new assistant conversation (stored as the greeting turn) */
export function assistantGreeting(crew: CrewPublic, lang: Lang): string {
  return lang === "mn"
    ? `${nameGreeting(crew, lang)} Би Cosmo, таны эрүүл мэндийн туслах. Юу ч асууж болно, бэлэн болохоороо «өдрийн үзлэг эхлүүлье» гэж хэлээрэй.`
    : `${nameGreeting(crew, lang)} I'm Cosmo, your health helper on board. Ask me anything, and say "start my daily check-up" whenever you're ready.`;
}

/** after the person was switched (a correction or a tap on the name) on a conversation that already exists */
export function welcomeBack(crew: CrewPublic, lang: Lang): string {
  return lang === "mn" ? `${nameGreeting(crew, lang)} Би энд байна, юугаар туслах вэ?` : `${nameGreeting(crew, lang)} I'm right here. How can I help?`;
}

/** the answer to a plain hello */
export function intro(lang: Lang): string {
  return lang === "mn"
    ? "Би Cosmo, таны эрүүл мэндийн туслах. Өнөөдөр юугаар туслах вэ?"
    : "I'm Cosmo, your health helper. How can I help you today?";
}

/** the reply when the person is greeted by name in the same line: the name greeting goes first, once */
export function withNameGreeting(reply: string, crew: CrewPublic, lang: Lang): string {
  const greet = nameGreeting(crew, lang);
  const t = reply.trim();
  if (t.startsWith(greet) || t.toLowerCase().startsWith(greet.slice(0, -1).toLowerCase())) return t;
  // a reply that opens with its own hello ("Hi! ...", "Сайн уу! ...") loses it, so the name is not greeted twice
  const rest = t.replace(/^(?:hi|hello|hey)(?:\s+there)?[!,.]\s*|^сайн\s+(?:байна\s+)?уу[!,.]\s*/iu, "");
  return `${greet} ${rest}`.trim();
}

export function checkupStartLine(resume: CheckupResume, lang: Lang): string {
  switch (resume) {
    case "greeting":
      return lang === "mn"
        ? "Өдрийн үзлэгээ эхэлцгээе. Өнөөдөр бие сэтгэл тань ямар байна даа?"
        : "Let's start your daily check-up. How are you feeling today?";
    case "propose":
      return lang === "mn" ? "Өдрийн үзлэгээ үргэлжлүүлье." : "Let's continue your daily check-up.";
    case "question":
    case "readBack":
      return lang === "mn" ? "Өдрийн үзлэгээ орхисон газраасаа үргэлжлүүлье." : "Let's pick up your daily check-up where we left off.";
    case "dashboard":
      return lang === "mn"
        ? "Өнөөдрийн үзлэг аль хэдийн дууссан. Үр дүн тань энд байна."
        : "Today's check-up is already done. Here are your results.";
  }
}

export function backToAssistantLine(progress: CheckupProgress, lang: Lang): string {
  if (progress === "in_progress") {
    return lang === "mn"
      ? "За, үзлэгийн явцыг хадгаллаа. Бэлэн болохоороо «үзлэгээ үргэлжлүүлье» гэж хэлээрэй. Одоо юугаар туслах вэ?"
      : "Sure, your check-up is saved where we left it. Say \"continue my check-up\" whenever you're ready. What can I help you with?";
  }
  if (progress === "done") {
    return lang === "mn"
      ? "За, би энд байна. Өнөөдрийн үр дүн тань самбар дээр хадгалагдсан. Юугаар туслах вэ?"
      : "Sure, I'm here. Today's results stay on your dashboard. What can I help you with?";
  }
  return lang === "mn" ? "За, би энд байна. Юугаар туслах вэ?" : "Sure, I'm here. What can I help you with?";
}

export const LINES = {
  alreadyHere: { en: "I'm right here. What can I help you with?", mn: "Би энд байна. Юугаар туслах вэ?" },
  dashboard: { en: "Here's your dashboard.", mn: "Хяналтын самбар тань энд байна." },
  noResults: {
    en: "There are no check-up results for you yet. Shall we start your daily check-up?",
    mn: "Танд одоогоор үзлэгийн үр дүн алга. Өдрийн үзлэгээ эхлэх үү?",
  },
  switchPerson: { en: "Of course. Who am I talking to now?", mn: "Мэдээж. Одоо хэнтэй ярьж байна вэ?" },
  recorded: { en: "Done, I've added it to today's check-up.", mn: "За, өнөөдрийн үзлэгт нэмлээ." },
  alreadyRecorded: {
    en: "That one is already in today's check-up; you can change it when we read the values back.",
    mn: "Энэ нь өнөөдрийн үзлэгт аль хэдийн байгаа, утгуудаа баталгаажуулах үед засч болно.",
  },
  declined: { en: "Okay, I won't note it.", mn: "За, тэмдэглэхгүй." },
  notNow: { en: "Okay, whenever you're ready.", mn: "За, бэлэн болохоороо хэлээрэй." },
  confirmedDay: {
    en: "Today's check-up is already confirmed, so I won't add new values now, but I'm glad you told me.",
    mn: "Өнөөдрийн үзлэг баталгаажсан тул одоо шинэ утга нэмэхгүй, гэхдээ хэлсэнд баярлалаа.",
  },
  unusable: {
    en: "I can't record that value, it looks outside the range I can take.",
    mn: "Энэ утгыг бүртгэх боломжгүй, авч болох хэмжээнээс гадуур байна.",
  },
  fallback: {
    en: "I can help with your health data and trends, normal ranges, emergency guides, a message to Earth, or your daily check-up. What would you like?",
    mn: "Би таны эрүүл мэндийн өгөгдөл, хэвийн хэмжээ, яаралтай тусламжийн заавар, Дэлхий рүү мэдэгдэх, өдрийн үзлэгт тусалж чадна. Юу хүсэж байна?",
  },
  offlineGeneral: {
    en: "I can't look that up right now, but I'm happy to help with your health data or your daily check-up.",
    mn: "Одоохондоо үүнийг хайж чадахгүй байна, гэхдээ таны эрүүл мэндийн өгөгдөл эсвэл өдрийн үзлэгт дуртай тусална.",
  },
  noData: {
    en: "I don't have any check-up results for you yet. Say \"start my daily check-up\" whenever you're ready and I'll show you everything after it.",
    mn: "Танд одоогоор үзлэгийн үр дүн алга. Бэлэн болохоороо «өдрийн үзлэг эхлүүлье» гэж хэлээрэй, дараа нь бүгдийг харуулъя.",
  },
  talkMore: { en: "What else can I help you with?", mn: "Өөр юугаар туслах вэ?" },
  labs: {
    en: "Here are the urine lab panels on screen. They are Inspiration4 reference data shown for demonstration, not your own samples.",
    mn: "Шээсний шинжилгээний самбарыг дэлгэцэнд харууллаа. Энэ нь үзүүлэх зорилгоор холбосон Inspiration4-ийн жишиг өгөгдөл, таны өөрийн дээж биш.",
  },
} as const satisfies Record<string, Record<Lang, string>>;

/** "heart rate 72 bpm" / "зүрхний цохилт 72 bpm" */
function describe(key: KpiKey, value: MeasurementValue, lang: Lang): string {
  const label = KPI_DEFS[key].labels[lang];
  return `${label.charAt(0).toLowerCase()}${label.slice(1)} ${formatValue(key, value, lang)}`;
}

/** "I heard heart rate 72 bpm. Shall I add it to today's check-up?" */
export function offerLine(records: ReadonlyArray<{ key: KpiKey; value: MeasurementValue }>, lang: Lang): string {
  const parts = records.map((r) => describe(r.key, r.value, lang));
  const list = parts.length <= 1 ? (parts[0] ?? "") : lang === "mn" ? parts.join(", ") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  if (lang === "mn") return `${list.charAt(0).toLocaleUpperCase("mn")}${list.slice(1)} гэж ойлголоо. Өнөөдрийн үзлэгт нэмэх үү?`;
  return `I heard ${list}. Shall I add ${parts.length > 1 ? "them" : "it"} to today's check-up?`;
}

/* ───────────── wording from the live model ───────────── */

const MAX_ASSISTANT_CHARS = 480;
const MAX_ASSISTANT_SENTENCES = 4;
const FORBIDDEN = /diagnos|prescri|medicat|dosage|treatment/iu;
const DOSE = /\bdoses?\b|\bmg\b|(?<![\p{L}])тун(?:г|гаар)?(?![\p{L}])/iu;
const NUMERAL = /\d+(?:[.,]\d+)?/gu;

function sentenceCount(text: string): number {
  return text
    .trim()
    .split(/(?<=[.!?…])\s+/u)
    .filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
}

/**
 * Model wording for an assistant answer is used only when it is short (at most 480 characters, four sentences), has no
 * emojis, no diagnosis / condition / drug / supplement / dose / treatment words, is in the conversation's language, and
 * every number in it comes from the code-computed facts or the astronaut's own words. A general question that is not
 * about health ("how fast does the station go?") may carry general-knowledge numbers, as in the check-up.
 * Otherwise the code-written reply is used.
 */
export function isSaneAssistantReply(text: string, facts: string, userText: string, lang: Lang): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_ASSISTANT_CHARS) return false;
  if (sentenceCount(t) > MAX_ASSISTANT_SENTENCES) return false;
  if (/\p{Extended_Pictographic}/u.test(t)) return false;
  if (FORBIDDEN.test(t) || namesConditionOrDrug(t) || DOSE.test(t)) return false;
  const cyrillic = (t.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const latin = (t.match(/\p{Script=Latin}/gu) ?? []).length;
  if (lang === "en" && cyrillic > 0) return false;
  if (lang === "mn" && (cyrillic === 0 || latin > Math.max(8, cyrillic / 5))) return false;
  const asked = detectAskedQuestion(userText, lang) ?? detectAskedQuestion(userText, lang === "mn" ? "en" : "mn");
  const general = asked !== null && asked !== "greeting" && !isHealthTopic(userText) && !isHealthTopic(t);
  if (general) return true;
  const allowed = new Set([...(facts.match(NUMERAL) ?? []), ...(userText.match(NUMERAL) ?? [])].map((n) => n.replace(",", ".")));
  return (t.match(NUMERAL) ?? []).every((n) => allowed.has(n.replace(",", ".")));
}

/** the directive for the live model's assistant answer (the frozen system prompt and tools stay the cache prefix) */
export function buildAssistantDirective(input: {
  lang: Lang;
  crewName: string;
  progress: CheckupProgress;
  facts: unknown;
}): string {
  const checkup =
    input.progress === "done"
      ? "done today (the results are on the dashboard)"
      : input.progress === "in_progress"
        ? "started today and paused; it resumes when the astronaut says \"continue my check-up\""
        : "not started today";
  const instruction = [
    "You are Cosmo in ASSISTANT mode, not the daily check-up: a warm, professional health helper on board, like a ship's nurse - friendly, calm and practical.",
    "Answer what the astronaut asks in at most three short sentences, plain spoken language, no lists, no emojis. You may answer general questions (space, the station, daily life) briefly.",
    "About their own data use ONLY the facts below and quote numbers exactly as written; never add, compute or estimate a number about their health. If the facts have no results, say so kindly.",
    "Give practical, everyday advice when it fits (rest, water, a steady sleep routine, moving, talking to a crewmate), but never diagnose, never name a disease, a drug, a supplement, a dose or a treatment. For anything medical beyond the facts, suggest the crew medical officer or the flight surgeon.",
    "Do not ask the daily check-up questions and do not record anything. If they want to log today's values, tell them to say \"start my daily check-up\".",
    "Do not call any tool.",
  ].join(" ");
  return [
    "DIRECTIVE (written by the system, not by the astronaut)",
    "mode: ASSISTANT",
    `reply_language: ${input.lang === "mn" ? "Mongolian (Cyrillic)" : "English"}`,
    `astronaut_name: ${input.crewName}`,
    `daily_check_up: ${checkup}`,
    `instruction: ${instruction}`,
    `facts: ${JSON.stringify(input.facts)}`,
  ].join("\n");
}
