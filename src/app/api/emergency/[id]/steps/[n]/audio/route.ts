import type { Lang } from "@/lib/types";
import { normalizeLanguageCode } from "@/lib/language";
import { handle, HttpError, NotFoundError } from "@/server/http";
import { getSession } from "@/server/session";
import { findScenario } from "@/server/emergency/load";
import { synthesizeSpeech } from "@/server/speech/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/emergency/:id/steps/:n/audio?lang=mn|en - Cosmo reads one prepared step aloud (ElevenLabs).
 * Failures are a JSON TTS_FAILED error; the client then uses the browser voice or just shows the text.
 */
export function GET(request: Request, context: { params: Promise<{ id: string; n: string }> }): Promise<Response> {
  return handle(async () => {
    if (!(await getSession())) throw new HttpError(401, "NO_SESSION", "Sign in first");
    const { id, n } = await context.params;
    const scenario = findScenario(id);
    const index = Number.parseInt(n, 10);
    const step = scenario && Number.isInteger(index) ? scenario.steps[index] : undefined;
    if (!step) throw new NotFoundError("Step not found");
    const lang: Lang = normalizeLanguageCode(new URL(request.url).searchParams.get("lang")) ?? "en";
    const spoken = await synthesizeSpeech(step.text[lang], lang);
    return new Response(spoken.body, { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=3600" } });
  });
}
