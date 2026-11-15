import { z } from "zod";
import { groundAsOf, parseDelayMs } from "@/server/dashboard/ground";
import { requireGround } from "@/server/dashboard/roles";
import { groundListSosAlerts } from "@/server/db/repos/ground";
import { handle, HttpError, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const crewIdSchema = z.string().min(1).max(80).regex(/^[\w-]+$/);

/**
 * Earth console: SOS alerts that have arrived by now minus the simulated delay, newest first (optionally one crew
 * member's, ?crewId=). Ground role only. The console polls this every few seconds; photos come from
 * /api/ground/sos/[id]/photo.
 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    await requireGround();
    const params = new URL(request.url).searchParams;
    const delayMs = parseDelayMs(params);
    const rawCrew = params.get("crewId");
    let crewId: string | undefined;
    if (rawCrew !== null && rawCrew !== "") {
      const parsed = crewIdSchema.safeParse(rawCrew);
      if (!parsed.success) throw new HttpError(400, "BAD_INPUT", "Invalid crewId");
      crewId = parsed.data;
    }
    return ok(await groundListSosAlerts(groundAsOf(delayMs), { crewId }));
  });
}
