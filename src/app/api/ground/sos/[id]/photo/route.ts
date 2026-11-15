import { z } from "zod";
import { groundAsOf, parseDelayMs } from "@/server/dashboard/ground";
import { requireGround } from "@/server/dashboard/roles";
import { groundGetSosPhoto } from "@/server/db/repos/ground";
import { handle, HttpError, NotFoundError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().min(1).max(80) });

/**
 * The face still of an SOS alert, for the Earth console only (ground role; a crew session is 403, none is 401).
 * Never cached. 404 when the alert has no photo (yet) or has not arrived at the simulated delay.
 */
export function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    await requireGround();
    const parsed = paramsSchema.safeParse(await ctx.params);
    if (!parsed.success) throw new HttpError(400, "BAD_INPUT", "Invalid SOS id");
    const delayMs = parseDelayMs(new URL(request.url).searchParams);
    const jpeg = await groundGetSosPhoto(parsed.data.id, groundAsOf(delayMs));
    if (!jpeg) throw new NotFoundError("No photo");
    return new Response(new Uint8Array(jpeg), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
