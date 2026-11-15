import type { KpiKey, Lang, MeasurementValue, QuestionId } from "@/lib/types";
import { asNumber } from "@/lib/kpi/registry";
import { formatNumber } from "@/lib/health/format";
import { extractNumbers } from "@/lib/numbers/extract";
import { BOTTLE_ML, GLASS_ML, MGDL_PER_MMOL, readContainers, type ContainerKind } from "@/lib/numbers/units";

/**
 * Saying the assumption out loud (team feedback 2026-11-15: "it is very stiff ... when it asks in millilitres and I
 * answer in litres it says it did not understand"). The rules now read loose answers with a stated rule of thumb
 * (interpret.ts): "3 glasses" is about 750 ml, "6-7 hours" is 6.5, a bare "5.5" for blood sugar is mmol/L, a bare
 * "98.6" for temperature is Fahrenheit. The acknowledgement names that reading ("Got it, about 750 millilitres,
 * counting a glass as 250 ml. Tell me if that's not right.") so the astronaut can correct it, instead of Cosmo asking
 * again.
 *
 * Pure: the reading is recovered from the stored value and its source text (the astronaut's own words), so nothing
 * extra travels through the turn pipeline. Null when the value is what the words literally say.
 */

/** the sentence after an acknowledgement that carries an assumption */
export const ASSUMPTION_CHECK: Readonly<Record<Lang, string>> = {
  en: "Tell me if that's not right.",
  mn: "Буруу бол хэлээрэй.",
};

const LITRE_WORD = /(?<![\p{L}])(?:l|lt|litres?|liters?|л|литр[\p{L}]*)(?![\p{L}])/iu;
const ML_WORD = /(?<![\p{L}])(?:ml|mls|millilit(?:re|er)s?|мл|миллилитр[\p{L}]*)(?![\p{L}])/iu;
const MG_WORD = /mg|мг/iu;
const MMOL_WORD = /mmol|ммоль/iu;
const FAHRENHEIT_WORD = /fahrenheit|фаренгейт|°\s*f(?![\p{L}])|\d\s*f(?![\p{L}])/iu;

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol + 1e-9;

function containerSizes(kinds: ReadonlySet<ContainerKind>, lang: Lang): string {
  const parts: string[] = [];
  if (kinds.has("glass")) parts.push(lang === "mn" ? `нэг аяга ${GLASS_ML} мл` : `a glass as ${GLASS_ML} ml`);
  if (kinds.has("bottle")) parts.push(lang === "mn" ? `нэг лонх ${BOTTLE_ML} мл` : `a bottle as ${BOTTLE_ML} ml`);
  return parts.join(lang === "mn" ? ", " : " and ");
}

type NoteRecord = { key: KpiKey; value: MeasurementValue; sourceText: string };

/**
 * The words for a value read with an assumption, replacing the plain spoken value in the acknowledgement, and whether
 * the astronaut should be asked to check it (ASSUMPTION_CHECK); null when the value is literally what was said.
 * `spoken` is the value as the acknowledgement would say it ("6.5 hours").
 */
export function assumptionNote(rec: NoteRecord, lang: Lang, spoken: string): { text: string; check: boolean } | null {
  const assumed = assumedReading(rec, lang, spoken);
  if (assumed) return { text: assumed, check: true };
  const converted = explicitMmol(rec, lang, spoken);
  return converted ? { text: converted, check: false } : null;
}

/** "5.5 mmol" -> "99 milligrams per decilitre, from 5.5 mmol per litre": a conversion the astronaut asked for */
function explicitMmol(rec: NoteRecord, lang: Lang, spoken: string): string | null {
  const value = asNumber(rec.value);
  if (rec.key !== "glucose_mgdl" || value === null || !MMOL_WORD.test(rec.sourceText)) return null;
  const nums = extractNumbers(rec.sourceText).map((n) => n.value);
  if (nums.length !== 1 || !near(Math.round(nums[0] * MGDL_PER_MMOL), value, 1)) return null;
  const n = formatNumber(nums[0], 2);
  return lang === "mn" ? `${n} ммоль/л буюу ${formatNumber(value, 2)} mg/dL` : `${spoken}, from ${n} mmol per litre`;
}

