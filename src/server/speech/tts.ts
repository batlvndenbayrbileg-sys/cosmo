import "server-only";
import { createHash } from "node:crypto";
import type { Lang } from "@/lib/types";
import { getEnv } from "@/server/env";
import { HttpError } from "@/server/http";

/**
 * Text-to-speech. STUB: the ElevenLabs stream is filled in by the speech lane (docs/PLAN.md section 9, S14).
 * The contract stays: any problem is HttpError(502, "TTS_FAILED"), which the audio route turns into a JSON error that
 * the client treats as "use speechSynthesis".
 */

export async function synthesizeSpeech(text: string, lang: Lang): Promise<Response> {
  void text;
  void lang;
  const env = getEnv();
  if (env.demoMode === "scripted" || !env.elevenlabsApiKey) {
    throw new HttpError(502, "TTS_FAILED", "Speech synthesis is not available.");
  }
  throw new HttpError(502, "TTS_FAILED", "Speech synthesis is not implemented yet.");
}

/**
 * File name of a pre-generated demo clip under public/demo/audio/ (used by GET /api/checkins/:id/turns/:turnId/audio
 * in scripted mode, and by the audio generator script):
 *
 *     <lang>-<first 12 hex chars of SHA-1 of the text>.mp3
 *
 * where the text is what Cosmo says, trimmed with every run of whitespace collapsed to one space (no case folding),
 * encoded as UTF-8, and lang is "mn" or "en". Example: en-3f2b9a0c11de.mp3.
 * To reproduce it elsewhere: sha1(text.trim().replace(/\s+/g, " ")).hex.slice(0, 12).
 */
export function demoAudioFileName(text: string, lang: Lang): string {
  const canonical = text.trim().replace(/\s+/g, " ");
  const hash = createHash("sha1").update(canonical, "utf8").digest("hex").slice(0, 12);
  return `${lang}-${hash}.mp3`;
}
