import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { KpiKey, Lang, MeasurementValue, TurnRow } from "@/lib/types";
import type { HistoryDay } from "@/lib/health/baseline";
import { asNumber } from "@/lib/kpi/registry";
import {
  APP_CREW_REFERENCE_PANELS,
  POST_TIMEPOINTS,
  REFERENCE_CREW,
  TIMEPOINT_DAY,
  type ReferenceCrewId,
} from "@/lib/signature/config";
import { median, scorePanel } from "@/lib/signature/engine";
import {
  SIGNATURE_DISCLAIMER,
  assertNumbersGrounded,
  buildDrawFacts,
  buildFacts,
  hasDisclaimer,
  hasForbiddenWording,
  type DrawFacts,
  type SignatureFacts,
} from "@/lib/signature/facts";
import {
  SPOKEN_DRAW_RULES,
  renderDrawTemplate,
  renderTriageOffer,
  renderTriageTemplate,
} from "@/lib/signature/templates";
import { drawAdvice, drawStateFromPanels, dssSeries, strainDayFromKpis, strainDaysFromHistory } from "@/lib/signature/strain";
import type { PanelResult, Timepoint } from "@/lib/signature/types";
import { scorePanelWithSecondAssay } from "@/lib/signature/secondAssay";
import {
  assertNoOrbitClaim,
  buildSpaceFacts,
  onlyStatementSentences,
  orbitClaimFallback,
  spaceStatements,
  type SpaceFacts,
} from "@/lib/signature/spaceMeasurability";
import { getLabData, tryLoadSecondAssay } from "@/server/signature/files";
import { namesConditionOrDrug } from "./companion";

/**
 * Cosmo's Signature Triage tools (build prompt T6; integration map section 4.8).
 *
 * The frozen check-in tool list (tools.ts, six names pinned by tests/agent.tools.test.ts and sent byte-identical on
 * every request) and the frozen SYSTEM_PROMPT stay untouched. The two signature tools are defined here with the same
 * strict Anthropic shape and the same `{ ok, data }` result shape; code picks the tool from the astronaut's words
 * (`detectSignatureIntent`, deterministic like questions.ts), runs it, and hands its result to the model as the only
 * facts in a one-shot directive that carries the system-prompt addition (`SIGNATURE_PROMPT_ADDITION`). The model's text
 * is spoken only when it passes `acceptSignatureAnswer` (numbers grounded, disclaimer last, no forbidden wording);
 * otherwise, and always without a model (scripted mode, no key), the template is spoken.
 *
 * Panels are the Inspiration4 reference data (C001..C004). App crew are linked to one reference crew member each
 * (`APP_CREW_REFERENCE_PANELS`); the panel clock for an app crew member is the mission day of the check-in date.
 */

/* ───────────── tool definitions ───────────── */

export const SIGNATURE_TOOL_NAMES = ["get_signature_triage", "get_draw_advice"] as const;
export type SignatureToolName = (typeof SIGNATURE_TOOL_NAMES)[number];

export const SIGNATURE_TOOL_DEFINITIONS: readonly Anthropic.Tool[] = Object.freeze(
  [
    {
      name: "get_signature_triage",
      description:
        "Returns the code-computed Signature Triage facts of a blood panel (Inspiration4 reference data): class, Flight Response Index and band, the leading markers with their folds, the re-test, QC notes, actions and allowedNumbers. Phrase them, never recompute them.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          crew_id: { type: "string", description: "The crew member (app crew id or C001..C004)." },
          panel_id: { type: "string", description: "Timepoint such as R+45, or an empty string for the latest panel." },
        },
        required: ["crew_id", "panel_id"],
        additionalProperties: false,
      },
    },
    {
      name: "get_draw_advice",
      description:
        "Returns the code-computed draw-advisor rule (A1-A6) and its facts: days since the last panel, kits left and total, the strain-score trigger. Phrase them, never recompute them.",
      strict: true,
      input_schema: {
        type: "object",
        properties: { crew_id: { type: "string", description: "The crew member (app crew id or C001..C004)." } },
        required: ["crew_id"],
        additionalProperties: false,
      },
    },
  ].map((t) => Object.freeze(t as Anthropic.Tool)),
);

