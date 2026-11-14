import { listCrewPublic } from "@/server/db/repos/crew";
import { handle, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The roster for the crew-select screen: id, name, role, language, mascot, avatar seed. No health data, no session needed. */
export function GET(): Promise<Response> {
  return handle(async () => ok(await listCrewPublic()));
}
