import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ jar: new Map<string, string>(), failRaise: false }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name) as string } : undefined),
    set: (opts: { name: string; value: string }) => void mocks.jar.set(opts.name, opts.value),
    delete: (name: string) => void mocks.jar.delete(name),
  }),
}));

// lets one test make storing the urgent alert fail (the database is down for that write)
vi.mock("@/server/db/repos/sos", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/db/repos/sos")>();
  return {
    ...mod,
    raiseSosAlert: (...args: Parameters<typeof mod.raiseSosAlert>) =>
      mocks.failRaise ? Promise.reject(new Error("database is down")) : mod.raiseSosAlert(...args),
  };
});

import { GET as getGroundPain } from "@/app/api/ground/pain/route";
import { parseTurnEvent } from "@/components/checkin/sse";
import { dismissPain, getPainState, notePainFromTurn, resetPainStoreForTests } from "@/components/pain/store";
import { relatedItems, type GroundPainReport } from "@/lib/pain";
import type { KpiKey, TurnEvent } from "@/lib/types";
import { namesConditionOrDrug } from "@/server/agent/companion";
import { setClockForTests } from "@/server/clock";
import { setGroundCookie } from "@/server/dashboard/roles";
import { groundListPainReports } from "@/server/db/repos/ground";
import { upsertMeasurement } from "@/server/db/repos/measurement";
import { createPainReport, getPainReport, listPainReports, updatePainReport } from "@/server/db/repos/pain";
import { listSosAlerts } from "@/server/db/repos/sos";
import { NotFoundError } from "@/server/http";
import { assistantText, ctxOf, eventsOf, playTurn, startCheckIn } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

const NOW = TEST_TODAY;

beforeEach(async () => {
  await freshSeededDb();
  mocks.jar.clear();
  mocks.failRaise = false;
  setClockForTests(NOW);
  resetPainStoreForTests();
});
afterEach(() => setClockForTests(null));

/** to the sleep question (KPI_CAPTURE) */
async function atSleep(lang: "en" | "mn" = "en"): Promise<string> {
  const id = await startCheckIn("bat", lang);
  for (const line of lang === "en" ? ["Hi Cosmo", "let's start"] : ["Сайн уу", "эхэлье"]) await playTurn("bat", id, line);
  return id;
}

async function setToday(checkInId: string, values: Partial<Record<KpiKey, number>>): Promise<void> {
  for (const [key, value] of Object.entries(values) as Array<[KpiKey, number]>) {
    await upsertMeasurement("bat", checkInId, { key, value, unit: null, sourceText: String(value), confidence: 1, source: "typed" });
  }
}

const painOf = (events: TurnEvent[]) => eventsOf(events, "pain")[0];

/** the code-written lines never name a condition, a drug or a treatment, and always say it is not a diagnosis */
function cleanWording(text: string): void {
  const rest = text.replace(/not a diagnosis|онош биш/giu, "");
  expect(namesConditionOrDrug(rest)).toBe(false);
  expect(rest).not.toMatch(/diagnos|prescri|medicat|dosage|treatment|онош/iu);
}

/* ───────────── a pain mid check-in ───────────── */

