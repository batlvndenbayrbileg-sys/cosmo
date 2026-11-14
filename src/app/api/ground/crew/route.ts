import { buildCrewStatusCards, groundAsOf, parseDelayMs } from "@/server/dashboard/ground";
import { requireGround } from "@/server/dashboard/roles";
import { handle, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Earth console: one status card per crew member, as of now minus the simulated delay (?delayMs=0|180000|1200000). */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    await requireGround();
    const delayMs = parseDelayMs(new URL(request.url).searchParams);
    return ok(await buildCrewStatusCards(groundAsOf(delayMs), delayMs));
  });
}
