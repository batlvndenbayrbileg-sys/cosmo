/**
 * Speech helpers (pure): recorder format choice, upload file names, speechSynthesis voice choice and
 * a rough spoken-duration estimate. No DOM access here, so these run in plain Node tests.
 */
import type { Lang } from "@/lib/types";

const PREFERRED_RECORDER_TYPE = "audio/webm;codecs=opus";

/**
 * audio/webm;codecs=opus when the browser can record it, otherwise undefined, which means "let
 * MediaRecorder pick its default" (for example audio/mp4 on Safari).
 */
export function pickRecorderMimeType(isSupported: (mimeType: string) => boolean): string | undefined {
  try {
    return isSupported(PREFERRED_RECORDER_TYPE) ? PREFERRED_RECORDER_TYPE : undefined;
  } catch {
    return undefined;
  }
}

/** File name for the multipart upload, so the server (and Scribe) can sniff the container. */
export function audioFileName(mimeType: string): string {
  const type = mimeType.toLowerCase();
  if (type.includes("webm")) return "utterance.webm";
  if (type.includes("mp4") || type.includes("aac") || type.includes("m4a")) return "utterance.m4a";
  if (type.includes("ogg")) return "utterance.ogg";
  if (type.includes("wav")) return "utterance.wav";
  if (type.includes("mpeg") || type.includes("mp3")) return "utterance.mp3";
  return "utterance.webm";
}

export interface VoiceLike {
  lang: string;
  name: string;
  default?: boolean;
  localService?: boolean;
}

function voiceLanguage(voice: VoiceLike): string {
  return voice.lang.toLowerCase().replace("_", "-");
}

/**
 * Best speechSynthesis voice for a language, or null when there is none. Mongolian is often missing
 * on a laptop: null then means "skip the audio and animate the mouth while the text is shown".
 * English prefers en-US, then en-GB, then any en-*; ties go to the default and local voices.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], language: Lang): V | null {
  const prefix = language === "mn" ? "mn" : "en";
  const matching = voices.filter((v) => {
    const l = voiceLanguage(v);
    return l === prefix || l.startsWith(`${prefix}-`);
  });
  if (matching.length === 0) return null;
  const score = (v: V): number => {
    let s = 0;
    if (language === "en") {
      const l = voiceLanguage(v);
      if (l === "en-us") s += 4;
      else if (l === "en-gb") s += 3;
    }
    if (v.default) s += 2;
    if (v.localService) s += 1;
    return s;
  };
  // stable: the first of equally good voices wins
  return matching.reduce((best, v) => (score(v) > score(best) ? v : best));
}

/** Rough spoken duration in ms, used for the silent (no voice available) mouth animation. */
export function estimateSpeechMs(text: string, language: Lang): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  const words = trimmed.split(/\s+/).length;
  const perWord = language === "mn" ? 430 : 380;
  const estimate = Math.max(words * perWord, Array.from(trimmed).length * 60);
  return Math.min(Math.max(Math.round(estimate), 1200), 25_000);
}

/** BCP-47 tag for an utterance when no concrete voice was found (en only; Mongolian is skipped). */
export function speechLangTag(language: Lang): string {
  return language === "mn" ? "mn-MN" : "en-US";
}
