import { z } from "zod";
import { createOrResumeAssistant, createOrResumeCheckIn } from "@/server/checkin/service";
import { handle, HttpError, ok } from "@/server/http";
import { requireCrewSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    language: z.string().min(2).max(20).optional(),
    mode: z.literal("assistant").optional(),
    welcome: z.enum(["quiet", "back"]).optional(),
  })
  .strict();

/**
 * Starts today's check-in, or resumes today's unconfirmed one (`resumed: true`). `crewId` comes from the signed
 * session only. Body (optional): `{ language? }`, the language of the greeting; the default is the crew member's
 * preferred language. `{ mode: "assistant", welcome? }` (the "/" screen) continues today's newest row, confirmed or
 * not, with assistant mode on (createOrResumeAssistant); the daily check-up on it opens only when asked for.
 */
export function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { crewId } = await requireCrewSession();
    const raw = await request.text();
    let json: unknown = {};
    if (raw.trim().length > 0) {
      try {
        json = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "BAD_INPUT", "Body must be JSON");
      }
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) throw new HttpError(400, "BAD_INPUT", 'Expected { "language"?: string, "mode"?: "assistant" }');
    if (parsed.data.mode === "assistant") {
      return ok(await createOrResumeAssistant(crewId, { language: parsed.data.language, welcome: parsed.data.welcome }));
    }
    return ok(await createOrResumeCheckIn(crewId, parsed.data.language));
  });
}
