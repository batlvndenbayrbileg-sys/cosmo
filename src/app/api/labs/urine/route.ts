import { handle, HttpError, NotFoundError, ok } from "@/server/http";
import { getUrinePersonSlice } from "@/server/labs/urine";
import { isReferencePerson } from "@/lib/labs/urine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/labs/urine?person=C002 - one Inspiration4 reference crew member's urine panel (NASA OSDR OSD-656, Alamar
 * NULISA; a teammate's personal-baseline analysis), for the dashboard's Labs tab. Public NASA reference data shown for
 * demonstration, like the /signature page, so no session is needed; it never contains app crew health data. The tab
 * loads it only when it opens, so the dashboard page itself does not carry the data.
 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const person = new URL(request.url).searchParams.get("person");
    if (!isReferencePerson(person)) throw new HttpError(400, "BAD_INPUT", "Expected ?person=C001..C004");
    const slice = getUrinePersonSlice(person);
    if (!slice) throw new NotFoundError("No urine panel for this person");
    return ok(slice);
  });
}
