import "server-only";
import { createHash } from "node:crypto";
import type { Lang } from "@/lib/types";
import { getEnv } from "@/server/env";
import { HttpError } from "@/server/http";

/**
 * Text-to-speech with ElevenLabs (streamed):
 *   POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=mp3_44100_128
 *   header xi-api-key; JSON { text, model_id }
 * Model: Mongolian uses ELEVENLABS_TTS_MODEL_MN (default eleven_v4_turbo - the live GET /v1/models on this account
 * lists Mongolian only for eleven_v4 / eleven_v4_turbo); English uses ELEVENLABS_TTS_MODEL_EN or eleven_v4_turbo.
 * Any problem is HttpError(502, "TTS_FAILED"), which the audio route turns into a JSON error that the client treats
 * as "use speechSynthesis". The API key never leaves the server.
 */

const BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const TIMEOUT_MS = 20_000;

export function ttsConfigFor(lang: Lang): { voiceId?: string; modelId: string } {
  const env = getEnv();
  return lang === "mn"
    ? { voiceId: env.voiceIdMn, modelId: env.ttsModelMn }
    : { voiceId: env.voiceIdEn, modelId: env.ttsModelEn ?? "eleven_v4_turbo" };
}

export async function synthesizeSpeech(text: string, lang: Lang): Promise<Response> {
  const env = getEnv();
  const { voiceId, modelId } = ttsConfigFor(lang);
  if (env.demoMode === "scripted" || !env.elevenlabsApiKey || !voiceId) {
    throw new HttpError(502, "TTS_FAILED", "Speech synthesis is not available.");
  }
  const clean = text.trim();
  if (!clean) throw new HttpError(400, "BAD_INPUT", "Nothing to say.");

  let res: Response;
  try {
    res = await fetch(`${BASE}/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`, {
      method: "POST",
      headers: {
        "xi-api-key": env.elevenlabsApiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({ text: clean, model_id: modelId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error("[aegis] TTS request failed:", err instanceof Error ? err.message : err);
    throw new HttpError(502, "TTS_FAILED", "Speech synthesis did not respond.");
  }
  if (!res.ok || !res.body) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    console.error(`[aegis] TTS HTTP ${res.status} (model ${modelId}, lang ${lang}): ${detail}`);
    throw new HttpError(502, "TTS_FAILED", "Speech synthesis failed.");
  }
  return res;
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
