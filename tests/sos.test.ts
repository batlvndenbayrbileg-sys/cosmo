import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ jar: new Map<string, string>(), failRaise: false }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name) as string } : undefined),
    set: (opts: { name: string; value: string }) => void mocks.jar.set(opts.name, opts.value),
    delete: (name: string) => void mocks.jar.delete(name),
  }),
}));

// lets one test make storing the alert fail (the database is down) without touching the schema
vi.mock("@/server/db/repos/sos", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/db/repos/sos")>();
  return {
    ...mod,
    raiseSosAlert: (...args: Parameters<typeof mod.raiseSosAlert>) =>
      mocks.failRaise ? Promise.reject(new Error("database is down")) : mod.raiseSosAlert(...args),
  };
});

import { POST as postSos } from "@/app/api/sos/route";
import { POST as postSosPhoto } from "@/app/api/sos/[id]/photo/route";
import { GET as getGroundSos } from "@/app/api/ground/sos/route";
import { GET as getGroundSosPhoto } from "@/app/api/ground/sos/[id]/photo/route";
import { POST as postGroundSosSeen } from "@/app/api/ground/sos/[id]/seen/route";
import { parseTurnEvent } from "@/components/checkin/sse";
import { encodeUnder, fitWithin } from "@/components/sos/camera";
import { getSosState, noteSosFromTurn, sendSosToEarth, setSosEnvForTests, type SosEnv } from "@/components/sos/store";
import { sirenSchedule } from "@/components/earth/siren";
import {
  SOS_DEDUP_WINDOW_MS,
  SOS_PHOTO_MAX_BYTES,
  SOS_SPOKEN,
  matchSosRequest,
  type GroundSosAlert,
  type SosAlert,
  type SosRaiseResult,
} from "@/lib/sos";
import type { ApiError } from "@/lib/types";
import { setClockForTests } from "@/server/clock";
import { setGroundCookie } from "@/server/dashboard/roles";
import { getDb } from "@/server/db/client";
import { groundGetSosPhoto, groundListSosAlerts } from "@/server/db/repos/ground";
import { listAlerts } from "@/server/db/repos/alert";
import { listTurns } from "@/server/db/repos/turn";
import {
  attachSosPhoto,
  getSosAlert,
  groundMarkSosSeen,
  listSosAlerts,
  markSosPhotoMissing,
  raiseSosAlert,
} from "@/server/db/repos/sos";
import { setSessionCookie } from "@/server/session";
import { assistantText, ctxOf, eventsOf, playTurn, startCheckIn } from "./helpers/agent";
import { freshSeededDb, TEST_TODAY } from "./helpers/db";

const NOW = TEST_TODAY;
const url = (p: string) => `http://localhost${p}`;

/** a small fake JPEG (FF D8 FF ...) of `size` bytes */
function jpeg(size = 2_000): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < size; i++) b[i] = i % 251;
  return b;
}

const signInCrew = (crewId: string) => setSessionCookie({ role: "crew", crewId });

async function errorOf(res: Response): Promise<ApiError["error"]> {
  return ((await res.json()) as ApiError).error;
}