describe("a pain mid check-in (English)", () => {
  it("shows the place, sends a report to Earth, asks how strong and since when, then asks the open question again", async () => {
    const id = await atSleep();
    const before = await ctxOf("bat", id);
    expect(before).toMatchObject({ state: "KPI_CAPTURE" });

    const first = await playTurn("bat", id, "my head hurts");
    expect(first.map((e) => e.type)).toEqual(["transcript", "pain", "assistant", "timing", "done"]);
    const pain = painOf(first);
    expect(pain).toMatchObject({ location: "head", urgent: false, awaiting: "details", reportSent: true, sos: null });
    expect(pain.script.map((s) => s.step)).toEqual(["ack", "data", "earth", "ask"]);
    const said = assistantText(first);
    expect(said).toBe(pain.script.map((s) => s.text).join(" "));
    expect(said).toMatch(/^I understand, your head hurts\./);
    expect(said).toMatch(/This is not a diagnosis\./);
    expect(said).toMatch(/I've sent a pain report to the Earth console\./);
    expect(said).toMatch(/How strong is it from 0 to 10, and since when\?$/);
    cleanWording(said);
    // the check-in did not move
    expect(await ctxOf("bat", id)).toEqual(before);

    const reports = await listPainReports("bat");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ location: "head", sentAt: NOW.toISOString(), awaiting: "details", urgent: false });

    // the answer to Cosmo's question updates the same report, and the sleep question comes back
    const second = await playTurn("bat", id, "about a six, since this morning");
    const update = painOf(second);
    expect(update).toMatchObject({ severity: { value: 6, word: null }, onset: { kind: "this_morning", amount: null }, awaiting: null });
    expect(update.reportId).toBe(pain.reportId);
    expect(assistantText(second)).toMatch(/^Thank you\. 6 out of 10, since this morning\./);
    expect(assistantText(second)).toMatch(/I've updated your report on the Earth console\./);
    expect(assistantText(second)).toMatch(/How many hours did you sleep/i);
    expect(eventsOf(second, "measurement")).toEqual([]);
    const stored = await getPainReport("bat", pain.reportId!);
    expect(stored).toMatchObject({ severity: { value: 6 }, onset: { kind: "this_morning" }, awaiting: null, sentAt: NOW.toISOString() });

    // and the check-in goes on: the next answer is the sleep answer
    const sleep = await playTurn("bat", id, "I slept 7 hours");
    expect(eventsOf(sleep, "measurement").map((m) => [m.key, m.value])).toEqual([["sleep_hours", 7]]);
    expect(painOf(sleep)).toBeUndefined();
  });

  it("only the very next answer is read as the reply: something else drops Cosmo's question", async () => {
    const id = await atSleep();
    await playTurn("bat", id, "my back hurts");
    const other = await playTurn("bat", id, "I slept 7 hours");
    expect(painOf(other)).toBeUndefined();
    expect(eventsOf(other, "measurement").map((m) => m.key)).toEqual(["sleep_hours"]);
    expect((await listPainReports("bat"))[0]).toMatchObject({ awaiting: null, location: "back" });
  });

  it("the symptom question's 'I have a headache' is recorded as usual (no pain detour)", async () => {
    const id = await startCheckIn("bat", "en");
    for (const line of ["Hi Cosmo", "let's start", "6.5 hours", "4"]) await playTurn("bat", id, line);
    expect((await ctxOf("bat", id)).state).toBe("KPI_CAPTURE");
    const events = await playTurn("bat", id, "yes, I have a headache");
    expect(painOf(events)).toBeUndefined();
    expect(eventsOf(events, "measurement").some((m) => m.key === "symptom_headache" && m.value === 1)).toBe(true);
  });
});

describe("a pain in Mongolian", () => {
  it("'толгой өвдөөд байна' gets the Mongolian lines and keeps the open question", async () => {
    const id = await atSleep("mn");
    const events = await playTurn("bat", id, "толгой өвдөөд байна", { kind: "voice", languageHint: "mn" });
    const pain = painOf(events);
    expect(pain).toMatchObject({ location: "head", awaiting: "details" });
    const said = assistantText(events);
    expect(said).toMatch(/^Толгой тань өвдөж байгааг ойлголоо\./u);
    expect(said).toMatch(/Энэ онош биш\./u);
    expect(said).toMatch(/Өвдөлтийн мэдээг Дэлхийн удирдлагын дэлгэц рүү илгээлээ\./u);
    expect(said).toMatch(/хэр хүчтэй вэ, хэзээнээс эхэлсэн бэ\?$/u);
    cleanWording(said);
    const next = await playTurn("bat", id, "10-аас 5, өглөөнөөс хойш", { kind: "voice", languageHint: "mn" });
    expect(painOf(next)).toMatchObject({ severity: { value: 5 }, onset: { kind: "this_morning" }, awaiting: null });
    expect(assistantText(next)).toMatch(/^Баярлалаа\. 10-аас 5, өглөөнөөс хойш\./u);
  });

  it("'цээж өвдөж байна' is urgent: the chest pain guide, the crew medical officer, the SOS", async () => {
    const id = await atSleep("mn");
    const events = await playTurn("bat", id, "цээж өвдөж байна");
    expect(events.map((e) => e.type)).toEqual(["transcript", "sos", "pain", "assistant", "timing", "done"]);
    expect(painOf(events)).toMatchObject({ location: "chest", urgent: true, guideId: "chest-pain", sos: "sent", awaiting: null });
    expect(assistantText(events)).toMatch(/Багийн эмнэлгийн офицертой яг одоо холбогдоорой\./u);
    expect(assistantText(events)).toMatch(/Дэлхий рүү яаралтай мэдэгдэл/u);
  });
});

/* ───────────── red flags ───────────── */

