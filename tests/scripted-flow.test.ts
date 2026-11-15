import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KpiKey, Lang, TurnEvent } from "@/lib/types";
import { DEMO_SCRIPTS } from "@/server/agent/scripts";
import { ALERT_SPOKEN_NOTICE } from "@/server/alerts";
import { setClockForTests } from "@/server/clock";
import { getCheckIn } from "@/server/db/repos/checkin";
import { listAlerts } from "@/server/db/repos/alert";
import { listMeasurements } from "@/server/db/repos/measurement";
import { listTurns } from "@/server/db/repos/turn";
import { getSnapshot } from "@/server/checkin/service";
import { setSensorFeedForTests } from "@/server/checkin/sensors";
import { SENSOR_KEYS } from "@/lib/kpi/registry";
import { SPOKEN_ANSWERS, assistantText, ctxOf, eventsOf, playTurn, startCheckIn } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

beforeEach(async () => {
  setClockForTests(TEST_TODAY);
  await freshSeededDb();
});
afterEach(() => {
  setClockForTests(null);
  setSensorFeedForTests(null);
});

/** plays every astronaut line of a script through the real turn pipeline (scripted agent, in-memory database) */
async function runScript(lang: Lang) {
  const script = DEMO_SCRIPTS[lang];
  const checkInId = await startCheckIn("bat", lang);
  const turns: TurnEvent[][] = [];
  for (const line of script.lines) turns.push(await playTurn("bat", checkInId, line.say));
  return { script, checkInId, turns, all: turns.flat() };
}

