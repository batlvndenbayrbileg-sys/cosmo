import { handle, HttpError, ok } from "@/server/http";
import { getSession } from "@/server/session";
import { loadEmergencyLibrary } from "@/server/emergency/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/emergency - the prepared emergency guidance (team content + the built-in "get help" card).
 * Any signed-in session (crew or ground). Problems with the team's folders are logged server-side only.
 */
export function GET(): Promise<Response> {
  return handle(async () => {
    if (!(await getSession())) throw new HttpError(401, "NO_SESSION", "Sign in first");
    const lib = loadEmergencyLibrary();
    if (lib.problems.length > 0) console.warn("[cosmo] emergency content problems:\n  " + lib.problems.join("\n  "));
    return ok({ scenarios: lib.scenarios });
  });
}