describe("red flags: urgent through the SOS flow", () => {
  it("chest pain: urgent alert stored first, then Cosmo says so; the guide and the medical officer", async () => {
    const id = await atSleep();
    const events = await playTurn("bat", id, "my chest hurts");
    expect(events.map((e) => e.type)).toEqual(["transcript", "sos", "pain", "assistant", "timing", "done"]);
    const sos = eventsOf(events, "sos")[0];
    expect(sos).toMatchObject({ ok: true, duplicate: false, photoStatus: "pending" });
    const pain = painOf(events);
    expect(pain).toMatchObject({ urgent: true, redFlags: ["chest"], guideId: "chest-pain", sos: "sent", reportSent: true, awaiting: null });
    expect(pain.script.map((s) => s.step)).toEqual(["ack", "data", "guide", "earth", "resume"]);
    const said = assistantText(events);
    expect(said).toMatch(/I'm opening the chest pain guide\. Please contact the crew medical officer now\./);
    expect(said).toMatch(/I've sent an urgent alert to Earth with this report\./);
    cleanWording(said);
    const alerts = await listSosAlerts("bat");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ id: sos.alertId, reason: "voice", phrase: "my chest hurts" });
    expect((await listPainReports("bat"))[0]).toMatchObject({ urgent: true, sosAlertId: sos.alertId, guideId: "chest-pain" });
  });

  it("severe pain (9 out of 10) and pain with breathing trouble are urgent", async () => {
    const id = await atSleep();
    const severe = painOf(await playTurn("bat", id, "my back hurts, 9 out of 10"));
    expect(severe).toMatchObject({ urgent: true, redFlags: ["severe"], guideId: "call-for-help", sos: "sent" });
    const breathing = painOf(await playTurn("bat", id, "my stomach hurts and I can't breathe"));
    expect(breathing).toMatchObject({ urgent: true, redFlags: ["breathing"], sos: "duplicate" });
    expect(await listSosAlerts("bat")).toHaveLength(1);
  });

  it("a value today past a danger threshold makes any pain urgent", async () => {
    const id = await atSleep();
    await setToday(id, { heart_rate: 150 });
    const pain = painOf(await playTurn("bat", id, "my leg hurts a little"));
    expect(pain).toMatchObject({ urgent: true, redFlags: ["danger_vital"], sos: "sent" });
  });

  it("an answer of 8 or more turns a reported pain into an urgent one", async () => {
    const id = await atSleep();
    await playTurn("bat", id, "my arm hurts");
    const answer = await playTurn("bat", id, "9, it just started");
    expect(eventsOf(answer, "sos")[0]).toMatchObject({ ok: true });
    expect(painOf(answer)).toMatchObject({ urgent: true, redFlags: ["severe"], sos: "sent", severity: { value: 9 } });
    expect(assistantText(answer)).toMatch(/Please contact the crew medical officer now\./);
  });

  it("when the urgent alert cannot be stored, Cosmo never says it was sent", async () => {
    const id = await atSleep();
    mocks.failRaise = true;
    const events = await playTurn("bat", id, "my chest hurts");
    expect(eventsOf(events, "sos")[0]).toMatchObject({ ok: false, alertId: null });
    expect(painOf(events).sos).toBe("failed");
    expect(assistantText(events)).toMatch(/I couldn't send the alert to Earth\. Please use the station's own comms right now\./);
    expect(assistantText(events)).not.toMatch(/I've sent/);
  });
});

/* ───────────── where? ───────────── */

describe("no place said: the body map asks where", () => {
  it("'it hurts' asks where (nothing goes to Earth yet), then 'my stomach' completes and sends the report", async () => {
    const id = await atSleep();
    const first = await playTurn("bat", id, "it hurts");
    const pain = painOf(first);
    expect(pain).toMatchObject({ location: null, awaiting: "location", reportSent: false, items: [] });
    expect(assistantText(first)).toMatch(/Where does it hurt\? Tap the place on the body, or tell me\.$/);
    expect(await groundListPainReports(NOW.toISOString())).toEqual([]);

    const second = await playTurn("bat", id, "my stomach");
    expect(painOf(second)).toMatchObject({ location: "abdomen", awaiting: "details", reportSent: true, reportId: pain.reportId });
    const ground = await groundListPainReports(NOW.toISOString());
    expect(ground).toHaveLength(1);
    expect(ground[0]).toMatchObject({ crewName: expect.any(String), location: "abdomen" });
    expect(ground[0]).not.toHaveProperty("awaiting");
    expect(ground[0]).not.toHaveProperty("askedTurnId");
  });

  it("a tapped place arrives as words ('My chest hurts') and is read the same way", async () => {
    const id = await atSleep();
    await playTurn("bat", id, "it hurts");
    const tapped = await playTurn("bat", id, "My chest hurts");
    expect(painOf(tapped)).toMatchObject({ location: "chest", urgent: true });
  });
});

/* ───────────── the data ───────────── */

describe("related data: only what is unusual, numbers from the data", () => {
  it("head pain lists today's high blood pressure (with its numbers) and not a usual heart rate", async () => {
    const id = await atSleep();
    await setToday(id, { bp_systolic: 150, bp_diastolic: 95, heart_rate: 70, temperature_c: 36.7 });
    const events = await playTurn("bat", id, "my head hurts");
    const pain = painOf(events);
    const bp = pain.items.find((i) => i.id === "bp");
    expect(bp).toMatchObject({ band: "outside_general", value: 150, direction: "high", date: null });
    expect(bp?.valueText.en).toBe("150/95 mmHg");
    expect(pain.items.some((i) => i.key === "heart_rate")).toBe(false);
    expect(pain.items.some((i) => i.key === "temperature_c")).toBe(false);
    expect(assistantText(events)).toMatch(/In your data, this may be related: blood pressure 150 over 95, higher than usual/);
  });

  it("nothing unusual: says so, still not a diagnosis", async () => {
    const items = relatedItems({ location: "tooth", today: { temperature_c: 36.7 }, history: [] });
    expect(items).toEqual([]);
    const id = await atSleep();
    await setToday(id, { temperature_c: 36.7 });
    const events = await playTurn("bat", id, "my tooth hurts");
    expect(painOf(events).items).toEqual([]);
    expect(assistantText(events)).toMatch(/Your recorded values for this area look usual\. This is not a diagnosis\./);
  });

  it("the person's own usual range: a value inside the general range but far from their usual one is listed", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, values: { heart_rate: 60 + (i % 3) } }));
    const items = relatedItems({ location: "chest", today: { heart_rate: 88 }, history });
    const hr = items.find((i) => i.key === "heart_rate");
    expect(hr).toMatchObject({ band: "outside_personal", value: 88, direction: "high" });
    expect(hr?.personal?.high).toBeLessThan(88);
    expect(hr?.history).toHaveLength(10);
    expect(hr?.note.en).toMatch(/^Above your usual range of /);
  });

  it("a symptom reported today and a value from the last check-in (dated) are listed for the head", () => {
    const history = [{ date: "2026-11-13", values: { sleep_hours: 4 } }];
    const items = relatedItems({ location: "head", today: { symptom_headache: 1 }, history });
    expect(items.map((i) => [i.id, i.band])).toEqual([
      ["vital-sleep_hours", "outside_demo"],
      ["symptom-symptom_headache", "reported"],
    ]);
    expect(items[0]).toMatchObject({ date: "2026-11-13", value: 4, direction: "low" });
    expect(items[0].note.en).toMatch(/From your last check-in \(2026-11-13\)\./);
  });

  it("the linked Signature panel (chest) and urine panel (abdomen) appear only when flagged", () => {
    const sig = { cls: "UNEXPECTED_ACTIVATION" as const, fri: "72", crew: "C001", daysSinceLanding: "1" };
    expect(relatedItems({ location: "chest", today: {}, history: [], signature: sig }).map((i) => i.id)).toEqual(["signature"]);
    expect(relatedItems({ location: "chest", today: {}, history: [], signature: { ...sig, cls: "BASELINE" } })).toEqual([]);
    const urine = { person: "C001", timepoint: "R+45", abnormal: 3, borderline: 5 };
    expect(relatedItems({ location: "abdomen", today: {}, history: [], urine }).map((i) => i.valueText.en)).toEqual(["3 abnormal · 5 borderline"]);
    expect(relatedItems({ location: "abdomen", today: {}, history: [], urine: { ...urine, abnormal: 0 } })).toEqual([]);
    expect(relatedItems({ location: "leg", today: {}, history: [], urine })).toEqual([]);
  });

  it("danger first, at most four items", () => {
    const items = relatedItems({
      location: "whole_body",
      today: { temperature_c: 40, heart_rate: 105, sleep_hours: 4, water_ml: 500, workload: 6, exercise_min: 5 },
      history: [],
    });
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ key: "temperature_c", band: "danger" });
  });
});

