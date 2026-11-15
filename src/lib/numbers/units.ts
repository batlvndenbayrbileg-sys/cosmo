/**
 * Everyday drink containers in loose answers ("3 glasses", "гурван аяга ус", "a bottle", "2 стакан"), read as a volume
 * with a stated assumption (team feedback 2026-11-15: "when it asks in millilitres and I answer in litres or glasses it
 * says it did not understand"). Cosmo records the rule-of-thumb volume and says the assumption out loud, so the
 * astronaut can correct it at the read-back, instead of asking again.
 *
 * Sizes (rules of thumb, said in the acknowledgement): a glass / cup / mug / аяга / стакан = 250 ml, a bottle / лонх /
 * шил = 500 ml. Drink bags ("bag", "уут") are left out on purpose: their size is printed on the label and varies.
 *
 * Pure: shared by the interpreter (src/server/agent/interpret.ts), the acknowledgement wording
 * (src/server/agent/assumptions.ts) and the number cross-check (src/server/agent/tools.ts).
 */
import { extractNumbers } from "./extract";

/** blood glucose: 1 mmol/L = 18.016 mg/dL (the registry stores mg/dL) */
export const MGDL_PER_MMOL = 18.016;

export const GLASS_ML = 250;
export const BOTTLE_ML = 500;

export type ContainerKind = "glass" | "bottle";

export const CONTAINER_ML: Readonly<Record<ContainerKind, number>> = { glass: GLASS_ML, bottle: BOTTLE_ML };

const GLASS_WORD = /^(?:glass(?:es)?|cups?|mugs?|аяга[\p{L}]*|аягыг|стакан[\p{L}]*)$/iu;
// "шил" only in its own forms: "шилжих" (to shift) must never read as a bottle
const BOTTLE_WORD = /^(?:bottles?|лонх[\p{L}]*|шил(?:ийн|ээр|ийг|тэй|ээ)?)$/iu;
const WORD_RE = /[\p{L}]+/gu;

/** "2-3", "two or three", "хоёр гурав": the words between the two counts of a range */
const COUNT_RANGE_GAP = /^\s*(?:-|–|—|to|or|эсвэл|буюу)?\s*$/iu;
/** filler between the count and the container ("3 big glasses", "2 full cups", "хоёр том аяга") */
const COUNT_GAP = /^\s*(?:(?:big|large|small|full|tall|том|жижиг|дүүрэн|бүтэн)\s+)?$/iu;
const ARTICLE_BEFORE = /(?:^|[\s,])(?:a|an|one)\s+(?:(?:big|large|small|full|tall)\s+)?$/iu;
const HALF_BEFORE = /(?:^|[\s,])half\s+(?:a\s+)?$/iu;
const COUPLE_BEFORE = /(?:^|[\s,])a\s+couple\s+(?:of\s+)?$/iu;
const PLURAL_EN = /^(?:glasses|cups|mugs|bottles)$/iu;

export interface ContainerReading {
  kind: ContainerKind;
  /** how many containers (a midpoint for "2-3 glasses") */
  count: number;
  /** count * the container size, rounded to whole millilitres */
  ml: number;
  /** span of the count (or of the container word when there is no count) through the container word */
  start: number;
  end: number;
  /** true when the count is the middle of a spoken range */
  range: boolean;
}

function kindOf(word: string): ContainerKind | null {
  if (GLASS_WORD.test(word)) return "glass";
  if (BOTTLE_WORD.test(word)) return "bottle";
  return null;
}

/** every container mentioned in `text`, with its count, in text order */
export function readContainers(text: string): ContainerReading[] {
  const nums = extractNumbers(text);
  const out: ContainerReading[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    const kind = kindOf(m[0]);
    if (!kind) continue;
    const wordStart = m.index ?? 0;
    const end = wordStart + m[0].length;
    // the count is the number right before the container word ("3 glasses", "гурван аяга", "2 big cups")
    const at = nums.findLastIndex((n) => n.end <= wordStart && COUNT_GAP.test(text.slice(n.end, wordStart)));
    const before = text.slice(0, wordStart);
    let count: number | null = null;
    let start = wordStart;
    let range = false;
    if (at >= 0) {
      const b = nums[at];
      const a = at > 0 ? nums[at - 1] : null;
      if (a && a.value < b.value && b.value - a.value <= 3 && COUNT_RANGE_GAP.test(text.slice(a.end, b.start))) {
        count = (a.value + b.value) / 2;
        start = a.start;
        range = true;
      } else {
        count = b.value;
        start = b.start;
      }
    } else if (HALF_BEFORE.test(before)) {
      count = 0.5;
      start = before.search(/half\s+(?:a\s+)?$/iu);
    } else if (COUPLE_BEFORE.test(before)) {
      count = 2;
      start = before.search(/a\s+couple\s+(?:of\s+)?$/iu);
    } else if (ARTICLE_BEFORE.test(before)) {
      count = 1;
      start = before.search(/(?:a|an|one)\s+(?:(?:big|large|small|full|tall)\s+)?$/iu);
    } else if (!PLURAL_EN.test(m[0])) {
      // a bare singular container ("аяга ус уусан", "cup of water") is one of it; a bare plural ("glasses") has no count
      count = 1;
    }
    if (count === null || !(count > 0) || count > 40) continue;
    out.push({ kind, count, ml: Math.round(count * CONTAINER_ML[kind]), start, end, range });
  }
  return out;
}

/** true when the words name a drink container */
export function mentionsContainer(text: string): boolean {
  for (const m of text.matchAll(WORD_RE)) if (kindOf(m[0])) return true;
  return false;
}
