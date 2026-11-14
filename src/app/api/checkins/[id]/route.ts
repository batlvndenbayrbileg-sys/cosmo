import { getSnapshot } from "@/server/checkin/service";
import { handle, ok } from "@/server/http";
import { requireCrewSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reload / resume: stored values with their status, and the conversation so far. 404 for another member's id. */
export function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { crewId } = await requireCrewSession();
    const { id } = await context.params;
    return ok(await getSnapshot(crewId, id));
  });
}
