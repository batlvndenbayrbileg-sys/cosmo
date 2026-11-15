import { z } from "zod";
import { requireGround } from "@/server/dashboard/roles";
import { groundMarkSosSeen } from "@/server/db/repos/sos";
import { handle, HttpError, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().min(1).max(80) });

/** The Earth console acknowledges an SOS alert ("seen"): stops its alarm. Ground role only; idempotent. */
export function POST(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    await requireGround();
    const parsed = paramsSchema.safeParse(await ctx.params);
    if (!parsed.success) throw new HttpError(400, "BAD_INPUT", "Invalid SOS id");
    return ok(await groundMarkSosSeen(parsed.data.id));
  });
}
