import "server-only";
import type { Lang } from "@/lib/types";
import { getEnv } from "@/server/env";
import { HttpError } from "@/server/http";

/**
 * Speech-to-text. STUB: the ElevenLabs Scribe call is filled in by the speech lane (docs/PLAN.md section 9, S13).
 * The contract stays: audio in, { text, language, ms } out, and any problem is HttpError(502, "STT_FAILED") so the
 * turn route answers with a recoverable error and the client falls back to the text box.
 */

export interface TranscribeOptions {
  /** the language the astronaut is expected to speak (a hint for the recogniser) */
  languageHint?: Lang | null;
}

export async function transcribeAudio(
  audio: Blob,
  opts: TranscribeOptions = {},
): Promise<{ text: string; language: Lang | null; ms: number }> {
  void audio;
  void opts;
  const env = getEnv();
  if (env.demoMode === "scripted" || !env.elevenlabsApiKey) {
    throw new HttpError(502, "STT_FAILED", "Speech recognition is not available. Please type your answer.");
  }
  throw new HttpError(502, "STT_FAILED", "Speech recognition is not implemented yet. Please type your answer.");
}
