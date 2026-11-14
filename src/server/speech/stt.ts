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
  if (!text) {
    throw new HttpError(422, "STT_FAILED", "I could not hear any words. Please try again.");
  }
  return { text, language, ms };
}