function assumedReading(rec: NoteRecord, lang: Lang, spoken: string): string | null {
  const value = asNumber(rec.value);
  if (value === null) return null;
  const src = rec.sourceText.trim();
  const nums = extractNumbers(src).map((n) => n.value);
  const v = formatNumber(value, 2);

  switch (rec.key) {
    case "water_ml": {
      const containers = readContainers(src);
      if (containers.length > 0 && near(containers.reduce((s, c) => s + c.ml, 0), value, 0.5)) {
        const sizes = containerSizes(new Set(containers.map((c) => c.kind)), lang);
        return lang === "mn"
          ? `${src} буюу ойролцоогоор ${v} миллилитр гэж тооцлоо (${sizes})`
          : `about ${v} millilitres, counting ${sizes}`;
      }
      if (nums.length === 2 && rangeMiddle(nums, value, LITRE_WORD.test(src) ? 1000 : 1)) return rangeNote(src, spoken, lang);
      // a bare small number taken as litres ("2" -> 2000 ml)
      if (nums.length === 1 && !LITRE_WORD.test(src) && !ML_WORD.test(src) && nums[0] <= 10 && near(nums[0] * 1000, value, 0.5)) {
        const n = formatNumber(nums[0], 2);
        return lang === "mn" ? `${n} литр буюу ${v} миллилитр гэж тооцлоо` : `${v} millilitres, taking ${n} as litres`;
      }
      return null;
    }
    case "sleep_hours":
      return nums.length === 2 && (rangeMiddle(nums, value, 1) || rangeMiddle(nums, value * 60, 1)) ? rangeNote(src, spoken, lang) : null;
    case "exercise_min":
      return nums.length === 2 && (rangeMiddle(nums, value, 1) || rangeMiddle(nums, value / 60, 1)) ? rangeNote(src, spoken, lang) : null;
    case "heart_rate":
      return nums.length === 2 && rangeMiddle(nums, value, 1) ? rangeNote(src, spoken, lang) : null;
    case "glucose_mgdl": {
      if (nums.length !== 1 || MG_WORD.test(src) || near(nums[0], value, 0)) return null;
      if (!near(Math.round(nums[0] * MGDL_PER_MMOL), value, 1)) return null;
      const n = formatNumber(nums[0], 2);
      // a reading said in mmol/L is only converted (explicitMmol below); a bare number read as mmol/L is an assumption
      if (MMOL_WORD.test(src)) return null;
      // (after the opener "Ойлголоо," the Mongolian notes end in "гэж тооцлоо / гэж авлаа", never a second "ойлголоо")
      return lang === "mn" ? `${n} ммоль/л буюу ${v} mg/dL гэж тооцлоо` : `${spoken}, reading ${n} as mmol per litre`;
    }
    case "temperature_c": {
      if (nums.length !== 1 || FAHRENHEIT_WORD.test(src) || near(nums[0], value, 0.05)) return null;
      if (!near(((nums[0] - 32) * 5) / 9, value, 0.06)) return null;
      const n = formatNumber(nums[0], 2);
      return lang === "mn" ? `${n} фаренгейт буюу ${v} хэм гэж тооцлоо` : `${v} degrees Celsius, reading ${n} as Fahrenheit`;
    }
    default:
      return null;
  }
}

/** true when `value` (in the words' own unit, times `scale`) is the middle of the two spoken numbers */
function rangeMiddle(nums: number[], value: number, scale: number): boolean {
  const [a, b] = nums;
  if (!(a < b)) return false;
  const mid = ((a + b) / 2) * scale;
  return !near(a * scale, value, 0.006) && !near(b * scale, value, 0.006) && (near(mid, value, 0.006) || near(Math.round(mid), value, 0));
}

function rangeNote(src: string, spoken: string, lang: Lang): string {
  return lang === "mn" ? `${src} гэснийг дунджаар ${spoken} гэж авлаа` : `${spoken}, the middle of ${src}`;
}

/* ───────────── examples in a re-ask ───────────── */

/**
 * One example of an answer Cosmo understands, said after a re-ask, so a second try is easy ("For example: 1500 ml,
 * 2 litres or 6 glasses."). Null for questions whose prompt already lists the choices (vision) or takes any words.
 */
const EXAMPLES: Partial<Record<QuestionId, Record<Lang, string>>> = {
  sleep: { en: "For example: 7 hours, or 6 and a half.", mn: "Жишээ нь: 7 цаг, эсвэл 6 цаг хагас." },
  mood: { en: "For example: 4, or just good, okay or low.", mn: "Жишээ нь: 4, эсвэл сайн, дунд, муу гэж хэлээрэй." },
  symptoms: { en: "For example: no, or a slight headache.", mn: "Жишээ нь: үгүй, эсвэл бага зэрэг толгой өвдөж байна." },
  blood_pressure: { en: "For example: 120 over 80.", mn: "Жишээ нь: 120 дээр 80." },
  heart_rate: { en: "For example: 68.", mn: "Жишээ нь: 68." },
  temperature: { en: "For example: 36.6 degrees.", mn: "Жишээ нь: 36.6 хэм." },
  glucose: { en: "For example: 95, or 5.3 mmol per litre.", mn: "Жишээ нь: 95, эсвэл 5.3 ммоль/л." },
  water: { en: "For example: 1500 ml, 2 litres or 6 glasses.", mn: "Жишээ нь: 1500 мл, 2 литр эсвэл 6 аяга." },
  exercise: { en: "For example: 45 minutes or an hour.", mn: "Жишээ нь: 45 минут эсвэл 1 цаг." },
  workload: { en: "For example: 3, or light, normal or heavy.", mn: "Жишээ нь: 3, эсвэл хөнгөн, дунд, хүнд." },
};

export function answerExample(id: QuestionId, lang: Lang): string {
  return EXAMPLES[id]?.[lang] ?? "";
}