describe.each<Lang>(["en", "mn"])("scripted demo flow (%s)", (lang) => {
  it("walks GREETING to DONE, stores the sensor readings and the spoken answers, and corrects energy to 2", async () => {
    const { script, checkInId, all } = await runScript(lang);

    const checkIn = await getCheckIn("bat", checkInId);
    expect(checkIn.state).toBe("DONE");
    expect(checkIn.confirmedAt).not.toBeNull();
    expect(checkIn.summaryJson).not.toBeNull();
    expect((await ctxOf("bat", checkInId)).state).toBe("DONE");

    const rows = await listMeasurements("bat", checkInId);
    const stored = new Map<KpiKey, number | string>(rows.map((m) => [m.key, m.value]));
    for (const [key, value] of Object.entries(script.values) as Array<[KpiKey, number]>) {
      expect(stored.get(key), key).toBe(value);
    }
    expect([...stored.keys()].sort()).toEqual(Object.keys(script.values).sort());
    // the measurements a wearable gives come from the (simulated) sensor feed, never from a question
    for (const key of SENSOR_KEYS) expect(rows.find((m) => m.key === key)?.source, key).toBe("sensor");
    expect(stored.has("day_note")).toBe(false);

    const corrections = eventsOf(all, "measurement").filter((e) => e.change === "corrected");
    expect(corrections.map((e) => [e.key, e.value])).toEqual([["energy", 2]]);
    const first = eventsOf(all, "measurement").find((e) => e.key === "energy");
    expect(first).toMatchObject({ value: 3, change: "recorded" });
    // no measurement event for a sensor reading: nothing was heard
    expect(eventsOf(all, "measurement").some((e) => (SENSOR_KEYS as readonly string[]).includes(e.key))).toBe(false);
  });

  it("reads the unusual sensor reading back before the first question, and a low wellbeing answer gets a kind word", async () => {
    const { turns } = await runScript(lang);
    const start = assistantText(turns[2]);
    expect(start).toMatch(lang === "en" ? /^Your sensors already logged/u : /^Таны мэдрэгчүүд/u);
    expect(start).toMatch(lang === "en" ? /resting heart rate was 82 beats per minute, higher than your usual 66\./u : /пульс минутад 82 удаа байна, ердийнхөөсөө их байна \(таны дундаж 66\)/u);
    expect(start).toMatch(lang === "en" ? /Did you exercise, or are you feeling stressed or unwell\?$/u : /биеэ тавгүй байна уу\?$/u);
    const lowSleep = assistantText(turns[6]);
    expect(lowSleep).toMatch(lang === "en" ? /A rough night makes everything feel harder\./u : /Муу унтсан шөнийн дараа/u);
    expect(lowSleep).not.toMatch(/diagnos|medicat|онош/iu);
  });

  it("emits transcript, measurement|clarification, state, assistant, summary?, show?, timing, done in order on every turn", async () => {
    const { turns } = await runScript(lang);
    const rank: Record<TurnEvent["type"], number> = {
      transcript: 0,
      error: 1,
      measurement: 2,
      clarification: 2,
      state: 3,
      // an SOS turn ("tell Earth") sends `sos` before Cosmo's line
      sos: 3,
      // a pain turn ("my head hurts") sends `pain` before Cosmo's line
      pain: 3,
      // assistant mode asks the screen to open the dashboard or switch the person before Cosmo's line
      action: 3,
      assistant: 4,
      summary: 5,
      // the panels Cosmo shows on screen (show.ts) come after her words
      show: 6,
      // Cosmo's step-by-step walkthrough (explain.ts) comes after the summary, before the timing
      explain: 6,
      timing: 7,
      done: 8,
    };
    for (const events of turns) {
      expect(events[0].type).toBe("transcript");
      expect(events[events.length - 1].type).toBe("done");
      const ranks = events.map((e) => rank[e.type]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      expect(events.filter((e) => e.type === "state")).toHaveLength(1);
      expect(events.filter((e) => e.type === "assistant")).toHaveLength(1);
      expect(events.filter((e) => e.type === "timing")).toHaveLength(1);
    }
  });

  it("produces a sensible summary for Bat's demo values: yellow, pulse and sleep quality, no red flag, no alert", async () => {
    const { turns, checkInId } = await runScript(lang);
    const last = turns[turns.length - 1];
    const summary = eventsOf(last, "summary")[0]?.summary;
    expect(summary).toBeDefined();
    expect(summary.overall).toBe("yellow");
    expect(summary.redFlags).toEqual([]);
    expect(summary.findings.map((f) => f.key).sort()).toEqual(["heart_rate", "sleep_quality"]);
    expect(summary.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(summary.recommendations.length).toBeLessThanOrEqual(2);
    expect(summary.spoken.language).toBe(lang);
    expect(summary.spoken.text).toContain(summary.disclaimer[lang]);
    expect(summary.audioTurnId).toBeTruthy();

    // the state event on that turn tells the client to open the dashboard; the stored state is DONE
    expect(eventsOf(last, "state")[0].state).toBe("SUMMARY");
    expect((await listAlerts("bat")).filter((a) => a.checkInId === checkInId)).toEqual([]);

    // the summary is spoken by the audio turn, which is a stored Cosmo turn
    const turn = (await listTurns("bat", checkInId)).find((t) => t.id === summary.audioTurnId);
    expect(turn?.speaker).toBe("cosmo");
    expect(turn?.text).toBe(summary.spoken.text);
  });

  it("walks the states in the documented order", async () => {
    const { turns } = await runScript(lang);
    const states = turns.map((events) => eventsOf(events, "state")[0].state);
    const order: string[] = [];
    for (const s of states) if (order[order.length - 1] !== s) order.push(s);
    expect(order).toEqual(["SMALL_TALK", "KPI_CAPTURE", "CONFIRM", "SUMMARY"]);
    // small talk lasts two turns, then Cosmo proposes the measurements
    expect(states.slice(0, 3)).toEqual(["SMALL_TALK", "SMALL_TALK", "KPI_CAPTURE"]);
  });

  it("asks one question at a time and never asks for a value that is already stored", async () => {
    const { turns } = await runScript(lang);
    const questions = turns
      .flatMap((events) => eventsOf(events, "state"))
      .map((s) => s.expectedQuestion)
      .filter((q): q is NonNullable<typeof q> => q !== null);
    // the sensor follow-up (Bat's resting pulse is up) and the six spoken questions; no measurement is asked
    expect(questions).toEqual(["sensor_check", "mood", "symptoms", "sleep_quality", "energy", "stress", "connection"]);
  });

  it("refuses writes after DONE: a late message only gets a closing reply", async () => {
    const { checkInId } = await runScript(lang);
    const before = await listMeasurements("bat", checkInId);
    const events = await playTurn("bat", checkInId, lang === "en" ? "My pulse is 90" : "Пульс 90");
    expect(eventsOf(events, "measurement")).toEqual([]);
    expect(eventsOf(events, "summary")).toEqual([]);
    expect(eventsOf(events, "state")[0].state).toBe("DONE");
    expect(assistantText(events).length).toBeGreaterThan(0);
    expect(await listMeasurements("bat", checkInId)).toEqual(before);
  });

  it("returns a snapshot with statuses for every stored value", async () => {
    const { checkInId } = await runScript(lang);
    const snapshot = await getSnapshot("bat", checkInId);
    expect(snapshot.checkIn.state).toBe("DONE");
    expect(snapshot.checkIn.confirmedAt).not.toBeNull();
    const byKey = new Map(snapshot.measurements.map((m) => [m.key, m]));
    expect(byKey.get("sleep_hours")?.status).toBe("green");
    expect(byKey.get("heart_rate")?.status).toBe("yellow");
    expect(byKey.get("sleep_quality")?.status).toBe("yellow");
    for (const m of snapshot.measurements) {
      expect(m.source, m.key).toBe((SENSOR_KEYS as readonly string[]).includes(m.key) ? "sensor" : "simulated");
    }
    expect(snapshot.turns.filter((t) => t.speaker === "cosmo").length).toBeGreaterThanOrEqual(10);
  });
});

/** without a sensor feed every measurement is asked after the six spoken questions (the path these tests walk) */
const SAID_TO_SLEEP = ["hello", "I'm fine", "let's start", ...SPOKEN_ANSWERS.en];
const SAID_AFTER_SLEEP = ["120 over 80", "70", "36.6", "95", "2300 ml", "45 minutes"];

describe("red flag path: alerts", () => {
  beforeEach(() => setSensorFeedForTests(false));

  async function playRed() {
    const checkInId = await startCheckIn("bat", "en");
    // "blurry vision" is part of the symptom question now (vision is not asked as a separate daily test)
    const said = [
      "hello",
      "I'm fine",
      "let's start",
      "4",
      "I have a headache and blurry vision",
      "4",
      "4",
      "2",
      "4",
      "6 hours",
      ...SAID_AFTER_SLEEP,
      "yes",
    ];
    const turns: TurnEvent[][] = [];
    for (const text of said) turns.push(await playTurn("bat", checkInId, text));
    return { checkInId, turns };
  }

  it("a headache with a blurred vision check turns the overall status red, creates one calm alert and says so", async () => {
    const { checkInId, turns } = await playRed();
    const last = turns[turns.length - 1];
    const summary = eventsOf(last, "summary")[0].summary;
    expect(summary.overall).toBe("red");
    expect(summary.redFlags.map((f) => f.rule)).toEqual(["HEADACHE_PLUS_VISION"]);
    expect(eventsOf(last, "assistant")[0].emotion).toBe("concerned");
    expect(summary.spoken.text).toMatch(/medical officer/i);

    const alerts = (await listAlerts("bat")).filter((a) => a.checkInId === checkInId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: "red", rule: "HEADACHE_PLUS_VISION", acknowledgedAt: null });
    expect(JSON.stringify(alerts[0].text)).not.toMatch(/diagnos/i);
    expect(alerts[0].text.en).toMatch(/alert/i);
  });

  it("a failure while writing the summary rolls the confirmation back, and the next turn finishes the job with its alert", async () => {
    const checkInId = await startCheckIn("bat", "en");
    const said = ["hello", "I'm fine", "let's start", "4", "I have a headache and blurry vision", "4", "4", "2", "4", "6 hours", ...SAID_AFTER_SLEEP];
    for (const text of said) await playTurn("bat", checkInId, text);
    expect((await ctxOf("bat", checkInId)).state).toBe("CONFIRM");

    // the alert insert fails (as a dropped connection would) after the summary turn and the confirmation were written
    const { getDb } = await import("@/server/db/client");
    const db = await getDb();
    const pg = db.dialect === "postgres";
    await db.exec(
      pg
        ? `CREATE FUNCTION test_fail_alert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected alert failure'; END $$;
           CREATE TRIGGER test_fail_alert BEFORE INSERT ON alert FOR EACH ROW EXECUTE FUNCTION test_fail_alert();`
        : "CREATE TRIGGER test_fail_alert BEFORE INSERT ON alert BEGIN SELECT RAISE(ABORT, 'injected alert failure'); END;",
    );
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let failed: TurnEvent[];
    try {
      failed = await playTurn("bat", checkInId, "yes");
    } finally {
      await db.exec(pg ? "DROP TRIGGER test_fail_alert ON alert; DROP FUNCTION test_fail_alert();" : "DROP TRIGGER test_fail_alert;");
      quiet.mockRestore();
    }
    expect(eventsOf(failed, "error").map((e) => e.code)).toEqual(["INTERNAL"]);
    expect(eventsOf(failed, "summary")).toEqual([]);
    // nothing of the summary step stuck: not confirmed, no summary turn, still at the read-back
    const after = await getCheckIn("bat", checkInId);
    expect(after.confirmedAt).toBeNull();
    expect(after.summaryJson).toBeNull();
    expect((await ctxOf("bat", checkInId)).state).toBe("CONFIRM");
    expect((await listAlerts("bat")).filter((a) => a.checkInId === checkInId)).toEqual([]);
    const turns = await listTurns("bat", checkInId);
    expect(turns[turns.length - 1]).toMatchObject({ speaker: "crew", text: "yes" });

    // the astronaut says yes again: the summary, the confirmation and the alert are all there
    const done = await playTurn("bat", checkInId, "yes");
    expect(eventsOf(done, "summary")[0]?.summary.overall).toBe("red");
    expect((await getCheckIn("bat", checkInId)).confirmedAt).not.toBeNull();
    expect((await listAlerts("bat")).filter((a) => a.checkInId === checkInId).map((a) => a.rule)).toEqual(["HEADACHE_PLUS_VISION"]);
  });

  it("alert creation is idempotent per check-in and rule, and scoped to the crew member", async () => {
    const { checkInId } = await playRed();
    const { createAlertsForCheckIn } = await import("@/server/alerts");
    const summary = JSON.parse((await getCheckIn("bat", checkInId)).summaryJson as string) as import("@/lib/types").SummaryFindings;
    const again = await createAlertsForCheckIn("bat", checkInId, summary);
    expect(again).toHaveLength(1);
    expect((await listAlerts("bat")).filter((a) => a.checkInId === checkInId)).toHaveLength(1);
    expect((await listAlerts("saraa")).filter((a) => a.checkInId === checkInId)).toEqual([]);
    expect(await createAlertsForCheckIn("bat", checkInId, { ...summary, overall: "yellow" })).toEqual([]);
  });

  it("a red status without a red-flag rule (sleep 4 h, mood 2) tells the astronaut that the medical officer and ground are informed", async () => {
    for (const lang of ["en", "mn"] as const) {
      await freshSeededDb();
      setClockForTests(TEST_TODAY);
      const checkInId = await startCheckIn("bat", lang);
      setSensorFeedForTests(false);
      const said = lang === "en"
        ? ["hello", "I'm fine", "let's start", "2", "no", "4", "4", "2", "4", "4 hours", ...SAID_AFTER_SLEEP, "yes"]
        : ["Сайн байна, баярлалаа.", "Сайхан байна.", "Тийм, хийцгээе.", "Хоёр байна.", "Үгүй, юу ч байхгүй.", "Дөрөв.", "Дөрөв.", "Хоёр.", "Дөрөв.", "Дөрөв цаг унтсан.", "124 дээр 82.", "Пульс жаран найм.", "36.7 градус.", "98.", "Ус нэг мянга найман зуун мл.", "40 минут.", "Тийм, зөв."];
      let last: TurnEvent[] = [];
      for (const text of said) last = await playTurn("bat", checkInId, text);
      const summary = eventsOf(last, "summary")[0]?.summary;
      expect(summary, lang).toBeDefined();
      expect(summary.overall, lang).toBe("red");
      expect(summary.redFlags, lang).toEqual([]);

      const alerts = (await listAlerts("bat")).filter((a) => a.checkInId === checkInId);
      expect(alerts.map((a) => a.rule), lang).toEqual(["OVERALL"]);

      const spoken = summary.spoken.text;
      expect(spoken, lang).toContain(ALERT_SPOKEN_NOTICE[lang]);
      expect(spoken, lang).toMatch(lang === "en" ? /medical officer and ground are being informed/ : /эмнэлгийн офицер болон газрын хяналтад мэдэгдэж байна/);
      // the notice comes before the closing disclaimer, which stays last
      expect(spoken.endsWith(summary.disclaimer[lang].replace(/[.!?]+$/u, "") + ".") || spoken.endsWith(summary.disclaimer[lang]), lang).toBe(true);
      expect(spoken.indexOf(ALERT_SPOKEN_NOTICE[lang]), lang).toBeLessThan(spoken.lastIndexOf(summary.disclaimer[lang]));
      expect(eventsOf(last, "assistant")[0].emotion, lang).toBe("concerned");
      expect(eventsOf(last, "assistant")[0].text, lang).toBe(spoken);
    }
  });

  it("ensureAlertNotice only touches an overall red summary and never duplicates the notice", async () => {
    const { ensureAlertNotice } = await import("@/server/agent/turn");
    const base = { disclaimer: { en: "Decision support, not a diagnosis.", mn: "Шийдвэрийн дэмжлэг, онош биш." }, redFlags: [] } as unknown as import("@/lib/types").SummaryFindings;
    const spoken = "Headline. Decision support, not a diagnosis.";
    expect(ensureAlertNotice(spoken, { ...base, overall: "yellow" }, "en")).toBe(spoken);
    const red = ensureAlertNotice(spoken, { ...base, overall: "red" }, "en");
    expect(red).toBe(`Headline. ${ALERT_SPOKEN_NOTICE.en} Decision support, not a diagnosis.`);
    expect(ensureAlertNotice(red, { ...base, overall: "red" }, "en")).toBe(red);
    // without the disclaimer in the text the notice is appended
    expect(ensureAlertNotice("Headline.", { ...base, overall: "red" }, "en")).toBe(`Headline. ${ALERT_SPOKEN_NOTICE.en}`);
  });

  it("the alert notice equals the template's red-flag notice (the two must not drift apart)", async () => {
    const T = await import("@/server/agent/templates");
    const flag = { rule: "HEADACHE_PLUS_VISION" } as unknown as import("@/lib/types").RedFlag;
    expect(ALERT_SPOKEN_NOTICE.en).toBe(T.redFlagNotice([flag], "en"));
    expect(ALERT_SPOKEN_NOTICE.mn).toBe(T.redFlagNotice([flag], "mn"));
  });

  it("a red status without a red-flag rule (mood 2) still gets one OVERALL alert", async () => {
    const { createAlertsForCheckIn } = await import("@/server/alerts");
    const checkInId = await startCheckIn("bat", "en");
    const summary = { overall: "red", redFlags: [] } as unknown as import("@/lib/types").SummaryFindings;
    const alerts = await createAlertsForCheckIn("bat", checkInId, summary);
    expect(alerts.map((a) => a.rule)).toEqual(["OVERALL"]);
    expect(await createAlertsForCheckIn("bat", checkInId, summary)).toHaveLength(1);
  });
});

describe("conversation edge cases (scripted agent)", () => {
  beforeEach(() => setSensorFeedForTests(false));

  /** to the sleep question (no sensor feed: it follows the six spoken questions) */
  async function toCapture(): Promise<string> {
    const id = await startCheckIn("bat", "en");
    let last: TurnEvent[] = [];
    for (const say of SAID_TO_SLEEP) last = await playTurn("bat", id, say);
    expect(eventsOf(last, "state")[0]).toMatchObject({ state: "KPI_CAPTURE", expectedQuestion: "sleep" });
    return id;
  }

  it("an out-of-range answer gets a clarification event and a re-ask; after two failed clarifications the question is skipped", async () => {
    const id = await toCapture();
    const first = await playTurn("bat", id, "I slept 20 hours");
    expect(eventsOf(first, "clarification")).toEqual([{ type: "clarification", key: "sleep_hours", reason: "out_of_range" }]);
    expect(eventsOf(first, "measurement")).toEqual([]);
    expect(eventsOf(first, "assistant")[0].emotion).toBe("concerned");
    expect(eventsOf(first, "state")[0]).toMatchObject({ state: "KPI_CAPTURE", expectedQuestion: "sleep" });
    expect((await ctxOf("bat", id)).clarifyCount.sleep).toBe(1);

    const second = await playTurn("bat", id, "maybe 30 hours");
    expect(eventsOf(second, "state")[0].expectedQuestion).toBe("sleep");
    expect((await ctxOf("bat", id)).clarifyCount.sleep).toBe(2);

    const third = await playTurn("bat", id, "no idea really");
    expect(eventsOf(third, "state")[0]).toMatchObject({ state: "KPI_CAPTURE", expectedQuestion: "blood_pressure" });
    expect(assistantText(third)).toMatch(/add it when we confirm/i);
    expect((await ctxOf("bat", id)).skipped).toEqual(["sensor_check", "sleep"]);
    expect((await listMeasurements("bat", id)).some((m) => m.key === "sleep_hours")).toBe(false);
  });

  it("a skipped value can be added at the read-back as a correction", async () => {
    const id = await toCapture();
    await playTurn("bat", id, "skip");
    expect((await ctxOf("bat", id)).skipped).toEqual(["sensor_check", "sleep"]);
    for (const say of SAID_AFTER_SLEEP) {
      await playTurn("bat", id, say);
    }
    expect((await ctxOf("bat", id)).state).toBe("CONFIRM");
    const fix = await playTurn("bat", id, "No, I slept 7 hours");
    expect(eventsOf(fix, "measurement")[0]).toMatchObject({ key: "sleep_hours", value: 7, change: "corrected" });
    expect((await ctxOf("bat", id)).skipped).toEqual(["sensor_check"]); // sleep is no longer skipped
    expect((await ctxOf("bat", id)).state).toBe("CONFIRM");
  });

  it("a value volunteered during small talk is recorded at once and its question is never asked", async () => {
    const id = await startCheckIn("bat", "en");
    const events = await playTurn("bat", id, "Good morning, I slept 6 hours and my pulse is 70");
    expect(eventsOf(events, "measurement").map((m) => [m.key, m.value])).toEqual([
      ["sleep_hours", 6],
      ["heart_rate", 70],
    ]);
    await playTurn("bat", id, "just fine");
    const start = await playTurn("bat", id, "yes");
    expect(eventsOf(start, "state")[0].expectedQuestion).toBe("mood");
  });

  it("a 'not now' to the proposal is acknowledged and the offer repeated", async () => {
    const id = await startCheckIn("bat", "en");
    await playTurn("bat", id, "hello");
    await playTurn("bat", id, "I'm fine");
    const no = await playTurn("bat", id, "not now");
    expect(eventsOf(no, "state")[0]).toMatchObject({ state: "SMALL_TALK", expectedQuestion: null });
    const yes = await playTurn("bat", id, "okay, let's go");
    expect(eventsOf(yes, "state")[0].state).toBe("KPI_CAPTURE");
  });

  it("at the read-back a plain 'no' asks what to change, and something unclear repeats the question", async () => {
    const id = await toCapture();
    for (const say of ["6 hours", ...SAID_AFTER_SLEEP]) {
      await playTurn("bat", id, say);
    }
    expect((await ctxOf("bat", id)).state).toBe("CONFIRM");
    const no = await playTurn("bat", id, "no");
    expect(assistantText(no)).toMatch(/what would you like to change/i);
    expect((await ctxOf("bat", id)).state).toBe("CONFIRM");
    const unclear = await playTurn("bat", id, "hmm let me think");
    expect(assistantText(unclear)).toMatch(/is everything correct/i);
    expect((await ctxOf("bat", id)).state).toBe("CONFIRM");
    expect((await getCheckIn("bat", id)).confirmedAt).toBeNull();
  });

  it("a rejected correction at the read-back is explained and the read-back stays open (not 'what would you like to change')", async () => {
    const id = await toCapture();
    for (const say of ["6 hours", ...SAID_AFTER_SLEEP]) {
      await playTurn("bat", id, say);
    }
    expect((await ctxOf("bat", id)).state).toBe("CONFIRM");

    for (const say of ["no, sleep was 30 hours", "sleep was 30 hours", "yes, sleep was 30 hours"]) {
      const events = await playTurn("bat", id, say);
      expect(eventsOf(events, "clarification"), say).toEqual([{ type: "clarification", key: "sleep_hours", reason: "out_of_range" }]);
      expect(eventsOf(events, "measurement"), say).toEqual([]);
      expect(eventsOf(events, "summary"), say).toEqual([]);
      // changed 2026-11-15: the range re-ask names what was heard (valueChecks.rangeReply)
      expect(assistantText(events), say).toMatch(/I heard 30 hours, which is too high for sleep/i);
      expect(assistantText(events), say).toMatch(/between 0 and 14 hours/i);
      expect(assistantText(events), say).not.toMatch(/what would you like to change|here is what i have/i);
      expect(eventsOf(events, "assistant")[0].emotion).toBe("concerned");
      expect((await ctxOf("bat", id)).state).toBe("CONFIRM");
    }
    expect((await listMeasurements("bat", id)).find((m) => m.key === "sleep_hours")?.value).toBe(6);
    expect((await getCheckIn("bat", id)).confirmedAt).toBeNull();

    // a usable correction right after still works
    const fix = await playTurn("bat", id, "sleep was 7 hours");
    expect(eventsOf(fix, "measurement")[0]).toMatchObject({ key: "sleep_hours", value: 7, change: "corrected" });
  });

  it("restating a recorded value during capture is noted for the read-back and does not count as a failed answer", async () => {
    const id = await toCapture();
    await playTurn("bat", id, "7 hours");
    expect((await ctxOf("bat", id)).filled).toContain("sleep_hours");

    for (let i = 0; i < 4; i++) {
      const events = await playTurn("bat", id, "actually I slept 8 hours");
      expect(eventsOf(events, "clarification")).toEqual([]);
      expect(eventsOf(events, "measurement")).toEqual([]);
      expect(eventsOf(events, "state")[0]).toMatchObject({ state: "KPI_CAPTURE", expectedQuestion: "blood_pressure" });
      expect(assistantText(events)).toMatch(/you can change that when we confirm/i);
      expect(assistantText(events)).toContain("What is your blood pressure");
      expect(assistantText(events)).not.toMatch(/didn't catch/i);
      const ctx = await ctxOf("bat", id);
      expect(ctx.clarifyCount.blood_pressure).toBeUndefined();
      expect(ctx.skipped).toEqual(["sensor_check"]);
    }
    // the stored value is untouched, and the blood pressure is still answered normally
    expect((await listMeasurements("bat", id)).find((m) => m.key === "sleep_hours")?.value).toBe(7);
    const bp = await playTurn("bat", id, "120 over 80");
    expect(eventsOf(bp, "measurement")[0]).toMatchObject({ key: "bp_systolic", value: 120 });
  });

  it("at the read-back the astronaut hears which skipped questions are still missing", async () => {
    const id = await toCapture();
    await playTurn("bat", id, "skip");
    let last: TurnEvent[] = [];
    for (const say of SAID_AFTER_SLEEP) {
      last = await playTurn("bat", id, say);
    }
    expect((await ctxOf("bat", id)).state).toBe("CONFIRM");
    expect(assistantText(last)).toMatch(/I don't have sleep yet\. You can add it now\./);
    expect(assistantText(last)).toMatch(/Is everything correct\?$/);
    // the optional day note is never listed, and a repeated read-back carries the notice again
    expect(assistantText(last)).not.toMatch(/day note/i);
    const again = await playTurn("bat", id, "hmm let me think");
    expect(assistantText(again)).toMatch(/I don't have sleep yet/);
    // once the value is added the notice is gone
    await playTurn("bat", id, "No, I slept 7 hours");
    const after = await playTurn("bat", id, "hmm");
    expect(assistantText(after)).not.toMatch(/I don't have/);
  });

  it("an empty message is a recoverable error, not a crash", async () => {
    const id = await startCheckIn("bat", "en");
    const events = await playTurn("bat", id, "   ");
    expect(events.map((e) => e.type)).toEqual(["error", "done"]);
    expect(events[0]).toMatchObject({ type: "error", code: "BAD_INPUT", recoverable: true });
  });

  it("a very short answer keeps the language of the conversation", async () => {
    const id = await startCheckIn("bat", "mn");
    const events = await playTurn("bat", id, "ok");
    expect(eventsOf(events, "assistant")[0].language).toBe("mn");
  });
});
