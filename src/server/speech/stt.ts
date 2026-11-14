import "server-only";
import type { Lang } from "@/lib/types";
import { normalizeLanguageCode } from "@/lib/language";
import { getEnv } from "@/server/env";
import { HttpError } from "@/server/http";

/**
 * Speech-to-text with ElevenLabs Scribe (batch):
 *   POST https://api.elevenlabs.io/v1/speech-to-text  (multipart: file, model_id, optional language_code)
 *   header xi-api-key; response { text, language_code, language_probability }
 * (docs/sources.md). Any problem is HttpError(502, "STT_FAILED") so the turn route answers with a recoverable
 * error and the client falls back to the text box. The API key never leaves the server.
 */

const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const TIMEOUT_MS = 20_000;

export interface TranscribeOptions {
  /** the language the astronaut is expected to speak (a hint for the recogniser); omit to auto-detect */
  languageHint?: Lang | null;
  /** words to expect (keyterms.ts): short Mongolian answers are recognised far better with them */
  keyterms?: string[];
}

function fileNameFor(type: string): string {
  if (type.includes("webm")) return "utterance.webm";
  if (type.includes("ogg")) return "utterance.ogg";
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "utterance.m4a";
  if (type.includes("wav")) return "utterance.wav";
  if (type.includes("mpeg") || type.includes("mp3")) return "utterance.mp3";
  return "utterance.webm";
}

export async function transcribeAudio(
  audio: Blob,
  opts: TranscribeOptions = {},
): Promise<{ text: string; language: Lang | null; ms: number }> {
  const env = getEnv();
  if (env.demoMode === "scripted" || !env.elevenlabsApiKey) {
    throw new HttpError(502, "STT_FAILED", "Speech recognition is not available. Please type your answer.");
  }
  if (audio.size === 0) {
    throw new HttpError(400, "BAD_INPUT", "The recording was empty.");
  }

  const form = new FormData();
  form.append("file", audio, fileNameFor(audio.type));
  form.append("model_id", env.sttModel);
  if (opts.languageHint) form.append("language_code", opts.languageHint);
  // No secondary_language_codes: with "en" as a secondary language short Mongolian answers came back as English words
  // ("Тод байна." -> "thought vein."), measured 2026-11-15 (scratchpad stt-short). The EN/MN switch sets the hint instead.
  for (const term of opts.keyterms ?? []) form.append("keyterms", term);
  // one astronaut talking; no "(laughter)" / "(noise)" tags in the text (they read as an answer and got a "sorry")
  form.append("num_speakers", "1");
  form.append("tag_audio_events", "false");
  // numbers as digits: measured 2026-11-15 on a Mongolian sample, scribe_v2 wrote "пульс жаран найм" as "жарн найм"
  // or "жар нэг найма"; scribe_v3 with digits returned "124 дээр 82, пульс 68" exactly (scratchpad stt-compare)
  // Not for Mongolian: with digits, short answers were turned into wrong numbers ("Гурав." -> "9.", "Тийм." -> "10.",
  // measured 2026-11-15, scratchpad stt-keyterms-check). The answer reader understands Mongolian number words anyway.
  if (env.sttModel.startsWith("scribe_v3") && opts.languageHint !== "mn") form.append("numbers_format", "digits");

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "xi-api-key": env.elevenlabsApiKey },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error("[aegis] STT request failed:", err instanceof Error ? err.message : err);
    throw new HttpError(502, "STT_FAILED", "Speech recognition did not respond. Please try again or type your answer.");
  }
  const ms = Date.now() - started;

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    console.error(`[aegis] STT HTTP ${res.status}: ${detail}`);
    throw new HttpError(502, "STT_FAILED", "Speech recognition failed. Please try again or type your answer.");
  }

  const body = (await res.json().catch(() => null)) as
    | { text?: unknown; language_code?: unknown; language_probability?: unknown }
    | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const language = normalizeLanguageCode(typeof body?.language_code === "string" ? body.language_code : null);
  if (!hasWords(text)) {
    // noise, a cough or "hmm": not an answer. 422 tells the client to listen again quietly (no "sorry" from Cosmo)
    throw new HttpError(422, "STT_FAILED", "I could not hear any words. Please try again.");
  }
  return { text, language, ms };
}

/** filler sounds that are not an answer on their own (English and Mongolian) */
const FILLER_ONLY = /^(?:u+h+|u+m+|h+m+|m+|a+h+|e+h+|o+h+|е+|э+|аа+н*|ээ+|мм+|хм+|өө+|за+)$/iu;

/**
 * Whether a transcript holds words worth answering: not empty, not only punctuation, audio-event tags like
 * "(noise)" / "[music]", or filler ("hmm", "аан").
 */
export function hasWords(text: string): boolean {
  const stripped = text
    .replace(/\([^)]*\)|\[[^\]]*\]/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim();
  if (!stripped) return false;
  const words = stripped.split(/\s+/u);
  return !words.every((w) => FILLER_ONLY.test(w));
}
