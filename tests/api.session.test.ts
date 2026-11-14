import fs from "node:fs";
import path from "node:path";
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

import { GET as getCrew } from "@/app/api/crew/route";
import { DELETE, GET, POST } from "@/app/api/session/route";
import type { ApiError, CrewPublic, HealthResponse } from "@/lib/types";
import { currentSession, GROUND_COOKIE, requireCrew, requireGround } from "@/server/dashboard/roles";
import { getSession, SESSION_COOKIE } from "@/server/session";
import { freshSeededDb } from "./helpers/db";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(async () => {
  await freshSeededDb();
  mocks.jar.clear();
  mocks.sets.length = 0;
  mocks.deletes.length = 0;
});
afterEach(() => {
  vi.doUnmock("@/server/env");
  vi.resetModules();
});

describe("POST /api/session", () => {
  it("signs a crew member in: 204, no body, a signed httpOnly lax cookie that verifies as that crew member", async () => {
    const res = await post({ crewId: "bat" });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.sets).toHaveLength(1);
    expect(mocks.sets[0]).toMatchObject({ name: SESSION_COOKIE, httpOnly: true, sameSite: "lax", path: "/" });
    expect(String(mocks.sets[0].value)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await getSession()).toEqual({ role: "crew", crewId: "bat" });
  });

  it("signs the ground role in with { role: 'ground' }, in its own cookie", async () => {
    const res = await post({ role: "ground" });
    expect(res.status).toBe(204);
    expect(mocks.sets).toHaveLength(1);
    expect(mocks.sets[0]).toMatchObject({ name: GROUND_COOKIE, httpOnly: true, sameSite: "lax", path: "/" });
    expect(GROUND_COOKIE).not.toBe(SESSION_COOKIE);
    expect(mocks.jar.has(SESSION_COOKIE)).toBe(false);
    expect(await currentSession()).toEqual({ role: "ground" });
    await expect(requireGround()).resolves.toBeUndefined();
  });

  it("accepts the explicit crew form { role: 'crew', crewId }", async () => {
    expect((await post({ role: "crew", crewId: "mira" })).status).toBe(204);
    expect(await getSession()).toEqual({ role: "crew", crewId: "mira" });
  });

  it("answers 404 NOT_FOUND for an unknown crew member and sets no cookie", async () => {
    const res = await post({ crewId: "nobody" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("NOT_FOUND");
    expect(mocks.sets).toHaveLength(0);
    expect(await getSession()).toBeNull();
  });

  it("answers 400 BAD_INPUT for bodies that are not exactly { crewId } or { role: 'ground' }", async () => {
    const bad: unknown[] = [
      {},
      { crewId: "" },
      { crewId: 7 },
      { role: "admin" },
      { role: "crew" },
      { crewId: "bat", role: "ground" }, // ambiguous: never silently picks one
      { role: "ground", crewId: "bat" },
      { crewId: "bat", extra: true },
      [],
      null,
      "just a string",
    ];
    for (const body of bad) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as ApiError).error.code).toBe("BAD_INPUT");
    }
    expect((await post("{not json")).status).toBe(400);
    expect(mocks.sets).toHaveLength(0);
  });

  it("keeps the crew and the ground session side by side: signing in one never destroys the other", async () => {
    await post({ crewId: "bat" });
    const crewToken = mocks.jar.get(SESSION_COOKIE);
    await post({ role: "ground" }); // the Earth console opened in the same browser
    expect(mocks.jar.get(SESSION_COOKIE)).toBe(crewToken);
    await expect(requireCrew()).resolves.toEqual({ crewId: "bat" });
    await expect(requireGround()).resolves.toBeUndefined();
    // and the other way round: a later crew sign-in leaves the Earth session alone
    const groundToken = mocks.jar.get(GROUND_COOKIE);
    await post({ crewId: "mira" });
    expect(mocks.jar.get(GROUND_COOKIE)).toBe(groundToken);
    await expect(requireCrew()).resolves.toEqual({ crewId: "mira" });
    await expect(requireGround()).resolves.toBeUndefined();
  });

  it("a ground cookie is not accepted as a crew session, nor a crew cookie as a ground session", async () => {
    await post({ role: "ground" });
    await expect(requireCrew()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    mocks.jar.clear();
    await post({ crewId: "bat" });
    await expect(requireGround()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    mocks.jar.clear();
    await expect(requireCrew()).rejects.toMatchObject({ status: 401, code: "NO_SESSION" });
    await expect(requireGround()).rejects.toMatchObject({ status: 401, code: "NO_SESSION" });
  });

  it("a ground token copied into the crew cookie (or the reverse) does not grant the other role", async () => {
    await post({ role: "ground" });
    mocks.jar.set(SESSION_COOKIE, mocks.jar.get(GROUND_COOKIE) as string);
    await expect(requireCrew()).rejects.toMatchObject({ status: 403 });
    mocks.jar.clear();
    await post({ crewId: "bat" });
    mocks.jar.set(GROUND_COOKIE, mocks.jar.get(SESSION_COOKIE) as string);
    await expect(requireGround()).rejects.toMatchObject({ status: 403 });
  });
});