const sosPost = (body: unknown) =>
  postSos(new Request(url("/api/sos"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const photoPost = (id: string, init: RequestInit) =>
  postSosPhoto(new Request(url(`/api/sos/${id}/photo`), { method: "POST", ...init }), { params: Promise.resolve({ id }) });
const groundPhoto = (id: string, qs = "") =>
  getGroundSosPhoto(new Request(url(`/api/ground/sos/${id}/photo${qs}`)), { params: Promise.resolve({ id }) });
const groundSeen = (id: string) =>
  postGroundSosSeen(new Request(url(`/api/ground/sos/${id}/seen`), { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(async () => {
  await freshSeededDb();
  mocks.jar.clear();
  mocks.failRaise = false;
  setClockForTests(NOW);
});
afterEach(() => {
  setClockForTests(null);
  setSosEnvForTests(null);
});

/* ───────────── the words ───────────── */

describe("matchSosRequest: what counts as asking to alert Earth", () => {
  it.each([
    "Cosmo, tell Earth",
    "please call Earth now",
    "notify ground control",
    "contact mission control",
    "let Earth know",
    "send an SOS to Earth",
    "send an emergency signal",
    "SOS",
    "S.O.S.!",
    "mayday mayday",
    "can you tell Earth I hit my head",
    // the "not" / "don't" belongs to another clause (or is not about the request): still a request
    "I'm not okay, call Earth",
    "I don't feel well, tell Earth",
    "I don't feel well tell earth",
    "it won't stop bleeding call earth",
    "oh no call Earth",
    "Hey Cosmo, could you please notify ground control?",
  ])("en yes: %s", (text) => {
    expect(matchSosRequest(text)).not.toBeNull();
  });

  it.each([
    "дэлхий рүү хэл",
    "Дэлхий рүү мэдэгд",
    "дэлхийд мэдэгдээрэй",
    "газар руу дохио өг",
    "газрын удирдлагад мэдэгдээрэй",
    "дэлхийтэй холбогдоорой",
    "дэлхий рүү яаралтай мэдэгдэл илгээ",
    "надад туслаач, дэлхийд хэлнэ үү",
    "яаралтай дохио өг",
    "мэдэгдээрэй дэлхийд",
    "дэлхийд толгой өвдөж байна гэж хэлээрэй",
    "дэлхийд мэдэгдэж өгөөрэй",
    "Дэлхий рүү мэдэгдэж өгнө үү",
    "битгий сандар, дэлхий рүү мэдэгд",
  ])("mn yes: %s", (text) => {
    const hit = matchSosRequest(text);
    expect(hit, text).not.toBeNull();
    expect(hit!.lang).toBe("mn");
  });

  it.each([
    "don't tell Earth",
    "do not call ground control",
    "did you tell Earth?",
    "how do I call Earth?",
    "tell Earth I'm fine",
    "what does the SOS button do",
    "I slept seven hours",
    "the earth is round",
    "I've sent an urgent alert to Earth", // Cosmo's own line, if it is ever heard back
    // general questions Cosmo should answer, not alerts
    "Is it possible to contact Earth from the station?",
    "How long does it take to message Earth from here?",
    "Can astronauts call Earth whenever they want?",
    "What happens if I call Earth?",
    "you don't need to call Earth",
    "I'd rather not tell Earth",
    "I wanted to call Houston yesterday",
  ])("en no: %s", (text) => {
    expect(matchSosRequest(text)).toBeNull();
  });

  it.each([
    "битгий дэлхийд хэл",
    "дэлхийд хэлэх хэрэггүй",
    "дэлхийд мэдэгдсэн үү",
    "Дэлхий рүү яаралтай мэдэгдэл илгээлээ", // Cosmo's own line
    "дэлхийд сайн байна гэж хэлээрэй",
    "дэлхийн хэлүүд",
    "дэлхийтэй холбоотой асуулт байна",
    "дэлхийд хэлбэл яах вэ",
    "өнөөдөр 7 цаг унтсан",
    // general questions and facts about the world ("дэлхий"), not alerts
    "Дэлхий рүү яаж холбогдох вэ?",
    "Дэлхийд хамгийн их ярьдаг хэл юу вэ?",
    "Англи хэл дэлхийд хамгийн их тархсан хэл",
    "Сансрын нисэгчид дэлхийтэй холбогддог уу?",
    "Бид өдөр бүр дэлхийтэй холбогддог",
    "дэлхийтэй холбогдож байна",
    "дэлхийд хэлэх үү?",
  ])("mn no: %s", (text) => {
    expect(matchSosRequest(text)).toBeNull();
  });

  it("returns only the trigger words, not the rest of the utterance", () => {
    expect(matchSosRequest("my chest hurts a lot, tell Earth please")!.phrase).toBe("tell earth");
    expect(matchSosRequest("толгой эргээд байна, дэлхий рүү мэдэгд")!.phrase).toBe("дэлхий рүү мэдэгд");
  });
});

/* ───────────── storage ───────────── */

describe("raiseSosAlert (storage, crew isolation, idempotency)", () => {
  it("stores an alert without a photo, then attaches one", async () => {
    const { alert, duplicate } = await raiseSosAlert("bat", { reason: "button" });
    expect(duplicate).toBe(false);
    expect(alert).toMatchObject({ crewId: "bat", reason: "button", phrase: null, photoStatus: "pending", seenAt: null });
    expect(alert.createdAt).toBe(NOW.toISOString());

    const withPhoto = await attachSosPhoto("bat", alert.id, jpeg(3_000));
    expect(withPhoto).toMatchObject({ photoStatus: "attached", photoBytes: 3_000 });
    const bytes = await groundGetSosPhoto(alert.id, NOW.toISOString());
    expect(bytes && Array.from(bytes.slice(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(bytes!.byteLength).toBe(3_000);
    // a second photo does not replace the first
    await attachSosPhoto("bat", alert.id, jpeg(100));
    expect((await getSosAlert("bat", alert.id)).photoBytes).toBe(3_000);
  });

  it("records a refused or missing camera, and the alert stands without a photo", async () => {
    const { alert } = await raiseSosAlert("bat", { reason: "voice", phrase: "tell earth" });
    expect((await markSosPhotoMissing("bat", alert.id, "denied")).photoStatus).toBe("denied");
    expect(await groundGetSosPhoto(alert.id, NOW.toISOString())).toBeNull();
    const [row] = await groundListSosAlerts(NOW.toISOString());
    expect(row).toMatchObject({ id: alert.id, photoStatus: "denied", phrase: "tell earth", crewName: expect.any(String) });
  });

  it("one alert per incident: a second SOS within 30 s returns the first one", async () => {
    const first = await raiseSosAlert("bat", { reason: "button" });
    setClockForTests(NOW.getTime() + SOS_DEDUP_WINDOW_MS - 1_000);
    const again = await raiseSosAlert("bat", { reason: "voice", phrase: "tell earth" });
    expect(again).toEqual({ alert: first.alert, duplicate: true });
    // presses at the same moment also give one alert
    const burst = await Promise.all([1, 2, 3].map(() => raiseSosAlert("bat", { reason: "button" })));
    expect(new Set(burst.map((r) => r.alert.id))).toEqual(new Set([first.alert.id]));
    expect(await listSosAlerts("bat")).toHaveLength(1);

    setClockForTests(NOW.getTime() + SOS_DEDUP_WINDOW_MS + 1_000);
    const later = await raiseSosAlert("bat", { reason: "button" });
    expect(later.duplicate).toBe(false);
    expect(later.alert.id).not.toBe(first.alert.id);
    expect(await listSosAlerts("bat")).toHaveLength(2);
  });

  it("another crew member's SOS is a separate incident", async () => {
    const a = await raiseSosAlert("bat", { reason: "button" });
    const b = await raiseSosAlert("mira", { reason: "button" });
    expect(b.duplicate).toBe(false);
    expect(b.alert.id).not.toBe(a.alert.id);
  });

  it("crew isolation: nobody reads, photographs or labels another member's alert", async () => {
    const { alert } = await raiseSosAlert("bat", { reason: "button" });
    await expect(getSosAlert("mira", alert.id)).rejects.toMatchObject({ status: 404 });
    await expect(attachSosPhoto("mira", alert.id, jpeg())).rejects.toMatchObject({ status: 404 });
    await expect(markSosPhotoMissing("mira", alert.id, "denied")).rejects.toMatchObject({ status: 404 });
    expect(await listSosAlerts("mira")).toEqual([]);
    expect((await getSosAlert("bat", alert.id)).photoStatus).toBe("pending");
  });

  it("a check-in of another crew member is not linked (and does not stop the SOS)", async () => {
    const miraCheckIn = await startCheckIn("mira");
    const { alert } = await raiseSosAlert("bat", { reason: "button", checkInId: miraCheckIn });
    const db = await getDb();
    const row = await db.get<{ check_in_id: string | null }>("SELECT check_in_id FROM sos_alert WHERE id = ?", alert.id);
    expect(row!.check_in_id).toBeNull();
  });

  it("refuses photos that are too large, empty or not JPEG", async () => {
    const { alert } = await raiseSosAlert("bat", { reason: "button" });
    await expect(attachSosPhoto("bat", alert.id, jpeg(SOS_PHOTO_MAX_BYTES + 1))).rejects.toMatchObject({ status: 413 });
    await expect(attachSosPhoto("bat", alert.id, new Uint8Array(0))).rejects.toMatchObject({ status: 400 });
    await expect(attachSosPhoto("bat", alert.id, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).rejects.toMatchObject({ status: 400 });
    expect((await attachSosPhoto("bat", alert.id, jpeg(SOS_PHOTO_MAX_BYTES))).photoStatus).toBe("attached");
  });

  it("ground sees an SOS after the simulated delay, newest first, and can mark it seen once", async () => {
    const a = await raiseSosAlert("bat", { reason: "button" });
    setClockForTests(NOW.getTime() + 60_000);
    const b = await raiseSosAlert("mira", { reason: "button" });
    const live = await groundListSosAlerts(new Date(NOW.getTime() + 60_000).toISOString());
    expect(live.map((x) => x.id)).toEqual([b.alert.id, a.alert.id]);
    // 3 minutes behind: neither has arrived
    expect(await groundListSosAlerts(new Date(NOW.getTime() + 60_000 - 180_000).toISOString())).toEqual([]);
    expect((await groundListSosAlerts(new Date(NOW.getTime() + 60_000).toISOString(), { crewId: "bat" })).map((x) => x.id)).toEqual([
      a.alert.id,
    ]);

    const seen = await groundMarkSosSeen(a.alert.id, new Date(NOW.getTime() + 90_000));
    expect(seen.seenAt).toBe(new Date(NOW.getTime() + 90_000).toISOString());
    expect((await groundMarkSosSeen(a.alert.id, new Date(NOW.getTime() + 999_000))).seenAt).toBe(seen.seenAt);
    await expect(groundMarkSosSeen("nope")).rejects.toMatchObject({ status: 404 });
  });
});

/* ───────────── routes ───────────── */

describe("SOS routes: auth and behaviour", () => {
  it("POST /api/sos: 401 without a session, 403 for ground, 200 for crew", async () => {
    expect((await sosPost({})).status).toBe(401);
    await setGroundCookie();
    const ground = await sosPost({});
    expect(ground.status).toBe(403);
    mocks.jar.clear();
    await signInCrew("bat");
    const res = await sosPost({ reason: "button", language: "en" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SosRaiseResult;
    expect(body.duplicate).toBe(false);
    expect(body.alert.crewId).toBe("bat");
    expect(body.spoken).toEqual({ text: SOS_SPOKEN.sent.en, language: "en", turnId: null });
    // pressed again within 30 s: the same alert, Cosmo says it was already sent
    const again = (await (await sosPost({})).json()) as SosRaiseResult;
    expect(again.alert.id).toBe(body.alert.id);
    expect(again.duplicate).toBe(true);
    expect(again.spoken.text).toBe(SOS_SPOKEN.duplicate[again.spoken.language]);
  });

  it("POST /api/sos inside a check-in: Cosmo's line is a stored turn (it gets a voice), in the check-in's language", async () => {
    await signInCrew("bat");
    const checkInId = await startCheckIn("bat", "mn");
    const body = (await (await sosPost({ checkInId, language: "en" })).json()) as SosRaiseResult;
    expect(body.spoken.language).toBe("mn");
    expect(body.spoken.text).toBe(SOS_SPOKEN.sent.mn);
    expect(body.spoken.text.startsWith("Дэлхий рүү яаралтай мэдэгдэл илгээлээ")).toBe(true);
    const turns = await listTurns("bat", checkInId);
    expect(turns.find((t) => t.id === body.spoken.turnId)).toMatchObject({ speaker: "cosmo", text: body.spoken.text });
  });

  it("POST /api/sos refuses unknown fields and reasons", async () => {
    await signInCrew("bat");
    expect((await sosPost({ reason: "voice" })).status).toBe(400);
    expect((await sosPost({ crewId: "mira" })).status).toBe(400);
  });

  it("POST /api/sos/[id]/photo: own alert only, JPEG only, size limit, missing camera", async () => {
    await signInCrew("bat");
    const { alert } = (await (await sosPost({})).json()) as SosRaiseResult;

    expect((await photoPost(alert.id, { headers: { "content-type": "image/jpeg" }, body: jpeg(SOS_PHOTO_MAX_BYTES + 10) })).status).toBe(413);
    expect((await photoPost(alert.id, { headers: { "content-type": "image/jpeg" }, body: new Uint8Array([1, 2, 3, 4]) })).status).toBe(400);
    expect((await photoPost(alert.id, { headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);

    // another crew member: 404, nothing changes
    mocks.jar.clear();
    await signInCrew("mira");
    const foreign = await photoPost(alert.id, { headers: { "content-type": "image/jpeg" }, body: jpeg() });
    expect(foreign.status).toBe(404);
    expect((await errorOf(foreign)).code).toBe("NOT_FOUND");
    // ground may not upload either
    mocks.jar.clear();
    await setGroundCookie();
    expect((await photoPost(alert.id, { headers: { "content-type": "image/jpeg" }, body: jpeg() })).status).toBe(403);
    mocks.jar.clear();
    expect((await photoPost(alert.id, { headers: { "content-type": "image/jpeg" }, body: jpeg() })).status).toBe(401);

    await signInCrew("bat");
    const ok = await photoPost(alert.id, { headers: { "content-type": "image/jpeg" }, body: jpeg(4_000) });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as SosAlert).photoStatus).toBe("attached");

    const second = (await raiseSosAlert("mira", { reason: "button" })).alert;
    mocks.jar.clear();
    await signInCrew("mira");
    const missing = await photoPost(second.id, { headers: { "content-type": "application/json" }, body: JSON.stringify({ missing: "unavailable" }) });
    expect(((await missing.json()) as SosAlert).photoStatus).toBe("unavailable");
  });

  it("ground routes: list, photo and seen are ground only (401 / 403), and the photo is served uncached", async () => {
    const { alert } = await raiseSosAlert("bat", { reason: "voice", phrase: "tell earth" });
    await attachSosPhoto("bat", alert.id, jpeg(5_000));

    const list = () => getGroundSos(new Request(url("/api/ground/sos")));
    for (const call of [list, () => groundPhoto(alert.id), () => groundSeen(alert.id)]) {
      mocks.jar.clear();
      expect((await call()).status).toBe(401);
      await signInCrew("bat");
      expect((await call()).status).toBe(403);
    }

    mocks.jar.clear();
    await setGroundCookie();
    const rows = (await (await list()).json()) as GroundSosAlert[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: alert.id, crewId: "bat", reason: "voice", photoStatus: "attached" });
    expect(JSON.stringify(rows)).not.toContain("photo_jpeg");

    const photo = await groundPhoto(alert.id);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    expect(photo.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await photo.arrayBuffer()).byteLength).toBe(5_000);
    // not arrived yet at a 3-minute delay
    expect((await groundPhoto(alert.id, "?delayMs=180000")).status).toBe(404);
    expect((await getGroundSos(new Request(url("/api/ground/sos?delayMs=180000")))).status).toBe(200);
    expect((await getGroundSos(new Request(url("/api/ground/sos?crewId=../x")))).status).toBe(400);

    const seen = await groundSeen(alert.id);
    expect(seen.status).toBe(200);
    expect(((await seen.json()) as SosAlert).seenAt).toBe(NOW.toISOString());
  });
});

/* ───────────── a conversation turn ───────────── */

describe("SOS by voice, in a conversation turn", () => {
  it("'tell Earth' mid check-in raises one alert, Cosmo confirms only after it is stored, the check-in stays where it was", async () => {
    const checkInId = await startCheckIn("bat", "en");
    const before = await ctxOf("bat", checkInId);
    const events = await playTurn("bat", checkInId, "Cosmo, please tell Earth, I hit my head");
    expect(events.map((e) => e.type)).toEqual(["transcript", "sos", "assistant", "timing", "done"]);
    const [sos] = eventsOf(events, "sos");
    expect(sos).toMatchObject({ ok: true, duplicate: false, photoStatus: "pending" });
    expect(assistantText(events)).toBe(SOS_SPOKEN.sent.en);

    const stored = await listSosAlerts("bat");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: sos.alertId, reason: "voice", phrase: "tell earth" });
    const after = await ctxOf("bat", checkInId);
    expect(after.state).toBe(before.state);

    // said again: no second alert
    const again = await playTurn("bat", checkInId, "tell Earth");
    expect(eventsOf(again, "sos")[0]).toMatchObject({ ok: true, duplicate: true, alertId: sos.alertId });
    expect(assistantText(again)).toBe(SOS_SPOKEN.duplicate.en);
    expect(await listSosAlerts("bat")).toHaveLength(1);
  });

  it("Mongolian: 'дэлхий рүү мэдэгдээрэй' gives the Mongolian confirmation", async () => {
    const checkInId = await startCheckIn("bat", "mn");
    const events = await playTurn("bat", checkInId, "Дэлхий рүү мэдэгдээрэй", { kind: "voice", languageHint: "mn" });
    expect(eventsOf(events, "sos")[0].ok).toBe(true);
    expect(assistantText(events).startsWith("Дэлхий рүү яаралтай мэдэгдэл илгээлээ")).toBe(true);
    expect((await listSosAlerts("bat"))[0].phrase).toBe("дэлхий рүү мэдэгдээрэй");
  });

  it("when the alert cannot be stored, Cosmo says so and points to the station's comms", async () => {
    const checkInId = await startCheckIn("bat", "en");
    mocks.failRaise = true;
    const events = await playTurn("bat", checkInId, "call Earth");
    expect(eventsOf(events, "sos")[0]).toMatchObject({ ok: false, alertId: null });
    expect(assistantText(events)).toBe(SOS_SPOKEN.failed.en);
    expect(assistantText(events)).not.toMatch(/I've sent/);
  });

  it("crisis words next to 'tell Earth' also raise the crisis alert and keep the crisis reply", async () => {
    const checkInId = await startCheckIn("bat", "en");
    const events = await playTurn("bat", checkInId, "I want to die, tell Earth");
    expect(eventsOf(events, "sos")[0].ok).toBe(true);
    expect(assistantText(events).startsWith(SOS_SPOKEN.sent.en)).toBe(true);
    expect(assistantText(events).length).toBeGreaterThan(SOS_SPOKEN.sent.en.length);
    expect((await listAlerts("bat")).some((a) => a.id === `al-${checkInId}-companion-self`)).toBe(true);
  });

  it("never without the words: ordinary answers and 'don't tell Earth' raise nothing", async () => {
    const checkInId = await startCheckIn("bat", "en");
    for (const text of ["I slept seven hours", "don't tell Earth about this", "How long does it take to message Earth from here?"]) {
      const events = await playTurn("bat", checkInId, text);
      expect(eventsOf(events, "sos")).toEqual([]);
    }
    expect(await listSosAlerts("bat")).toEqual([]);
  });

  it("the browser accepts the sos event (and drops a malformed one)", () => {
    const good = parseTurnEvent({
      event: "message",
      id: null,
      data: JSON.stringify({ type: "sos", ok: true, alertId: "a1", createdAt: NOW.toISOString(), duplicate: false, photoStatus: "pending" }),
    });
    expect(good).toEqual({ type: "sos", ok: true, alertId: "a1", createdAt: NOW.toISOString(), duplicate: false, photoStatus: "pending" });
    expect(parseTurnEvent({ event: "message", id: null, data: JSON.stringify({ type: "sos" }) })).toBeNull();
  });
});

/* ───────────── the browser side ───────────── */

function fakeEnv(opts: { raise?: () => Response; capture?: SosEnv["capture"] } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const spoken: Array<{ text: string; audioUrl: string | null; at: number }> = [];
  const result: SosRaiseResult = {
    alert: {
      id: "sos-1",
      crewId: "bat",
      createdAt: NOW.toISOString(),
      reason: "button",
      phrase: null,
      photoStatus: "pending",
      photoBytes: null,
      photoAt: null,
      seenAt: null,
    },
    duplicate: false,
    spoken: { text: SOS_SPOKEN.sent.en, language: "en", turnId: "t-9" },
  };
  const env: SosEnv = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      calls.push({ url: u, init });
      if (u === "/api/sos") return opts.raise ? opts.raise() : Response.json(result);
      return Response.json({ ...result.alert, photoStatus: "attached" });
    }) as typeof fetch,
    capture: opts.capture ?? (async () => ({ ok: true, blob: new Blob([jpeg(1_000) as BlobPart], { type: "image/jpeg" }) })),
    speak: (text, _lang, audioUrl) => spoken.push({ text, audioUrl, at: calls.length }),
    objectUrl: () => "blob:still",
  };
  return { env, calls, spoken };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("the SOS card's store (button path)", () => {
  it("speaks only after the server stored the alert, then takes and attaches one photo", async () => {
    const f = fakeEnv();
    setSosEnvForTests(f.env);
    await sendSosToEarth({ checkInId: "c1", lang: "en" });
    expect(f.calls[0].url).toBe("/api/sos");
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ reason: "button", checkInId: "c1", language: "en" });
    // spoken after the POST answered, with the stored turn's voice
    expect(f.spoken).toEqual([{ text: SOS_SPOKEN.sent.en, audioUrl: "/api/checkins/c1/turns/t-9/audio", at: 1 }]);
    await settle();
    const photo = f.calls.find((c) => c.url === "/api/sos/sos-1/photo");
    expect(photo?.init?.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(getSosState()).toMatchObject({ phase: "sent", alertId: "sos-1", photo: "attached", photoUrl: "blob:still" });
  });

  it("a failed request says so (station comms) and takes no photo", async () => {
    const capture = vi.fn(async () => ({ ok: false as const, reason: "denied" as const }));
    const f = fakeEnv({ raise: () => Response.json({ error: { code: "INTERNAL", message: "x" } }, { status: 500 }), capture });
    setSosEnvForTests(f.env);
    await sendSosToEarth({ checkInId: null, lang: "mn" });
    expect(f.spoken).toEqual([{ text: SOS_SPOKEN.failed.mn, audioUrl: null, at: 1 }]);
    expect(getSosState()).toMatchObject({ phase: "failed" });
    expect(capture).not.toHaveBeenCalled();
  });

  it("a refused camera is reported to the alert, which stands without a photo", async () => {
    const f = fakeEnv({ capture: async () => ({ ok: false, reason: "denied" }) });
    setSosEnvForTests(f.env);
    await sendSosToEarth({ checkInId: null, lang: "en" });
    await settle();
    const report = f.calls.find((c) => c.url === "/api/sos/sos-1/photo");
    expect(JSON.parse(String(report?.init?.body))).toEqual({ missing: "denied" });
    expect(getSosState()).toMatchObject({ phase: "sent", photo: "denied" });
  });

  it("one photo per alert: the voice event for the same alert does not open the camera again", async () => {
    const capture = vi.fn(async () => ({ ok: true as const, blob: new Blob([jpeg(500) as BlobPart]) }));
    const f = fakeEnv({ capture });
    setSosEnvForTests(f.env);
    await sendSosToEarth({ checkInId: null, lang: "en" });
    noteSosFromTurn({ type: "sos", ok: true, alertId: "sos-1", createdAt: NOW.toISOString(), duplicate: true, photoStatus: "pending" }, "en", null);
    await settle();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("the still is made small enough: falling quality, then smaller sizes", async () => {
    expect(fitWithin(1280, 720, 640)).toEqual({ width: 640, height: 360 });
    expect(fitWithin(320, 240, 640)).toEqual({ width: 320, height: 240 });
    const tried: Array<[number, number]> = [];
    const blob = await encodeUnder(async (q, s) => {
      tried.push([q, s]);
      return new Blob([new Uint8Array(s === 1 ? 200_000 : q > 0.5 ? 160_000 : 90_000)]);
    });
    expect(blob!.size).toBe(90_000);
    expect(tried).toEqual([
      [0.7, 1],
      [0.55, 1],
      [0.4, 1],
      [0.7, 0.75],
      [0.55, 0.75],
      [0.4, 0.75],
    ]);
    expect(await encodeUnder(async () => new Blob([new Uint8Array(SOS_PHOTO_MAX_BYTES + 1)]))).toBeNull();
  });

  it("the Earth alarm alternates two tones", () => {
    const s = sirenSchedule(1, 0.25);
    expect(s).toEqual([
      [0, 960],
      [0.25, 640],
      [0.5, 960],
      [0.75, 640],
    ]);
  });
});
