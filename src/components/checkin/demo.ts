/**
 * Run-demo helpers (pure). The demo fetches GET /api/demo/script?lang= and replays the CREW side of
 * the script through the same turn endpoint a real utterance would use, with natural pacing so the
 * transcript and the cards animate "as if live".
 *
 * The response shape of /api/demo/script is not fixed by the shared contract, so `parseDemoScript`
 * is deliberately tolerant. It understands:
 *   - an array of strings                       ["I slept 5.5 hours", ...]
 *   - an array of { speaker|role, text } turns  (only the crew side is kept)
 *   - an object wrapping either of those under turns | script | utterances | steps | lines | crew
 *   - items shaped { crew: "...", cosmo: "..." } (the crew half is kept)
 */
import { normalizeLanguageCode } from "@/lib/language";
import type { Lang } from "@/lib/types";

export interface DemoScript {
  language: Lang | null;
  /** what the crew member says, in order */
  utterances: string[];
}

const LIST_FIELDS = ["turns", "script", "utterances", "steps", "lines", "crew", "dialogue"] as const;
const SPEAKER_FIELDS = ["speaker", "role", "who", "from"] as const;
const TEXT_FIELDS = ["text", "utterance", "content", "say", "message"] as const;
const CREW_SPEAKERS = new Set(["crew", "user", "astronaut", "human", "member", "you"]);
const OTHER_SPEAKERS = new Set(["cosmo", "assistant", "ai", "system", "bot", "agent"]);

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function firstString(rec: Rec, fields: readonly string[]): string | null {
  for (const f of fields) {
    const v = rec[f];
    if (typeof v === "string") return v;
  }
  return null;
}

function crewText(item: unknown): string | null {
  if (typeof item === "string") return item.trim() === "" ? null : item.trim();
  if (!isRecord(item)) return null;
  if (typeof item.crew === "string") return item.crew.trim() === "" ? null : item.crew.trim();
  const speaker = firstString(item, SPEAKER_FIELDS)?.trim().toLowerCase() ?? null;
  if (speaker !== null) {
    if (OTHER_SPEAKERS.has(speaker)) return null;
    if (!CREW_SPEAKERS.has(speaker)) return null;
  }
  const text = firstString(item, TEXT_FIELDS)?.trim() ?? null;
  return text === null || text === "" ? null : text;
}

/** Returns null when no crew utterance can be found. */
export function parseDemoScript(json: unknown): DemoScript | null {
  let list: unknown = json;
  let language: Lang | null = null;
  if (isRecord(json)) {
    const code = json.language ?? json.lang;
    language = typeof code === "string" ? normalizeLanguageCode(code) : null;
    list = undefined;
    for (const f of LIST_FIELDS) {
      if (Array.isArray(json[f])) {
        list = json[f];
        break;
      }
    }
  }
  if (!Array.isArray(list)) return null;
  const utterances = list.map(crewText).filter((t): t is string => t !== null);
  return utterances.length === 0 ? null : { language, utterances };
}

/** Pause between Cosmo finishing and the next demo utterance: 1.0 to 1.5 s. `random` is 0..1. */
export function demoGapMs(random: number): number {
  const r = Math.min(Math.max(Number.isFinite(random) ? random : 0, 0), 1);
  return Math.round(1000 + r * 500);
}

export interface TypingPlan {
  /** growing prefixes of the text; the last frame is the whole text */
  frames: string[];
  frameMs: number;
}

/**
 * How an utterance is "typed" into the transcript: a few characters per frame, roughly 30 ms per
 * frame, and never longer than `maxTotalMs` in total, however long the sentence is.
 */
export function typingPlan(text: string, opts?: { frameMs?: number; maxTotalMs?: number }): TypingPlan {
  const frameMs = opts?.frameMs ?? 30;
  const maxTotalMs = opts?.maxTotalMs ?? 2800;
  const chars = Array.from(text);
  if (chars.length === 0) return { frames: [], frameMs };
  const step = Math.max(1, Math.ceil((chars.length * frameMs) / maxTotalMs));
  const frames: string[] = [];
  for (let end = step; end < chars.length; end += step) frames.push(chars.slice(0, end).join(""));
  frames.push(text);
  return { frames, frameMs };
}

/** Sleep that resolves early (false) when the signal aborts. Resolves true after the full delay. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface WaitOptions {
  timeoutMs: number;
  /** how often the predicate is checked (default 100 ms) */
  pollMs?: number;
  /** the predicate must stay true this long before the wait ends (default 250 ms) */
  stableMs?: number;
}

/**
 * Resolves true once `predicate` has been continuously true for `stableMs`; false on timeout or abort.
 * The demo uses it to wait until Cosmo has finished talking before the next utterance.
 */
export async function waitUntil(
  predicate: () => boolean,
  signal: AbortSignal,
  { timeoutMs, pollMs = 100, stableMs = 250 }: WaitOptions,
): Promise<boolean> {
  const started = Date.now();
  let trueSince: number | null = null;
  while (!signal.aborted) {
    const now = Date.now();
    if (predicate()) {
      trueSince ??= now;
      if (now - trueSince >= stableMs) return true;
    } else {
      trueSince = null;
    }
    if (now - started >= timeoutMs) return false;
    if (!(await abortableSleep(pollMs, signal))) return false;
  }
  return false;
}