describe("GET /api/session and DELETE /api/session", () => {
  it("returns { session: null } without a cookie", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session: null });
  });

  it("returns the signed-in session, the crew one first when both roles are signed in", async () => {
    await post({ crewId: "saraa" });
    expect(await (await GET()).json()).toEqual({ session: { role: "crew", crewId: "saraa" } });
    await post({ role: "ground" });
    expect(await (await GET()).json()).toEqual({ session: { role: "crew", crewId: "saraa" } });
    const at = (qs: string) => GET(new Request(`http://localhost/api/session${qs}`));
    expect(await (await at("?role=ground")).json()).toEqual({ session: { role: "ground" } });
    expect(await (await at("?role=crew")).json()).toEqual({ session: { role: "crew", crewId: "saraa" } });
    mocks.jar.delete(SESSION_COOKIE);
    expect(await (await at("")).json()).toEqual({ session: { role: "ground" } });
    expect(await (await at("?role=crew")).json()).toEqual({ session: null });
    expect((await at("?role=admin")).status).toBe(400);
  });

  it("returns { session: null } for a tampered cookie", async () => {
    await post({ crewId: "bat" });
    mocks.jar.set(SESSION_COOKIE, `${mocks.jar.get(SESSION_COOKIE)}x`);
    expect(await (await GET()).json()).toEqual({ session: null });
  });

  it("DELETE answers 204 and clears both the crew and the ground cookie", async () => {
    await post({ crewId: "bat" });
    await post({ role: "ground" });
    const res = await DELETE();
    expect(res.status).toBe(204);
    expect(mocks.deletes).toEqual([SESSION_COOKIE, GROUND_COOKIE]);
    expect(await (await GET()).json()).toEqual({ session: null });
    expect(await (await GET(new Request("http://localhost/api/session?role=ground"))).json()).toEqual({ session: null });
  });

  it("DELETE without a session is still 204", async () => {
    expect((await DELETE()).status).toBe(204);
  });
});

describe("GET /api/crew", () => {
  it("lists the 4 crew members with roster fields only, no session needed and no health data", async () => {
    const res = await getCrew();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const crew = (await res.json()) as CrewPublic[];
    expect(crew.map((c) => c.id)).toEqual(["bat", "saraa", "alex", "mira"]);
    for (const c of crew) {
      expect(Object.keys(c).sort()).toEqual(
        ["avatarSeed", "id", "mascotVariant", "name", "preferredLanguage", "role"].sort(),
      );
    }
    const text = JSON.stringify(crew);
    for (const word of ["sleep", "heart", "alert", "readiness", "overall", "headache"]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });
});

describe("GET /api/health", () => {
  it("reports scripted mode with nothing live configured and the rive file check", async () => {
    // an explicit empty environment, so keys that happen to exist on the developer machine cannot leak in
    const actual = await vi.importActual<typeof import("@/server/env")>("@/server/env");
    const env = actual.parseEnv({ DEMO_MODE: "scripted" });
    vi.resetModules();
    vi.doMock("@/server/env", () => ({ ...actual, getEnv: () => env }));
    const { GET: getHealth } = await import("@/app/api/health/route");
    const res = await getHealth();
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthResponse;
    expect(body.mode).toBe("scripted");
    expect(body.llm).toEqual({ model: null, available: false });
    expect(body.stt).toEqual({ model: null, available: false });
    expect(body.tts).toEqual({
      mn: { model: null, available: false },
      en: { model: null, available: false },
    });
    expect(body.rive).toBe(fs.existsSync(path.join(process.cwd(), "public", "cosmo.riv")));
  });

  it("reports live capabilities from liveReadiness() and never leaks keys or voice ids", async () => {
    const actual = await vi.importActual<typeof import("@/server/env")>("@/server/env");
    const env = actual.parseEnv({
      DEMO_MODE: "live",
      ANTHROPIC_API_KEY: "sk-ant-SECRET-KEY-111",
      ANTHROPIC_MODEL: "claude-test-model",
      ELEVENLABS_API_KEY: "xi-SECRET-KEY-222",
      ELEVENLABS_VOICE_ID_MN: "VOICE-MN-333",
      // no English voice id: English TTS must be reported unavailable
    });
    vi.resetModules();
    vi.doMock("@/server/env", () => ({ ...actual, getEnv: () => env }));
    const route = await import("@/app/api/health/route");
    const res = await route.GET();
    const text = await res.text();
    const body = JSON.parse(text) as HealthResponse;
    expect(body.mode).toBe("live");
    expect(body.llm).toEqual({ model: "claude-test-model", available: true });
    expect(body.stt).toEqual({ model: "scribe_v3", available: true });
    expect(body.tts.mn).toEqual({ model: "eleven_v4_turbo", available: true });
    expect(body.tts.en).toEqual({ model: null, available: false });
    for (const secret of ["SECRET-KEY", "VOICE-MN", "sk-ant", "xi-"]) expect(text).not.toContain(secret);
  });
});
