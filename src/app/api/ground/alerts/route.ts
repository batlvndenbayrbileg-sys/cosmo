import { groundAsOf, listGroundAlerts, parseDelayMs } from "@/server/dashboard/ground";
import { requireGround } from "@/server/dashboard/roles";
import { handle, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Earth console: alerts that have arrived by now minus the simulated delay, newest first. */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    await requireGround();
    const delayMs = parseDelayMs(new URL(request.url).searchParams);
    return ok(await listGroundAlerts(groundAsOf(delayMs)));
  });
}
