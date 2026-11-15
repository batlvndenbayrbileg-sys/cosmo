import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ jar: new Map<string, string>(), sets: [] as Array<Record<string, unknown>> }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name) as string } : undefined),
    set: (opts: { name: string; value: string }) => {
      mocks.sets.push(opts);
      mocks.jar.set(opts.name, opts.value);
    },
    delete: (name: string) => mocks.jar.delete(name),
  }),
}));

import { POST as identify, type IdentifyResponse } from "@/app/api/identify/route";
import { POST as createCheckIns } from "@/app/api/checkins/route";
import type { CheckInCreated } from "@/lib/types";
import { getSession, SESSION_COOKIE } from "@/server/session";
import { setClockForTests } from "@/server/clock";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

/**
 * POST /api/identify: the first words choose the person (language x on-device voice guess, or a name said), and the
 * crew session cookie is set for exactly that person; POST /api/checkins { mode: "assistant" } then opens their own
 * assistant conversation.
 */

const post = (body: unknown) =>
  identify(new Request("http://localhost/api/identify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(async () => {
  setClockForTests(TEST_TODAY);
  await freshSeededDb();
  mocks.jar.clear();
  mocks.sets.length = 0;
});

describe("POST /api/identify", () => {
  it.each([
    ["Сайн байна уу", "female", "saraa", "mn"],
    ["Сайн байна уу", "male", "bat", "mn"],
    ["Hi Cosmo", "male", "alex", "en"],
    ["Hello there", "female", "mira", "en"],
  ] as const)("%s + %s voice -> %s, and the session is theirs", async (text, voice, crewId, language) => {
    const res = await post({ text, voice });
    expect(res.status).toBe(200);
    const body = (await res.json()) as IdentifyResponse;
    expect(body).toMatchObject({ transcript: text, language, reason: "voice", crew: { id: crewId } });
    expect(mocks.sets).toHaveLength(1);
    expect(mocks.sets[0]).toMatchObject({ name: SESSION_COOKIE, httpOnly: true });
    expect(await getSession()).toEqual({ role: "crew", crewId });
  });

  it("an unknown voice asks (no cookie), naming the people of that language", async () => {
    const body = (await (await post({ text: "Сайн байна уу", voice: "unknown" })).json()) as IdentifyResponse;
    expect(body).toMatchObject({ crew: null, reason: "ask", language: "mn" });
    expect(body.candidates.map((c) => c.id)).toEqual(["bat", "saraa"]);
    expect(mocks.sets).toHaveLength(0);
    expect(await getSession()).toBeNull();
  });

  it("a name wins over the voice; a bare name counts once Cosmo asked", async () => {
    expect(((await (await post({ text: "I'm Mira", voice: "male" })).json()) as IdentifyResponse).crew?.id).toBe("mira");
    expect(((await (await post({ text: "Сараа", voice: "unknown" })).json()) as IdentifyResponse).crew).toBeNull();
    expect(((await (await post({ text: "Сараа", voice: "unknown", asked: true })).json()) as IdentifyResponse).crew?.id).toBe("saraa");
    expect(await getSession()).toEqual({ role: "crew", crewId: "saraa" });
  });

  it("keeps the previous person of the same language when the voice says nothing", async () => {
    const body = (await (await post({ text: "Сайн уу", voice: "unknown", previous: "saraa" })).json()) as IdentifyResponse;
    expect(body).toMatchObject({ reason: "previous", crew: { id: "saraa" } });
  });

  it("rejects a malformed body", async () => {
    expect((await post({ voice: "female" })).status).toBe(400);
    expect((await post({ text: "hi", voice: "loud" })).status).toBe(400);
  });

  it("then opens that person's own assistant conversation", async () => {
    await post({ text: "Сайн байна уу", voice: "female" });
    const res = await createCheckIns(
      new Request("http://localhost/api/checkins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "assistant", language: "mn", welcome: "quiet" }),
      }),
    );
    expect(res.status).toBe(200);
    const created = (await res.json()) as CheckInCreated;
    expect(created).toMatchObject({ assistant: true, language: "mn", say: null });
    expect(created.greeting.text).toMatch(/Сараа/u);
  });
});
