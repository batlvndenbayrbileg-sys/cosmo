import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { SessionPayload } from "@/lib/types";
import { getEnv } from "@/server/env";
import { HttpError } from "@/server/http";
import { getSession, SESSION_TTL_MS, signSession, verifySession } from "@/server/session";

/**
 * Role-aware session helpers for the crew dashboard and the Earth (ground) console.
 *
 * Crew and ground sessions live in SEPARATE cookies so that opening the Earth console in the same
 * browser never destroys a crew member's session (and signing a crew member in never ends the
 * Earth session):
 *   - `aegis_session` (SESSION_COOKIE, owned by src/server/session.ts) holds the crew session;
 *   - `aegis_ground`  (GROUND_COOKIE, here) holds the ground session.
 * Both are HMAC-signed with the same secret and verified with the same pure helpers.
 *
 * Every crew-only and ground-only route in this lane uses requireCrew / requireGround from here.
 * Status codes keep the contract: 401 NO_SESSION when there is no valid session at all, 403
 * FORBIDDEN when the caller only holds the other role.
 */

export const GROUND_COOKIE = "aegis_ground";

/* The same secret as src/server/session.ts: SESSION_SECRET, else the per-process random value that
   module caches on globalThis under this well-known symbol (`??=` keeps both modules on one value). */
const SECRET_KEY = Symbol.for("aegis.sessionSecret");
type GlobalWithSecret = typeof globalThis & { [SECRET_KEY]?: string };

function sessionSecret(): string {
  const configured = getEnv().sessionSecret;
  if (configured) return configured;
  const g = globalThis as GlobalWithSecret;
  g[SECRET_KEY] ??= randomBytes(32).toString("hex");
  return g[SECRET_KEY];
}

export async function setGroundCookie(): Promise<void> {
  const store = await cookies();
  store.set({
    name: GROUND_COOKIE,
    value: signSession({ role: "ground" }, sessionSecret()),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearGroundCookie(): Promise<void> {
  const store = await cookies();
  store.delete(GROUND_COOKIE);
}

/** True when the request carries a valid, unexpired ground cookie. */
export async function hasGroundSession(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(GROUND_COOKIE)?.value;
  if (!token) return false;
  return verifySession(token, sessionSecret())?.role === "ground";
}

/** The crew session if there is one, else the ground session, else null. `role` asks for one specifically. */
export async function currentSession(role?: SessionPayload["role"]): Promise<SessionPayload | null> {
  const crew = role === "ground" ? null : await getSession();
  if (crew?.role === "crew") return crew;
  if (role === "crew") return null;
  return (await hasGroundSession()) ? { role: "ground" } : null;
}

/** crewId of the signed-in crew member. 401 without any session, 403 when only a ground session exists. */
export async function requireCrew(): Promise<{ crewId: string }> {
  const session = await getSession();
  if (session?.role === "crew") return { crewId: session.crewId };
  if (session || (await hasGroundSession())) throw new HttpError(403, "FORBIDDEN", "Crew session required");
  throw new HttpError(401, "NO_SESSION", "Not signed in");
}

/** Resolves for a ground session. 401 without any session, 403 when only a crew session exists. */
export async function requireGround(): Promise<void> {
  if (await hasGroundSession()) return;
  if (await getSession()) throw new HttpError(403, "FORBIDDEN", "Ground session required");
  throw new HttpError(401, "NO_SESSION", "Not signed in");
}
