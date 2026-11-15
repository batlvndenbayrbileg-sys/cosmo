import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sets: [] as Array<Record<string, unknown>>,
  deletes: [] as string[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name) as string } : undefined),
    set: (opts: { name: string; value: string }) => {
      mocks.sets.push(opts);
      mocks.jar.set(opts.name, opts.value);
    },
    delete: (name: string) => {
      mocks.deletes.push(name);
      mocks.jar.delete(name);
    },
  }),
}));

import type { SessionPayload } from "@/lib/types";
import { HttpError } from "@/server/http";
import {
  clearSessionCookie,
  getSession,
  requireCrewSession,
  requireGroundSession,
  setSessionCookie,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  signSession,
  verifySession,
} from "@/server/session";

const SECRET = "test-secret-0123456789";
const NOW = Date.UTC(2026, 10, 14, 8, 0, 0);
const CREW: SessionPayload = { role: "crew", crewId: "bat" };
const GROUND: SessionPayload = { role: "ground" };

describe("signSession / verifySession (pure)", () => {
  it("round-trips crew and ground payloads", () => {
    expect(verifySession(signSession(CREW, SECRET, NOW), SECRET, NOW)).toEqual(CREW);
    expect(verifySession(signSession(GROUND, SECRET, NOW), SECRET, NOW)).toEqual(GROUND);
  });

  it("accepts a Date for now and defaults to the current time", () => {
    expect(verifySession(signSession(CREW, SECRET, new Date(NOW)), SECRET, new Date(NOW + 1000))).toEqual(CREW);
    expect(verifySession(signSession(CREW, SECRET), SECRET)).toEqual(CREW);
  });

  it("produces a base64url body and signature separated by a dot", () => {
    const token = signSession(CREW, SECRET, NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("rejects a wrong secret", () => {
    expect(verifySession(signSession(CREW, SECRET, NOW), "another-secret", NOW)).toBeNull();
  });

  it("rejects a tampered payload (role escalation crew -> ground)", () => {
    const token = signSession(CREW, SECRET, NOW);
    const [body, sig] = token.split(".");
    const forged = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    forged.p = { role: "ground" };
    const forgedBody = Buffer.from(JSON.stringify(forged)).toString("base64url");
    expect(verifySession(`${forgedBody}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered crewId (crew -> another crew member)", () => {
    const token = signSession(CREW, SECRET, NOW);
    const [body, sig] = token.split(".");
    const forged = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    forged.p = { role: "crew", crewId: "saraa" };
    const forgedBody = Buffer.from(JSON.stringify(forged)).toString("base64url");
    expect(verifySession(`${forgedBody}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered or truncated signature", () => {
    const token = signSession(CREW, SECRET, NOW);
    const flipped = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect(verifySession(flipped, SECRET, NOW)).toBeNull();
    expect(verifySession(token.slice(0, -4), SECRET, NOW)).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    for (const bad of ["", ".", "abc", "a.b.c", "a.", ".b", "%%%.%%%", "not a token"]) {
      expect(verifySession(bad, SECRET, NOW)).toBeNull();
    }
  });

  it("rejects a correctly signed but structurally invalid payload", () => {
    const body = Buffer.from(JSON.stringify({ p: { role: "admin" }, exp: NOW + 1000 })).toString("base64url");
    // correctly signed with the real secret, but the payload shape is invalid
    const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(verifySession(`${body}.${sig}`, SECRET, NOW)).toBeNull();
    const noCrewId = Buffer.from(JSON.stringify({ p: { role: "crew" }, exp: NOW + 1000 })).toString("base64url");
    const sig2 = createHmac("sha256", SECRET).update(noCrewId).digest("base64url");
    expect(verifySession(`${noCrewId}.${sig2}`, SECRET, NOW)).toBeNull();
  });

  it("expires after 12 hours", () => {
    expect(SESSION_TTL_MS).toBe(12 * 60 * 60 * 1000);
    const token = signSession(CREW, SECRET, NOW);
    expect(verifySession(token, SECRET, NOW + SESSION_TTL_MS - 1)).toEqual(CREW);
    expect(verifySession(token, SECRET, NOW + SESSION_TTL_MS)).toBeNull();
    expect(verifySession(token, SECRET, NOW + SESSION_TTL_MS + 60_000)).toBeNull();
  });
});

describe("session cookie + role checks", () => {
  beforeEach(() => {
    mocks.jar.clear();
    mocks.sets.length = 0;
    mocks.deletes.length = 0;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("setSessionCookie writes cosmo_session with httpOnly, sameSite lax, path / and a 12 h max age", async () => {
    await setSessionCookie(CREW);
    expect(mocks.sets).toHaveLength(1);
    const c = mocks.sets[0];
    expect(c.name).toBe(SESSION_COOKIE);
    expect(SESSION_COOKIE).toBe("cosmo_session");
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("lax");
    expect(c.path).toBe("/");
    expect(c.maxAge).toBe(12 * 60 * 60);
    expect(c.secure).toBe(false);
  });

  it("marks the cookie secure only in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await setSessionCookie(GROUND);
    expect(mocks.sets[0].secure).toBe(true);
  });

  it("getSession returns the payload that was set, and null without a cookie", async () => {
    expect(await getSession()).toBeNull();
    await setSessionCookie(CREW);
    expect(await getSession()).toEqual(CREW);
    await setSessionCookie(GROUND);
    expect(await getSession()).toEqual(GROUND);
  });

  it("getSession ignores a tampered cookie and an expired one", async () => {
    await setSessionCookie(CREW);
    const token = mocks.jar.get(SESSION_COOKIE) as string;
    mocks.jar.set(SESSION_COOKIE, `${token}x`);
    expect(await getSession()).toBeNull();

    mocks.jar.set(SESSION_COOKIE, token);
    expect(await getSession()).toEqual(CREW);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + SESSION_TTL_MS + 1000);
    expect(await getSession()).toBeNull();
  });

  it("clearSessionCookie removes the cookie", async () => {
    await setSessionCookie(CREW);
    await clearSessionCookie();
    expect(mocks.deletes).toEqual([SESSION_COOKIE]);
    expect(await getSession()).toBeNull();
  });

  it("requireCrewSession: 401 NO_SESSION without a session, 403 FORBIDDEN for ground, crewId for crew", async () => {
    await expect(requireCrewSession()).rejects.toMatchObject({ status: 401, code: "NO_SESSION" });
    await setSessionCookie(GROUND);
    await expect(requireCrewSession()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await setSessionCookie(CREW);
    await expect(requireCrewSession()).resolves.toEqual({ crewId: "bat" });
  });

  it("requireGroundSession: 401 without a session, 403 for crew, resolves for ground", async () => {
    await expect(requireGroundSession()).rejects.toMatchObject({ status: 401, code: "NO_SESSION" });
    await setSessionCookie(CREW);
    await expect(requireGroundSession()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await setSessionCookie(GROUND);
    await expect(requireGroundSession()).resolves.toBeUndefined();
  });

  it("role errors are HttpError instances", async () => {
    await setSessionCookie(CREW);
    await expect(requireGroundSession()).rejects.toBeInstanceOf(HttpError);
  });
});
