import { z } from "zod";
import { buildDashboardPayload } from "@/server/dashboard/build";
import { requireCrew } from "@/server/dashboard/roles";
import { handle, HttpError, NotFoundError, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ checkInId: z.string().min(1).max(100).optional() });

/**
 * The signed-in crew member's dashboard: the given confirmed check-in (?checkInId=, must be their
 * own) or their latest confirmed one. 404 when there is none (also for another member's id).
 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const { crewId } = await requireCrew();
    const params = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({ checkInId: params.get("checkInId") ?? undefined });
    if (!parsed.success) throw new HttpError(400, "BAD_INPUT", "Invalid checkInId");
    const payload = await buildDashboardPayload({ crewId, checkInId: parsed.data.checkInId, viewer: "crew" });
    if (!payload) throw new NotFoundError("No confirmed check-in yet");
    return ok(payload);
  });
}