/** build prompt T6, verbatim: rides in the signature directive after the frozen system prompt */
export const SIGNATURE_PROMPT_ADDITION =
  "Use only numbers present in the tool result. At most five sentences, one action, end with: Decision support, not a diagnosis. / Энэ бол шийдвэр гаргахад туслах мэдээлэл, онош биш.";

/* ───────────── T14: get_space_measurability (spec section 8.1) ───────────── */

/**
 * The third Cosmo signature tool. Kept beside, not inside, SIGNATURE_TOOL_DEFINITIONS (whose two names are pinned by the
 * T6 tests) and, like them, outside the frozen check-in tool list.
 */
export const SPACE_TOOL_NAME = "get_space_measurability" as const;
export type SpaceToolName = typeof SPACE_TOOL_NAME;

export const SPACE_TOOL_DEFINITION: Anthropic.Tool = Object.freeze({
  name: SPACE_TOOL_NAME,
  description:
    "Returns the three fixed statements (S1-S3) about measuring these blood markers in space, in orbit or on the ISS, in the session language. Answer only from them; never claim in-flight measurement.",
  strict: true,
  input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
} as Anthropic.Tool);

/** build prompt T14, verbatim: rides in the signature directive after the frozen system prompt, like the T6 addition */
export const SPACE_PROMPT_ADDITION =
  "For questions about measuring in space, in orbit or on the ISS, call get_space_measurability and answer only from its result.";

/** `get_space_measurability()`: the three statements for the session language */
export function executeSpaceTool(input: unknown, lang: Lang): { ok: true; name: SpaceToolName; data: SpaceFacts } | { ok: false; name: SpaceToolName; code: "bad_input"; error: string } {
  const parsed = z.object({}).strict().safeParse(input ?? {});
  if (!parsed.success) return { ok: false, name: SPACE_TOOL_NAME, code: "bad_input", error: "Invalid input" };
  return { ok: true, name: SPACE_TOOL_NAME, data: buildSpaceFacts(lang) };
}

const SPACE_PLACE_EN = /\b(?:in\s+(?:orbit|space|flight)|in-flight|on\s+(?:the\s+)?(?:ISS|space\s+station|orbit)|on\s*board|onboard|aboard)\b/iu;
const SPACE_VERB_EN = /\b(?:measur\w*|test\w*|track\w*|monitor\w*|analy[sz]\w*|detect\w*|scor\w*|run\b)/iu;
const SPACE_MN = /(тойрог зам|сансар|сансрын станц|нислэгийн үеэр)[^.?!]{0,60}(хэмж|шинж|тоол)|(хэмж|шинж|тоол)[^.?!]{0,60}(тойрог зам|сансар|сансрын станц)/iu;

/** is the utterance about measuring in space / in orbit / on the ISS? (checked before the panel and draw intents) */
export function detectSpaceIntent(text: string): boolean {
  if (SPACE_MN.test(text)) return true;
  return SPACE_PLACE_EN.test(text) && SPACE_VERB_EN.test(text);
}

/** the answer to a space question without (or after rejected) model wording: S1-S3 */
export function renderSpaceTemplate(lang: Lang): string {
  return spaceStatements(lang).join(" ");
}

/** model wording of a space answer: only statement sentences (shorten, never add), no number, no orbit claim */
export function acceptSpaceAnswer(text: string, lang: Lang): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_SIGNATURE_CHARS) return false;
  if (!onlyStatementSentences(t, lang)) return false;
  if (!assertNumbersGrounded(t, { allowedNumbers: [] })) return false;
  if (!assertNoOrbitClaim(t)) return false;
  return !hasForbiddenWording(t);
}

