import { z } from "zod";
import type { SessionPayload } from "@/lib/types";
import { clearGroundCookie, currentSession, setGroundCookie } from "@/server/dashboard/roles";
import { getCrewPublic } from "@/server/db/repos/crew";
import { handle, HttpError, ok } from "@/server/http";
import { clearSessionCookie, setSessionCookie } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `{ crewId }` signs in as that crew member; `{ role: "ground" }` signs in to the read-only Earth console. */
const bodySchema = z.union([
  z.object({ crewId: z.string().min(1).max(100), role: z.literal("crew").optional() }).strict(),
  z.object({ role: z.literal("ground") }).strict(),
]);

const getQuerySchema = z.object({ role: z.enum(["crew", "ground"]).optional() });

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * 204 + signed httpOnly cookie. Unknown crew member: 404. The two roles use separate cookies
 * (cosmo_session for crew, cosmo_ground for ground): signing one in never touches the other, so
 * opening the Earth console does not end a crew member's session in the same browser.
 */
export function POST(request: Request): Promise<Response> {
  return handle(async () => {
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      throw new HttpError(400, "BAD_INPUT", "Body must be JSON");
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new HttpError(400, "BAD_INPUT", 'Expected { "crewId": string } or { "role": "ground" }');
    }
    const body = parsed.data;
    if ("crewId" in body) {
      await getCrewPublic(body.crewId); // throws NotFoundError for an unknown crew member
      await setSessionCookie({ role: "crew", crewId: body.crewId });
    } else {
      await setGroundCookie();
    }
    return new Response(null, { status: 204, headers: NO_STORE });
  });
}

/**
 * The verified session of the caller, or `{ session: null }`. A browser can hold both a crew and a
 * ground session: the crew one is returned by default, `?role=ground` asks for the ground one.
 */
export function GET(request?: Request): Promise<Response> {
  return handle(async () => {
    const raw = request ? new URL(request.url).searchParams.get("role") : null;
    const parsed = getQuerySchema.safeParse({ role: raw ?? undefined });
    if (!parsed.success) throw new HttpError(400, "BAD_INPUT", "role must be crew or ground");
    const session: SessionPayload | null = await currentSession(parsed.data.role);
    return ok({ session });
  });
}

/** Signs out of both roles. */
export function DELETE(): Promise<Response> {
  return handle(async () => {
    await clearSessionCookie();
    await clearGroundCookie();
    return new Response(null, { status: 204, headers: NO_STORE });
  });
}