/* ───────────── after the check-in, in small talk, in friend mode ───────────── */

describe("works at any point", () => {
  it("in small talk, before the measurements", async () => {
    const id = await startCheckIn("bat", "en");
    await playTurn("bat", id, "Hi Cosmo");
    const events = await playTurn("bat", id, "my neck hurts since yesterday");
    expect(painOf(events)).toMatchObject({ location: "throat", onset: { kind: "yesterday" }, awaiting: "details" });
    expect(assistantText(events)).toMatch(/How strong is it, from 0 to 10\?$/);
  });

  it("a crisis while talking keeps the crisis reply (no pain detour)", async () => {
    const id = await startCheckIn("bat", "en");
    await playTurn("bat", id, "Hi Cosmo");
    await playTurn("bat", id, "can I talk to you?");
    const events = await playTurn("bat", id, "I have chest pain and I can't breathe");
    expect(painOf(events)).toBeUndefined();
    expect(assistantText(events)).toMatch(/^This needs attention right away\./);
  });

  it("never without the words", async () => {
    const id = await atSleep();
    for (const text of ["I slept seven hours", "no pain today", "is back pain common in space?"]) {
      expect(painOf(await playTurn("bat", id, text))).toBeUndefined();
    }
    expect(await listPainReports("bat")).toEqual([]);
  });
});