const INPUTS = {
  get_signature_triage: z.object({ crew_id: z.string(), panel_id: z.string().optional() }).strict(),
  get_draw_advice: z.object({ crew_id: z.string() }).strict(),
} as const;

/* ───────────── panels and clock ───────────── */

/** the reference crew member whose panels a crew id stands for: C001..C004 themselves, or the app crew link */
export function referenceCrewFor(crewId: string): ReferenceCrewId | null {
  if ((REFERENCE_CREW as readonly string[]).includes(crewId)) return crewId as ReferenceCrewId;
  return APP_CREW_REFERENCE_PANELS[crewId] ?? null;
}

const panelCache = new Map<string, PanelResult[]>();

/** the four post-flight panels of a reference crew member, in day order (memoised; the data never change) */
export function referencePanels(crew: ReferenceCrewId): PanelResult[] {
  let panels = panelCache.get(crew);
  if (!panels) {
    const { matrix } = getLabData();
    // addendum T13: with the second assay the facts carry the two-key check and the addendum dialogue applies
    const second = tryLoadSecondAssay()?.matrix;
    panels = POST_TIMEPOINTS.map((t) => (second ? scorePanelWithSecondAssay(matrix, second, crew, t) : scorePanel(matrix, crew, t)));
    panelCache.set(crew, panels);
  }
  return panels;
}

/** mission day of a local date (day 1 = MISSION_START_DATE), the panel clock of app crew (integration map 4.9) */
export function panelClockDay(localDate: string, missionStartDate: string): number {
  const [sy, sm, sd] = missionStartDate.split("-").map(Number);
  const [ty, tm, td] = localDate.split("-").map(Number);
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(sy, sm - 1, sd)) / 86_400_000);
  return Math.max(1, days + 1);
}

/** the latest panel drawn on or before `today` (panel clock), or a given timepoint */
function pickPanel(panels: readonly PanelResult[], today: number | null, timepoint?: Timepoint): PanelResult | null {
  if (timepoint) return panels.find((p) => p.timepoint === timepoint) ?? null;
  const drawn = today === null ? [...panels] : panels.filter((p) => p.missionDay <= today);
  return drawn.length ? drawn[drawn.length - 1] : null;
}

function parseTimepoint(panelId: string | undefined): Timepoint | undefined {
  if (!panelId) return undefined;
  const tp = panelId.includes("_") ? panelId.slice(panelId.indexOf("_") + 1) : panelId;
  return (POST_TIMEPOINTS as readonly string[]).includes(tp) ? (tp as Timepoint) : undefined;
}

/** triage facts of the latest (or a named) panel; null when the crew id has no reference panels or none is drawn yet */
export function triageFactsFor(
  crewId: string,
  lang: Lang,
  options: { today?: number | null; timepoint?: Timepoint } = {},
): SignatureFacts | null {
  const crew = referenceCrewFor(crewId);
  if (!crew) return null;
  const panels = referencePanels(crew);
  const panel = pickPanel(panels, options.today ?? null, options.timepoint);
  if (!panel) return null;
  const idx = panels.indexOf(panel);
  return buildFacts(panel, { lang, previous: idx > 0 ? panels[idx - 1] : null, qcLog: getLabData().qcLog });
}

export interface DrawInputs {
  /** today on the panel clock */
  today: number;
  /** previous check-in days (any order) */
  history?: readonly HistoryDay[];
  /** today's values, if a check-in was recorded */
  todayValues?: Partial<Record<KpiKey, MeasurementValue>>;
}

