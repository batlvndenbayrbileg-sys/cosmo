import { z } from "zod";
import { now } from "@/server/clock";
import { requireCrew } from "@/server/dashboard/roles";
import { ackAlert } from "@/server/db/repos/alert";
import { handle, HttpError, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().min(1).max(200) });

/** Acknowledges one of the signed-in crew member's own alerts (another member's id is a 404). Idempotent. */
export function POST(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { crewId } = await requireCrew();
    const parsed = paramsSchema.safeParse(await ctx.params);
    if (!parsed.success) throw new HttpError(400, "BAD_INPUT", "Invalid alert id");
    return ok(ackAlert(crewId, parsed.data.id, now()));
  });
}
