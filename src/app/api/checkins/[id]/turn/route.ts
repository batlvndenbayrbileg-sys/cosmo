import { z } from "zod";
import type { Lang, TurnEvent } from "@/lib/types";
import { normalizeLanguageCode } from "@/lib/language";
import { MAX_UTTERANCE_CHARS, runTurn, type TurnInput } from "@/server/agent/turn";
import { getCheckIn } from "@/server/db/repos/checkin";
import { handle, HttpError } from "@/server/http";
import { requireCrewSession } from "@/server/session";
import { transcribeAudio } from "@/server/speech/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jsonSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_UTTERANCE_CHARS),
    language: z.string().min(2).max(20).optional(),
  })
  .strict();

/** an audio upload larger than this is refused (about 8 minutes of compressed speech) */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const encoder = new TextEncoder();

function frame(event: TurnEvent): Uint8Array {
  // JSON.stringify never contains a raw newline, so one "data:" line per event is always valid SSE
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * @param fallbackHint the check-in's language (the crew member's preferred language). Used as the speech-recognition
 * hint when the client sends none: an explicit hint matters for Mongolian, which Scribe can otherwise mistake for a
 * neighbouring language (Mongolian is in Scribe's "moderate" accuracy tier, see docs/sources.md).
 */
async function readInput(request: Request, fallbackHint: Lang | null): Promise<TurnInput> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, "BAD_INPUT", "Invalid multipart body");
    }
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) {
      throw new HttpError(400, "BAD_INPUT", 'Expected a non-empty "audio" file');
    }
    if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(400, "BAD_INPUT", "Audio is too long");
    const rawHint = form.get("language");
    const hint: Lang | null = (typeof rawHint === "string" ? normalizeLanguageCode(rawHint) : null) ?? fallbackHint;
    // throws HttpError(502, STT_FAILED) when speech recognition is unavailable: the client keeps the text box usable
    const heard = await transcribeAudio(audio, { languageHint: hint });
    if (heard.text.trim().length === 0) throw new HttpError(502, "STT_FAILED", "No speech was recognised");
    return { kind: "voice", text: heard.text, languageHint: heard.language ?? hint, sttMs: heard.ms };
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new HttpError(400, "BAD_INPUT", "Body must be JSON or multipart with an audio file");
  }
  const parsed = jsonSchema.safeParse(json);
  if (!parsed.success) throw new HttpError(400, "BAD_INPUT", 'Expected { "text": string, "language"?: string }');
  return { kind: "typed", text: parsed.data.text, languageHint: parsed.data.language ?? null };
}

/**
 * One conversation turn. Request: JSON `{ text, language? }` (typed) or multipart with an `audio` file (voice).
 * Response: text/event-stream, each TurnEvent as `data: <json>` plus a blank line, flushed per event
 * (docs/PLAN.md section 5.1). Another member's check-in id is a 404 before any stream starts; a failure after the
 * stream has started becomes an `error` event followed by `done`, never a broken connection.
 */
export function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { crewId } = await requireCrewSession();
    const { id } = await context.params;
    // 404 for another crew member's check-in, before anything is read or transcribed
    const checkIn = getCheckIn(crewId, id);
    const input = await readInput(request, normalizeLanguageCode(checkIn.language));

    const iterator = runTurn({ crewId, checkInId: id, input })[Symbol.asyncIterator]();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) {
            controller.close();
            return;
          }
          controller.enqueue(frame(next.value));
        } catch (err) {
          console.error("[aegis] turn stream failed:", err);
          controller.enqueue(
            frame({ type: "error", code: "INTERNAL", message: "Something went wrong. Please try again.", recoverable: true }),
          );
          controller.enqueue(frame({ type: "done" }));
          controller.close();
        }
      },
      async cancel() {
        await iterator.return?.(undefined);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        "x-accel-buffering": "no",
      },
    });
  });
}