/** draw-advisor facts for a crew member on `today` (panels up to today, DSS from the check-in history) */
export function drawFactsFor(crewId: string, lang: Lang, inputs: DrawInputs): DrawFacts | null {
  const crew = referenceCrewFor(crewId);
  if (!crew) return null;
  const history = inputs.history ?? [];
  const days = strainDaysFromHistory(history);
  const todayDay = strainDayFromKpis(inputs.todayValues ?? {});
  const dss = dssSeries([...days, todayDay]);
  const advice = drawAdvice(drawStateFromPanels(referencePanels(crew), inputs.today, dss));
  const hrHistory = days.map((d) => d.resting_hr).filter((x): x is number => typeof x === "number");
  return buildDrawFacts(advice, {
    lang,
    crew,
    sleepHours: asNumber(inputs.todayValues?.sleep_hours),
    restingHr: asNumber(inputs.todayValues?.heart_rate),
    restingHrUsual: hrHistory.length >= 5 ? median(hrHistory) : null,
  });
}

/* ───────────── executor ───────────── */

export interface SignatureToolContext {
  lang: Lang;
  /** today on the panel clock (null: the latest panel of all) */
  today: number | null;
  history?: readonly HistoryDay[];
  todayValues?: Partial<Record<KpiKey, MeasurementValue>>;
}

export type SignatureToolResult =
  | { ok: true; name: SignatureToolName; data: SignatureFacts | { rule: DrawFacts["rule"]; facts: DrawFacts } }
  | { ok: false; name: SignatureToolName | null; code: "unknown_tool" | "bad_input" | "not_found"; error: string };

export function isSignatureToolName(name: string): name is SignatureToolName {
  return (SIGNATURE_TOOL_NAMES as readonly string[]).includes(name);
}

export function executeSignatureTool(name: string, input: unknown, ctx: SignatureToolContext): SignatureToolResult {
  if (!isSignatureToolName(name)) return { ok: false, name: null, code: "unknown_tool", error: `Unknown tool ${name}` };
  const parsed = INPUTS[name].safeParse(input);
  if (!parsed.success) return { ok: false, name, code: "bad_input", error: "Invalid input" };
  if (name === "get_signature_triage") {
    const { crew_id, panel_id } = parsed.data as z.infer<(typeof INPUTS)["get_signature_triage"]>;
    const facts = triageFactsFor(crew_id, ctx.lang, { today: ctx.today, timepoint: parseTimepoint(panel_id) });
    return facts ? { ok: true, name, data: facts } : { ok: false, name, code: "not_found", error: "No blood panel" };
  }
  const { crew_id } = parsed.data;
  const facts = drawFactsFor(crew_id, ctx.lang, {
    today: ctx.today ?? TIMEPOINT_DAY["R+194"],
    history: ctx.history,
    todayValues: ctx.todayValues,
  });
  return facts ? { ok: true, name, data: { rule: facts.rule, facts } } : { ok: false, name, code: "not_found", error: "No blood panel" };
}

/* ───────────── intent ───────────── */

const DRAW_EN = /\b(?:blood\s+draws?|draw(?:ing)?\s+(?:blood|a\s+sample)|(?:should|do|can|must)\s+i\s+(?:draw|give\s+blood)|next\s+draw|kits?|re-?tests?)\b/iu;
const DRAW_MN = /цус\s+ав|цус\s+өгө|багц|давтан\s+шинжилгээ/iu;
const TRIAGE_EN =
  /\b(?:blood\s+(?:panel|test|work|sample|results?)|lab(?:oratory)?\s+(?:panel|results?|tests?)|panels?|signature|triage|flight[-\s]response|FRI|IL-?6|cytokines?|inspiration\s?4)\b/iu;
const TRIAGE_MN = /шинжилгээ|лаборатор|хариу\s+урвалын\s+индекс|IL-?6|Inspiration\s?4/iu;

/** is the utterance about the blood panel (triage) or about a blood draw? Draw words win. */
export function detectSignatureIntent(text: string): SignatureToolName | null {
  if (DRAW_EN.test(text) || DRAW_MN.test(text)) return "get_draw_advice";
  if (TRIAGE_EN.test(text) || TRIAGE_MN.test(text)) return "get_signature_triage";
  return null;
}

