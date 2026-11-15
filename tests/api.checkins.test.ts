import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name) as string } : undefined),
    set: (opts: { name: string; value: string }) => void mocks.jar.set(opts.name, opts.value),
    delete: (name: string) => void mocks.jar.delete(name),
  }),
}));

import { GET as getDemoScript } from "@/app/api/demo/script/route";
import { GET as getAudio } from "@/app/api/checkins/[id]/turns/[turnId]/audio/route";
import { POST as postTurn } from "@/app/api/checkins/[id]/turn/route";
import { GET as getSnapshotRoute } from "@/app/api/checkins/[id]/route";
import { POST as postCheckIn } from "@/app/api/checkins/route";
import { GET as getDashboard } from "@/app/api/dashboard/route";
import type { ApiError, CheckInCreated, CheckInSnapshot, TurnEvent } from "@/lib/types";
import { DEMO_SCRIPTS } from "@/server/agent/scripts";
import { setClockForTests } from "@/server/clock";
import { listTurns } from "@/server/db/repos/turn";
import { setSessionCookie } from "@/server/session";
import { demoAudioFileName } from "@/server/speech/tts";
import { parseSse } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

beforeEach(async () => {
  setClockForTests(TEST_TODAY);
  await freshSeededDb();
  mocks.jar.clear();
});
afterEach(() => setClockForTests(null));

const signIn = (crewId: string) => setSessionCookie({ role: "crew", crewId });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

const jsonPost = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function createCheckIn(language?: string): Promise<CheckInCreated> {
  const res = await postCheckIn(jsonPost("/api/checkins", language ? { language } : {}));
  expect(res.status).toBe(200);
  return (await res.json()) as CheckInCreated;
}

const turnRequest = (id: string, text: string) => postTurn(jsonPost(`/api/checkins/${id}/turn`, { text }), ctx({ id }));

async function sendTurn(id: string, text: string): Promise<TurnEvent[]> {
  const res = await turnRequest(id, text);
  expect(res.status).toBe(200);
  return parseSse(await res.text());
}

async function errorOf(res: Response): Promise<ApiError["error"]> {
  return ((await res.json()) as ApiError).error;
}

describe("POST /api/checkins", () => {
  it("needs a crew session", async () => {
    const res = await postCheckIn(jsonPost("/api/checkins", {}));
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("NO_SESSION");
  });

  it("creates a check-in with the greeting in the crew member's preferred language", async () => {
    await signIn("bat");
    const created = await createCheckIn();
    expect(created).toMatchObject({ state: "GREETING", language: "mn", resumed: false });
    expect(created.greeting.text).toBe("Сайн уу, Бат! Би Cosmo байна. Өнөөдөр ямар байна даа?");
    expect(created.greeting.turnId).toBeTruthy();
    // the greeting is stored as a Cosmo turn
    expect((await listTurns("bat", created.checkInId)).map((t) => [t.speaker, t.id])).toEqual([["cosmo", created.greeting.turnId]]);
  });

  it("honours an explicit language and accepts an empty body", async () => {
    await signIn("bat");
    const res = await postCheckIn(new Request("http://localhost/api/checkins", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as CheckInCreated).language).toBe("mn");

    mocks.jar.clear();
    await signIn("alex");
    const en = await createCheckIn("en");
    expect(en.greeting.text).toBe("Hi Alex, I'm Cosmo. How are you feeling today?");
  });

  it("resumes today's unconfirmed check-in with its original greeting", async () => {
    await signIn("bat");
    const first = await createCheckIn();
    await sendTurn(first.checkInId, "I'm fine");
    const again = await createCheckIn();
    expect(again).toMatchObject({ checkInId: first.checkInId, resumed: true, state: "SMALL_TALK" });
    expect(again.greeting).toEqual(first.greeting);
  });

  it("rejects malformed bodies", async () => {
    await signIn("bat");
    for (const body of ["{not json", JSON.stringify({ language: 5 }), JSON.stringify({ crewId: "saraa" })]) {
      const res = await postCheckIn(jsonPost("/api/checkins", body));
      expect(res.status, body).toBe(400);
      expect((await errorOf(res)).code).toBe("BAD_INPUT");
    }
  });

  it("takes the crew id from the session only: a body field is refused, and each session gets its own check-in", async () => {
    await signIn("bat");
    const bat = await createCheckIn();
    mocks.jar.clear();
    await signIn("saraa");
    const saraa = await createCheckIn();
    expect(saraa.checkInId).not.toBe(bat.checkInId);
    expect(await listTurns("saraa", saraa.checkInId)).toHaveLength(1);
  });
});

