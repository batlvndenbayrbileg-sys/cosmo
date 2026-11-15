import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { SessionPayload } from "@/lib/types";
import { getEnv } from "@/server/env";
import { HttpError } from "@/server/http";

export const SESSION_COOKIE = "cosmo_session";
/** 12 hours */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/* ───────────── pure signing (no Next, no env: unit-testable) ───────────── */

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function mac(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

function toMs(now: number | Date): number {
  return now instanceof Date ? now.getTime() : now;
}

/**
 * token = base64url(JSON {p: payload, exp: epoch ms}) + "." + base64url(HMAC-SHA256(body, secret)).
 * `now` is epoch ms (or a Date), defaults to the current time; the token expires 12 h later.
 */
export function signSession(
  payload: SessionPayload,
  secret: string,
  now: number | Date = Date.now(),
): string {
  const body = b64url(Buffer.from(JSON.stringify({ p: payload, exp: toMs(now) + SESSION_TTL_MS })));
  return `${body}.${b64url(mac(body, secret))}`;
}

function parsePayload(v: unknown): SessionPayload | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.role === "ground") return { role: "ground" };
  if (o.role === "crew" && typeof o.crewId === "string" && o.crewId.length > 0) {
    return { role: "crew", crewId: o.crewId };
  }
  return null;
}

/** Returns the payload, or null for a malformed, tampered, wrongly signed or expired token. */
export function verifySession(
  token: string,
  secret: string,
  now: number | Date = Date.now(),
): SessionPayload | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = mac(body, secret);
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      p?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.exp !== "number" || !(toMs(now) < parsed.exp)) return null;
    return parsePayload(parsed.p);
  } catch {
    return null;
  }
}

/* ───────────── secret ───────────── */

const SECRET_KEY = Symbol.for("cosmo.sessionSecret");
type GlobalWithSecret = typeof globalThis & { [SECRET_KEY]?: string };

/** SESSION_SECRET, else a random value per process (cached on globalThis so dev reloads keep it). */
function sessionSecret(): string {
  const configured = getEnv().sessionSecret;
  if (configured) return configured;
  const g = globalThis as GlobalWithSecret;
  g[SECRET_KEY] ??= randomBytes(32).toString("hex");
  return g[SECRET_KEY];
}

/* ───────────── cookie helpers (Next 16: cookies() is async) ───────────── */

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE,
    value: signSession(payload, sessionSecret()),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** The verified session, or null (no cookie, bad signature, expired). */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token, sessionSecret());
}

/** 401 NO_SESSION without a session; 403 FORBIDDEN for the ground role. */
export async function requireCrewSession(): Promise<{ crewId: string }> {
  const session = await getSession();
  if (!session) throw new HttpError(401, "NO_SESSION", "Not signed in");
  if (session.role !== "crew") throw new HttpError(403, "FORBIDDEN", "Crew session required");
  return { crewId: session.crewId };
}

/** 401 NO_SESSION without a session; 403 FORBIDDEN for the crew role. */
export async function requireGroundSession(): Promise<void> {
  const session = await getSession();
  if (!session) throw new HttpError(401, "NO_SESSION", "Not signed in");
  if (session.role !== "ground") throw new HttpError(403, "FORBIDDEN", "Ground session required");
}
