import "server-only";
import { z } from "zod";

/** Treat empty strings from .env files as "not set". */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  DEMO_MODE: z.enum(["live", "scripted"]).default("live"),
  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_MODEL: optional,
  ELEVENLABS_API_KEY: optional,
  ELEVENLABS_VOICE_ID_MN: optional,
  ELEVENLABS_VOICE_ID_EN: optional,
  ELEVENLABS_STT_MODEL: optional,
  ELEVENLABS_TTS_MODEL_MN: optional,
  ELEVENLABS_TTS_MODEL_EN: optional,
  AEGIS_DB_PATH: optional,
  SESSION_SECRET: optional,
  MISSION_START_DATE: optional,
});

export interface Env {
  demoMode: "live" | "scripted";
  anthropicApiKey?: string;
  anthropicModel: string;
  elevenlabsApiKey?: string;
  voiceIdMn?: string;
  voiceIdEn?: string;
  sttModel: string;
  ttsModelMn: string;
  ttsModelEn?: string;
  dbPath: string;
  sessionSecret?: string;
  missionStartDate: string;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const e = schema.parse(source);
  return {
    demoMode: e.DEMO_MODE,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    anthropicModel: e.ANTHROPIC_MODEL ?? "claude-opus-5-5",
    elevenlabsApiKey: e.ELEVENLABS_API_KEY,
    voiceIdMn: e.ELEVENLABS_VOICE_ID_MN,
    voiceIdEn: e.ELEVENLABS_VOICE_ID_EN,
    sttModel: e.ELEVENLABS_STT_MODEL ?? "scribe_v2",
    ttsModelMn: e.ELEVENLABS_TTS_MODEL_MN ?? "eleven_v3",
    ttsModelEn: e.ELEVENLABS_TTS_MODEL_EN,
    dbPath: e.AEGIS_DB_PATH ?? "data/aegis.db",
    sessionSecret: e.SESSION_SECRET,
    missionStartDate: e.MISSION_START_DATE ?? "2026-10-01",
  };
}

let cached: Env | undefined;

/** Parsed once per process. Never throws on missing keys: scripted mode needs none. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Live mode is only usable when every key it needs is present. */
export function liveReadiness(env: Env = getEnv()) {
  return {
    llm: Boolean(env.anthropicApiKey),
    stt: Boolean(env.elevenlabsApiKey),
    ttsMn: Boolean(env.elevenlabsApiKey && env.voiceIdMn),
    ttsEn: Boolean(env.elevenlabsApiKey && env.voiceIdEn),
  };
}