/* ───────────── accepting model wording ───────────── */

const MAX_SIGNATURE_CHARS = 1200;
const MAX_SIGNATURE_SENTENCES = 10;

function sentenceCount(text: string): number {
  return text
    .trim()
    .split(/(?<=[.!?…])\s+/u)
    .filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
}

/**
 * The model's wording of a signature answer is spoken only when every number is in the facts' allowedNumbers, it ends
 * with the disclaimer of its language, it has no forbidden wording (build rule 6), no condition / drug name, no emoji,
 * and it is short (the model is asked for five sentences; the check allows the length of the longest spec dialogue, ten).
 */
export function acceptSignatureAnswer(text: string, facts: { allowedNumbers: readonly string[] }, lang: Lang): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_SIGNATURE_CHARS) return false;
  if (sentenceCount(t) > MAX_SIGNATURE_SENTENCES) return false;
  if (/\p{Extended_Pictographic}/u.test(t)) return false;
  if (!hasDisclaimer(t, lang)) return false;
  if (!assertNumbersGrounded(t, facts)) return false;
  // T14: next to the number guard, no claim of in-flight measurement
  if (!assertNoOrbitClaim(t)) return false;
  if (hasForbiddenWording(t)) return false;
  if (namesConditionOrDrug(t.split(SIGNATURE_DISCLAIMER[lang]).join(" "))) return false;
  return true;
}

/** what the agent is given to word a signature answer */
export interface SignatureAnswerArgs {
  tool: SignatureToolName | SpaceToolName;
  facts: SignatureFacts | DrawFacts | SpaceFacts;
  question: string;
  lang: Lang;
  history: TurnRow[];
}

/** the template for a tool result */
export function signatureTemplate(facts: SignatureFacts | DrawFacts | SpaceFacts, lang: Lang): string {
  if (facts.kind === "space") return renderSpaceTemplate(lang);
  return facts.kind === "triage" ? renderTriageTemplate(facts, lang) : renderDrawTemplate(facts, lang);
}

/**
 * The DONE-state answer to a question about the blood panel or a blood draw: null when the words are not such a
 * question or the crew member has no reference panels (the caller then answers as before). The model words it when
 * `answer` is given and its text passes `acceptSignatureAnswer`; otherwise the template.
 *
 * T14: a question about measuring in space / in orbit / on the ISS is answered from S1-S3 only (get_space_measurability;
 * model wording only when `acceptSpaceAnswer`), for any crew member. Model wording of a triage or draw answer that
 * claims in-flight measurement (`assertNoOrbitClaim`, run next to the number guard) is replaced by S1 + S3.
 */
export async function answerSignatureQuestion(p: {
  crewId: string;
  text: string;
  lang: Lang;
  ctx: SignatureToolContext;
  history: TurnRow[];
  answer?: (args: SignatureAnswerArgs) => Promise<string | null>;
}): Promise<{ text: string; tool: SignatureToolName | SpaceToolName; worded: boolean; llmMs: number } | null> {
  if (detectSpaceIntent(p.text)) return answerSpaceQuestion(p);
  const tool = detectSignatureIntent(p.text);
  if (!tool) return null;
  const input = tool === "get_signature_triage" ? { crew_id: p.crewId, panel_id: "" } : { crew_id: p.crewId };
  const res = executeSignatureTool(tool, input, p.ctx);
  if (!res.ok) return null;
  const facts = "facts" in res.data ? res.data.facts : res.data;
  const template = signatureTemplate(facts, p.lang);
  if (!p.answer) return { text: template, tool, worded: false, llmMs: 0 };
  const started = performance.now();
  let worded: string | null = null;
  try {
    worded = await p.answer({ tool, facts, question: p.text, lang: p.lang, history: p.history });
  } catch {
    worded = null;
  }
  const llmMs = Math.round(performance.now() - started);
  if (worded && !assertNoOrbitClaim(worded)) {
    return { text: orbitClaimFallback(p.lang), tool, worded: false, llmMs };
  }
  if (worded && acceptSignatureAnswer(worded, facts, p.lang)) return { text: worded.trim(), tool, worded: true, llmMs };
  return { text: template, tool, worded: false, llmMs };
}