describe("GET /api/checkins/[id]", () => {
  it("returns the snapshot: state, measurements with status, turns", async () => {
    await signIn("bat");
    const { checkInId } = await createCheckIn("en");
    await sendTurn(checkInId, "hello");
    const res = await getSnapshotRoute(new Request(`http://localhost/api/checkins/${checkInId}`), ctx({ id: checkInId }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const snapshot = (await res.json()) as CheckInSnapshot;
    expect(snapshot.checkIn).toMatchObject({ id: checkInId, state: "SMALL_TALK", language: "en", confirmedAt: null });
    expect(snapshot.turns.map((t) => t.speaker)).toEqual(["cosmo", "crew", "cosmo"]);
    // the first turn reads the day's (simulated) sensor feed: only sensor readings, nothing the astronaut said
    expect(snapshot.measurements.length).toBeGreaterThan(0);
    expect(snapshot.measurements.every((m) => m.source === "sensor")).toBe(true);
    expect(snapshot.measurements.map((m) => m.key).sort()).toEqual(
      ["bp_diastolic", "bp_systolic", "exercise_min", "glucose_mgdl", "heart_rate", "sleep_hours", "temperature_c", "water_ml"],
    );
  });

  it("is a 404 for another crew member's check-in, indistinguishable from a missing one", async () => {
    await signIn("bat");
    const { checkInId } = await createCheckIn();
    mocks.jar.clear();
    await signIn("saraa");
    const other = await getSnapshotRoute(new Request("http://localhost/x"), ctx({ id: checkInId }));
    const missing = await getSnapshotRoute(new Request("http://localhost/x"), ctx({ id: "does-not-exist" }));
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await other.json()).toEqual(await missing.json());
  });

  it("needs a session", async () => {
    const res = await getSnapshotRoute(new Request("http://localhost/x"), ctx({ id: "x" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/checkins/[id]/turn", () => {
  it("streams the turn as server-sent events, one flushed frame per event, in the documented order", async () => {
    await signIn("bat");
    const { checkInId } = await createCheckIn("en");
    const res = await turnRequest(checkInId, "I'm doing well, thanks");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-store");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const frames: string[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      frames.push(decoder.decode(value));
    }
    for (const frame of frames) expect(frame).toMatch(/^data: \{[\s\S]*\}\n\n$/);
    const events = parseSse(frames.join(""));
    expect(frames).toHaveLength(events.length);
    expect(events.map((e) => e.type)).toEqual(["transcript", "state", "assistant", "timing", "done"]);
    expect(events[0]).toMatchObject({ type: "transcript", text: "I'm doing well, thanks", language: "en" });
    expect(events[1]).toMatchObject({ type: "state", state: "SMALL_TALK", expectedQuestion: null });
  });

  it("walks the whole English demo over HTTP and ends with a summary the dashboard route agrees with", async () => {
    await signIn("bat");
    const { checkInId } = await createCheckIn("en");
    let summaryEvent: Extract<TurnEvent, { type: "summary" }> | undefined;
    const keys = new Set<string>();
    for (const line of DEMO_SCRIPTS.en.lines) {
      const events = await sendTurn(checkInId, line.say);
      for (const e of events) {
        if (e.type === "measurement") keys.add(e.key);
        if (e.type === "summary") summaryEvent = e;
        expect(e.type).not.toBe("error");
      }
    }
    // what Bat says: the sensor note, mood, three symptoms with the vision check, and the four wellbeing answers
    // (the sensor readings are stored from the feed, not heard)
    expect([...keys].sort()).toEqual([
      "connection", "energy", "mood", "sensor_note", "sleep_quality", "stress",
      "symptom_dizziness", "symptom_headache", "symptom_nausea", "vision_check",
    ]);
    expect(summaryEvent?.summary.overall).toBe("yellow");

    const dash = await getDashboard(new Request(`http://localhost/api/dashboard?checkInId=${checkInId}`));
    expect(dash.status).toBe(200);
    const payload = (await dash.json()) as { overall: string; summary: { audioTurnId: string | null } };
    expect(payload.overall).toBe("yellow");
    expect(payload.summary.audioTurnId).toBe(summaryEvent?.summary.audioTurnId);
  });

  it("is a 404 for another crew member's check-in and writes nothing to it", async () => {
    await signIn("bat");
    const { checkInId } = await createCheckIn("en");
    const before = await listTurns("bat", checkInId);
    mocks.jar.clear();
    await signIn("saraa");
    const res = await turnRequest(checkInId, "I slept 3 hours");
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("NOT_FOUND");
    expect(await listTurns("bat", checkInId)).toEqual(before);
    expect((await turnRequest("nope", "hello")).status).toBe(404);
  });

  it("needs a session", async () => {
    expect((await turnRequest("x", "hello")).status).toBe(401);
  });

  it("rejects bad bodies before streaming: empty text, too long, wrong fields, not JSON", async () => {
    await signIn("bat");
    const { checkInId } = await createCheckIn("en");
    const attempts: unknown[] = [{ text: "" }, { text: "   " }, { text: "x".repeat(2001) }, { text: "hi", crewId: "saraa" }, { nope: 1 }, "{broken"];
    for (const body of attempts) {
      const res = await postTurn(jsonPost(`/api/checkins/${checkInId}/turn`, body), ctx({ id: checkInId }));
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect((await errorOf(res)).code).toBe("BAD_INPUT");
    }
    expect(await listTurns("bat", checkInId)).toHaveLength(1); // only the greeting
  });

  it("a voice turn without a working speech-to-text answers 502 STT_FAILED and stores nothing", async () => {
    await signIn("bat");
    const { checkInId } = await createCheckIn("en");
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" }), "turn.webm");
    const res = await postTurn(new Request(`http://localhost/api/checkins/${checkInId}/turn`, { method: "POST", body: form }), ctx({ id: checkInId }));
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe("STT_FAILED");
    expect(await listTurns("bat", checkInId)).toHaveLength(1);

    const empty = new FormData();
    empty.append("audio", new Blob([], { type: "audio/webm" }), "turn.webm");
    const res2 = await postTurn(new Request(`http://localhost/api/checkins/${checkInId}/turn`, { method: "POST", body: empty }), ctx({ id: checkInId }));
    expect(res2.status).toBe(400);
  });

  // team decision 2026-11-14: one language for the whole check-in (a Mongolian check-in stays Mongolian)
  it("keeps the check-in's language even when the astronaut answers in the other language", async () => {
    await signIn("bat");
    const mn = await createCheckIn("mn");
    const fromEnglish = await sendTurn(mn.checkInId, "I'm fine, thank you, a bit tired today");
    expect(fromEnglish.find((e) => e.type === "assistant")).toMatchObject({ language: "mn" });
    const fromDigits = await sendTurn(mn.checkInId, "98");
    expect(fromDigits.find((e) => e.type === "assistant")).toMatchObject({ language: "mn" });
  });
});

describe("GET /api/checkins/[id]/turns/[turnId]/audio", () => {
  it("falls back to a JSON TTS_FAILED error when there is no clip and no speech service", async () => {
    await signIn("bat");
    const created = await createCheckIn("en");
    const res = await getAudio(new Request("http://localhost/x"), ctx({ id: created.checkInId, turnId: created.greeting.turnId }));
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await errorOf(res)).code).toBe("TTS_FAILED");
  });

  it("serves a pre-generated demo clip named by language and a hash of the text", async () => {
    await signIn("bat");
    const created = await createCheckIn("en");
    const dir = path.join(process.cwd(), "public", "demo", "audio");
    const file = path.join(dir, demoAudioFileName(created.greeting.text, "en"));
    expect(path.basename(file)).toMatch(/^en-[0-9a-f]{12}\.mp3$/);
    const existed = fs.existsSync(file);
    fs.mkdirSync(dir, { recursive: true });
    const bytes = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 1, 2, 3]);
    if (!existed) fs.writeFileSync(file, bytes);
    try {
      const res = await getAudio(new Request("http://localhost/x"), ctx({ id: created.checkInId, turnId: created.greeting.turnId }));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("audio/mpeg");
      if (!existed) expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
    } finally {
      if (!existed) fs.rmSync(file, { force: true });
    }
  });

  it("the file name depends on language and exact text, with whitespace collapsed", () => {
    expect(demoAudioFileName("Hello  there ", "en")).toBe(demoAudioFileName("Hello there", "en"));
    expect(demoAudioFileName("Hello there", "en")).not.toBe(demoAudioFileName("Hello there", "mn"));
    expect(demoAudioFileName("Hello there", "en")).not.toBe(demoAudioFileName("Hello there!", "en"));
  });

  it("only Cosmo's own turns can be voiced, and another member's check-in is a 404", async () => {
    await signIn("bat");
    const created = await createCheckIn("en");
    const events = await sendTurn(created.checkInId, "hello");
    const crewTurnId = (events[0] as Extract<TurnEvent, { type: "transcript" }>).turnId;
    const crewTurn = await getAudio(new Request("http://localhost/x"), ctx({ id: created.checkInId, turnId: crewTurnId }));
    expect(crewTurn.status).toBe(404);

    mocks.jar.clear();
    await signIn("saraa");
    const other = await getAudio(new Request("http://localhost/x"), ctx({ id: created.checkInId, turnId: created.greeting.turnId }));
    expect(other.status).toBe(404);
  });

  it("needs a session", async () => {
    const res = await getAudio(new Request("http://localhost/x"), ctx({ id: "x", turnId: "y" }));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/demo/script", () => {
  it("returns the demo script of the requested language", async () => {
    for (const lang of ["en", "mn"] as const) {
      const res = await getDemoScript(new Request(`http://localhost/api/demo/script?lang=${lang}`));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { language: string; lines: Array<{ say: string }>; values: Record<string, number> };
      expect(body.language).toBe(lang);
      expect(body.lines).toEqual(DEMO_SCRIPTS[lang].lines);
      // the scripted demo day's sensor sleep, and the energy Bat changes at the read-back
      expect(body.values.sleep_hours).toBe(7.5);
      expect(body.values.energy).toBe(2);
    }
  });

  it("rejects a missing or unknown language", async () => {
    for (const url of ["http://localhost/api/demo/script", "http://localhost/api/demo/script?lang=fr"]) {
      const res = await getDemoScript(new Request(url));
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe("BAD_INPUT");
    }
  });
});
