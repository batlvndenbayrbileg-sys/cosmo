import fs from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/server/env";
import { listTurns } from "@/server/db/repos/turn";
import { handle, HttpError, NotFoundError } from "@/server/http";
import { requireCrewSession } from "@/server/session";
import { demoAudioFileName, synthesizeSpeech } from "@/server/speech/tts";
import { turnPart } from "@/lib/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** where pre-generated clips live; the file name scheme is documented at demoAudioFileName in speech/tts.ts */
const DEMO_AUDIO_DIR = path.join(process.cwd(), "public", "demo", "audio");

const AUDIO_HEADERS = { "content-type": "audio/mpeg", "cache-control": "private, max-age=3600" } as const;

/**
 * Cosmo's voice for one of Cosmo's own turns (live playback and the replay button). The text is looked up from the
 * stored turn, so no text travels in a URL, and only Cosmo's turns can be voiced (never the astronaut's).
 *
 *  - DEMO_MODE=scripted: serves public/demo/audio/<lang>-<sha1(text) first 12 hex>.mp3 when that clip exists;
 *  - otherwise (or when the clip is missing): synthesizeSpeech(text, lang);
 *  - when that fails too: a JSON error (TTS_FAILED, 502) that the client treats as "use speechSynthesis".
 * Another member's check-in id is a 404.
 */
export function GET(
  request: Request,
  context: { params: Promise<{ id: string; turnId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { crewId } = await requireCrewSession();
    const { id, turnId } = await context.params;
    const turn = (await listTurns(crewId, id)).find((t) => t.id === turnId && t.speaker === "cosmo");
    if (!turn) throw new NotFoundError("Turn not found");
    // ?part=n: one line of the turn, i.e. one beat of Cosmo's step-by-step walkthrough (src/lib/explain.ts); still
    // only the stored text is voiced, the URL carries an index and never any words
    const partParam = new URL(request.url).searchParams.get("part");
    let text = turn.text;
    if (partParam !== null) {
      const line = /^\d{1,2}$/.test(partParam) ? turnPart(turn.text, Number(partParam)) : null;
      if (line === null) throw new NotFoundError("Turn part not found");
      text = line;
    }

    if (getEnv().demoMode === "scripted") {
      const file = path.join(DEMO_AUDIO_DIR, demoAudioFileName(text, turn.language));
      try {
        const bytes = await fs.readFile(file);
        return new Response(new Uint8Array(bytes), { headers: AUDIO_HEADERS });
      } catch {
        // no pre-generated clip for this line: fall through to synthesis
      }
    }

    try {
      const spoken = await synthesizeSpeech(text, turn.language);
      return new Response(spoken.body, { status: 200, headers: AUDIO_HEADERS });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      console.error("[aegis] speech synthesis failed:", err);
      throw new HttpError(502, "TTS_FAILED", "Speech synthesis failed");
    }
  });
}
