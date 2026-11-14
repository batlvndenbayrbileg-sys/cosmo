import { z } from "zod";
import { buildDashboardPayload } from "@/server/dashboard/build";
import { groundAsOf, parseDelayMs } from "@/server/dashboard/ground";
import { requireGround } from "@/server/dashboard/roles";
import { handle, HttpError, NotFoundError, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ crewId: z.string().min(1).max(100) });

/**
 * Read-only dashboard of one crew member for the Earth console (viewer "ground": no notes, no
 * source text, template summary wording). 404 when nothing has arrived yet at the chosen delay.
 */
export function GET(request: Request, ctx: { params: Promise<{ crewId: string }> }): Promise<Response> {
  return handle(async () => {
    await requireGround();
    const parsed = paramsSchema.safeParse(await ctx.params);
    if (!parsed.success) throw new HttpError(400, "BAD_INPUT", "Invalid crewId");
    const delayMs = parseDelayMs(new URL(request.url).searchParams);
    const payload = buildDashboardPayload({
      crewId: parsed.data.crewId,
      viewer: "ground",
      asOf: groundAsOf(delayMs),
      delayMs,
    });
    if (!payload) throw new NotFoundError("Nothing received from this crew member yet");
    return ok(payload);
  });
}
