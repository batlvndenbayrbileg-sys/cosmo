import { z } from "zod";
import { requireCrew } from "@/server/dashboard/roles";
import { handle, HttpError, ok } from "@/server/http";
import { raiseSosFromButton } from "@/server/sos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z
  .object({
    reason: z.literal("button").optional(),
    checkInId: z.string().min(1).max(80).nullable().optional(),
    language: z.enum(["mn", "en"]).optional(),
  })
  .strict();

/**
 * POST /api/sos - the crew member pressed SOS: one urgent alert for the Earth console (crew role, own alerts only).
 * Idempotent per incident: a second press within 30 s returns the same alert with `duplicate: true`. The answer
 * carries Cosmo's line, which the client says only now that the alert is stored. The face still follows separately
 * (POST /api/sos/[id]/photo).
 */
export function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { crewId } = await requireCrew();
    const parsed = body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "BAD_INPUT", "Expected { reason?, checkInId?, language? }");
    return ok(await raiseSosFromButton(crewId, parsed.data));
  });
}
