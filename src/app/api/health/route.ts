import fs from "node:fs";
import path from "node:path";
import type { HealthResponse } from "@/lib/types";
import { getEnv, liveReadiness } from "@/server/env";
import { handle, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which parts of the stack are usable. `available` is whether the live service is configured
 * (keys present), independent of DEMO_MODE: in scripted mode the client looks at `mode` first.
 * Never exposes keys or voice ids.
 */
export function GET(): Promise<Response> {
  return handle(() => {
    const env = getEnv();
    const ready = liveReadiness(env);
    const body: HealthResponse = {
      mode: env.demoMode,
      llm: { model: ready.llm ? env.anthropicModel : null, available: ready.llm },
      stt: { model: ready.stt ? env.sttModel : null, available: ready.stt },
      tts: {
        mn: { model: ready.ttsMn ? env.ttsModelMn : null, available: ready.ttsMn },
        en: { model: ready.ttsEn ? (env.ttsModelEn ?? null) : null, available: ready.ttsEn },
      },
      rive: fs.existsSync(path.join(process.cwd(), "public", "cosmo.riv")),
    };
    return ok(body);
  });
}