/** T14: the answer to a question about measuring in space, from `get_space_measurability` only */
async function answerSpaceQuestion(p: {
  text: string;
  lang: Lang;
  history: TurnRow[];
  answer?: (args: SignatureAnswerArgs) => Promise<string | null>;
}): Promise<{ text: string; tool: SpaceToolName; worded: boolean; llmMs: number }> {
  const facts = buildSpaceFacts(p.lang);
  const template = renderSpaceTemplate(p.lang);
  if (!p.answer) return { text: template, tool: SPACE_TOOL_NAME, worded: false, llmMs: 0 };
  const started = performance.now();
  let worded: string | null = null;
  try {
    worded = await p.answer({ tool: SPACE_TOOL_NAME, facts, question: p.text, lang: p.lang, history: p.history });
  } catch {
    worded = null;
  }
  const llmMs = Math.round(performance.now() - started);
  if (worded && !assertNoOrbitClaim(worded)) return { text: orbitClaimFallback(p.lang), tool: SPACE_TOOL_NAME, worded: false, llmMs };
  if (worded && acceptSpaceAnswer(worded, p.lang)) return { text: worded.trim(), tool: SPACE_TOOL_NAME, worded: true, llmMs };
  return { text: template, tool: SPACE_TOOL_NAME, worded: false, llmMs };
}

/* ───────────── after the daily summary ───────────── */

/**
 * What Cosmo adds after the daily summary (build prompt T6): the triage offer when a panel was drawn since the previous
 * check-in (panel day > panel-clock day of the latest earlier check-in, or no earlier check-in), then the draw advice
 * when its rule is A1, A2 or A3. Without its own disclaimer: it is placed before the summary's closing disclaimer.
 * Empty when there is nothing to add or the crew member has no reference panels.
 */
export function signatureFollowUp(p: {
  crewId: string;
  lang: Lang;
  localDate: string;
  missionStartDate: string;
  history: readonly HistoryDay[];
  todayValues: Partial<Record<KpiKey, MeasurementValue>>;
}): string {
  const crew = referenceCrewFor(p.crewId);
  if (!crew) return "";
  const today = panelClockDay(p.localDate, p.missionStartDate);
  const parts: string[] = [];
  const panel = pickPanel(referencePanels(crew), today);
  const earlier = p.history.map((d) => d.date).filter((d) => d < p.localDate).sort();
  const lastCheckInDay = earlier.length ? panelClockDay(earlier[earlier.length - 1], p.missionStartDate) : null;
  if (panel && (lastCheckInDay === null || panel.missionDay > lastCheckInDay)) parts.push(renderTriageOffer(crew, p.lang));
  const draw = drawFactsFor(p.crewId, p.lang, { today, history: p.history, todayValues: p.todayValues });
  if (draw && SPOKEN_DRAW_RULES.has(draw.rule)) {
    parts.push(renderDrawTemplate(draw, p.lang).split(SIGNATURE_DISCLAIMER[p.lang]).join(" ").trim());
  }
  return parts.join(" ").replace(/\s+/gu, " ").trim();
}

/** `spoken` with `addition` placed before its closing disclaimer (or appended when the disclaimer is not in it) */
export function insertBeforeDisclaimer(spoken: string, addition: string, disclaimer: string): string {
  if (!addition.trim()) return spoken;
  const at = disclaimer.trim().length > 0 ? spoken.lastIndexOf(disclaimer.trim()) : -1;
  if (at > 0) return `${spoken.slice(0, at).trimEnd()} ${addition.trim()} ${spoken.slice(at)}`;
  return `${spoken.trimEnd()} ${addition.trim()}`;
}