/* ───────────── storage and the ground console ───────────── */

describe("pain reports: storage, isolation, the Earth console", () => {
  const input = {
    location: "head" as const,
    severity: { value: 4, word: null },
    onset: { kind: "hours" as const, amount: 2 },
    items: [],
    redFlags: [],
    urgent: false,
    guideId: null,
    sosAlertId: null,
    send: true,
    awaiting: null,
  };

  it("stores and reads back every field; crew isolation (another member's check-in or report is 404)", async () => {
    const id = await startCheckIn("bat", "en");
    const r = await createPainReport("bat", id, input);
    expect(r).toMatchObject({ crewId: "bat", checkInId: id, location: "head", severity: { value: 4, word: null }, onset: { kind: "hours", amount: 2 }, sentAt: NOW.toISOString(), urgent: false });
    await expect(createPainReport("saraa", id, input)).rejects.toThrow(NotFoundError);
    await expect(getPainReport("saraa", r.id)).rejects.toThrow(NotFoundError);
    await expect(updatePainReport("saraa", r.id, input)).rejects.toThrow(NotFoundError);
    expect(await listPainReports("saraa")).toEqual([]);
  });

  it("the first sent time is kept on update; an unsent report is not on the console", async () => {
    const id = await startCheckIn("bat", "en");
    const draft = await createPainReport("bat", id, { ...input, location: null, send: false, awaiting: "location" });
    expect(draft.sentAt).toBeNull();
    expect(await groundListPainReports(NOW.toISOString())).toEqual([]);
    const later = new Date(NOW.getTime() + 60_000);
    const sent = await updatePainReport("bat", draft.id, input, later);
    expect(sent.sentAt).toBe(later.toISOString());
    const again = await updatePainReport("bat", draft.id, { ...input, severity: { value: 5, word: null } }, new Date(later.getTime() + 60_000));
    expect(again.sentAt).toBe(later.toISOString());
  });

  it("GET /api/ground/pain: ground only, with the simulated delay", async () => {
    const id = await startCheckIn("bat", "en");
    await createPainReport("bat", id, input);
    const url = (qs = "") => new Request(`http://localhost/api/ground/pain${qs}`);
    expect((await getGroundPain(url())).status).toBe(401);
    await setGroundCookie();
    const res = await getGroundPain(url());
    expect(res.status).toBe(200);
    const list = (await res.json()) as GroundPainReport[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ crewId: "bat", location: "head" });
    // 20 minutes of delay: not arrived yet
    const delayed = (await (await getGroundPain(url("?delayMs=1200000"))).json()) as GroundPainReport[];
    expect(delayed).toEqual([]);
    expect((await getGroundPain(url("?crewId=bad id"))).status).toBe(400);
  });
});

/* ───────────── the event in the browser ───────────── */

describe("the pain event on the client", () => {
  it("the browser accepts a pain event (and drops a malformed one); the store keeps the last one", async () => {
    const id = await atSleep();
    const pain = painOf(await playTurn("bat", id, "my head hurts"));
    const parsed = parseTurnEvent({ event: "message", data: JSON.stringify(pain), id: null });
    expect(parsed).toEqual(pain);
    expect(parseTurnEvent({ event: "message", data: JSON.stringify({ type: "pain", location: "head" }), id: null })).toBeNull();
    const odd = parseTurnEvent({
      event: "message",
      data: JSON.stringify({ ...pain, location: "tail", guideId: "<script>", items: [{ id: 1 }], severity: { value: 42 } }),
      id: null,
    });
    expect(odd).toMatchObject({ type: "pain", location: null, guideId: null, items: [], severity: null });

    notePainFromTurn(pain, "en");
    expect(getPainState()).toMatchObject({ seq: 1, lang: "en", event: { location: "head" } });
    expect(getPainState()?.event).not.toHaveProperty("type");
    dismissPain();
    expect(getPainState()).toBeNull();
  });
});
