import { describe, expect, it } from "vitest";
import { parseEnv, liveReadiness } from "@/server/env";
import { KPI_KEYS, QUESTION_IDS } from "@/lib/types";

describe("env", () => {
  it("runs with an empty environment (scripted mode needs no keys)", () => {
    const env = parseEnv({ DEMO_MODE: "scripted" });
    expect(env.demoMode).toBe("scripted");
    expect(env.anthropicModel).toBe("claude-opus-5-5");
    expect(env.ttsModelMn).toBe("eleven_v4_turbo");
    expect(liveReadiness(env)).toEqual({ llm: false, stt: false, ttsMn: false, ttsEn: false });
  });

  it("treats empty strings from .env files as unset", () => {
    const env = parseEnv({ ELEVENLABS_API_KEY: "  ", ANTHROPIC_MODEL: "" });
    expect(env.elevenlabsApiKey).toBeUndefined();
    expect(env.anthropicModel).toBe("claude-opus-5-5");
  });

  it("reports live readiness per capability", () => {
    const env = parseEnv({
      ANTHROPIC_API_KEY: "a",
      ELEVENLABS_API_KEY: "e",
      ELEVENLABS_VOICE_ID_EN: "v",
    });
    expect(liveReadiness(env)).toEqual({ llm: true, stt: true, ttsMn: false, ttsEn: true });
  });
});

describe("contract constants", () => {
  it("has the 21 stored keys and 17 questions (DASHBOARD_PLAN.md plus the wellbeing check, docs/research/checkin-nasa.md)", () => {
    expect(KPI_KEYS).toHaveLength(21);
    expect(QUESTION_IDS).toHaveLength(17);
  });
});
