import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConversationState, KpiKey, Lang, MeasurementValue } from "@/lib/types";
import type { HistoryDay } from "@/lib/health/baseline";
import { computeBaselines } from "@/lib/health";
import { BODY_CALLOUTS, BODY_KEYS, MAX_SHOW_PANELS, beatSeconds, ecgPath, parseShowPanels, type ShowPanel } from "@/lib/show";
import { asksToSee, decideShow, showEvent, showTopics, type ShowInput } from "@/server/agent/show";
import { parseTurnEvent } from "@/components/checkin/sse";
import { checkInReducer, initialCheckInState } from "@/components/checkin/state";
import { setClockForTests } from "@/server/clock";
import { eventsOf, playTurn, startCheckIn } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

/** 14 confirmed past days with gently varying values (oldest first) */
function history(): HistoryDay[] {
  return Array.from({ length: 14 }, (_, i) => ({
    date: `2026-10-${String(31 - 14 + i).padStart(2, "0")}`,
    values: {
      heart_rate: 64 + (i % 5),
      sleep_hours: 7 + (i % 3) * 0.5,
      bp_systolic: 116 + (i % 4),
      bp_diastolic: 74 + (i % 3),
      temperature_c: 36.6 + (i % 2) * 0.1,
      water_ml: 2000 + (i % 3) * 100,
      glucose_mgdl: 92 + (i % 4),
      mood: 4,
      exercise_min: 40 + (i % 2) * 10,
      vision_check: 0,
      workload: 2,
      symptom_headache: 0,
      symptom_dizziness: 0,
      symptom_nausea: 0,
    },
  }));
}

const TODAY: Partial<Record<KpiKey, MeasurementValue>> = {
  heart_rate: 72,
  sleep_hours: 6.5,
  bp_systolic: 124,
  bp_diastolic: 80,
  temperature_c: 36.8,
  water_ml: 1500,
  glucose_mgdl: 98,
  mood: 4,
  exercise_min: 30,
  vision_check: 0,
  workload: 2,
  symptom_headache: 0,
  symptom_dizziness: 0,
  symptom_nausea: 0,
};

function input(text: string, over: Partial<ShowInput> = {}): ShowInput {
  return {
    text,
    lang: "en",
    state: "KPI_CAPTURE",
    recorded: [],
    values: TODAY,
    history: history(),
    summary: false,
    ...over,
  };
}

const kinds = (panels: ShowPanel[]) => panels.map((p) => p.kind);
const ids = (panels: ShowPanel[]) => panels.map((p) => p.id);

describe("which words show which panels", () => {
  it.each<[string, Lang, string[]]>([
    ["How is my heart rate?", "en", ["ecg-heart_rate"]],
    ["Миний зүрхний цохилт хэд вэ?", "mn", ["ecg-heart_rate"]],
    ["What's my blood pressure?", "en", ["vital-bp_systolic"]],
    ["миний даралт ямар байна?", "mn", ["vital-bp_systolic"]],
    ["show my sleep", "en", ["vital-sleep_hours"]],
    ["нойроо харуулаач", "mn", ["vital-sleep_hours"]],
    ["show my sleep over the past two weeks", "en", ["trend-sleep_hours"]],
    ["сүүлийн 14 хоногийн нойр харуулаач", "mn", ["trend-sleep_hours"]],
    ["how much water did I drink?", "en", ["ring-water"]],
    ["усаа хэр уусан бэ?", "mn", ["ring-water"]],
    ["what is my temperature?", "en", ["vital-temperature_c"]],
    ["биеийн температур хэд вэ?", "mn", ["vital-temperature_c"]],
    ["how is my blood sugar?", "en", ["vital-glucose_mgdl"]],
    ["сахар ямар байна?", "mn", ["vital-glucose_mgdl"]],
    ["any symptoms today?", "en", ["vital-symptom_headache"]],
    ["how is my oxygen saturation?", "en", ["ring-spo2"]],
    ["амьсгал ямар байна?", "mn", ["ring-spo2"]],
    ["what does my blood panel say?", "en", ["signature"]],
    ["цусны шинжилгээ юу гэж байна?", "mn", ["signature"]],
    ["show my urine labs", "en", ["labs"]],
    ["шээсний шинжилгээ харуул", "mn", ["labs"]],
  ])("%s (%s)", (text, lang, expected) => {
    expect(ids(decideShow(input(text, { lang })))).toEqual(expected);
  });

  it("shows blood pressure over the days as one card, systolic above diastolic", () => {
    const [trend] = decideShow(input("how has my blood pressure been lately?"));
    expect(trend).toMatchObject({ kind: "trend", vital: { key: "bp_systolic" }, second: { key: "bp_diastolic" } });
    expect(decideShow(input("даралтын сүүлийн 14 хоногийн график харуул", { lang: "mn" }))).toHaveLength(1);
  });

  it("shows several values in the order they are named, at most three", () => {
    expect(ids(decideShow(input("how are my blood pressure and heart rate?")))).toEqual(["vital-bp_systolic", "ecg-heart_rate"]);
    const many = decideShow(input("show my sleep, mood, water, temperature and glucose"));
    expect(many).toHaveLength(MAX_SHOW_PANELS);
    expect(ids(many)).toEqual(["vital-sleep_hours", "vital-mood", "ring-water"]);
  });

  it("shows the body map (and the readiness ring after the check-in) for 'overall' / 'бүх үзүүлэлт'", () => {
    expect(kinds(decideShow(input("how is my body overall?", { state: "DONE" })))).toEqual(["body", "ring"]);
    expect(kinds(decideShow(input("бүх үзүүлэлтээ харуулаач", { lang: "mn", state: "DONE" })))).toEqual(["body", "ring"]);
    // during the check-in the score is not final yet: the body map alone
    expect(kinds(decideShow(input("show my body", { state: "KPI_CAPTURE" })))).toEqual(["body"]);
  });

  it("shows the body map next to a value when both are asked for", () => {
    expect(ids(decideShow(input("how is my heart rate? and show my body")))).toEqual(["ecg-heart_rate", "body"]);
    expect(ids(decideShow(input("миний даралт ямар байна? биеэ харуулаач", { lang: "mn" })))).toEqual(["vital-bp_systolic", "body"]);
  });

  it("shows nothing for words that are not about a value, or that only tell something", () => {
    expect(decideShow(input("Hi Cosmo"))).toEqual([]);
    expect(decideShow(input("Сайн уу", { lang: "mn" }))).toEqual([]);
    expect(decideShow(input("I slept well, thanks", { state: "SMALL_TALK" }))).toEqual([]);
    expect(decideShow(input("how fast is the station going?"))).toEqual([]);
  });

  it("after the check-in any mention of a value counts as asking", () => {
    expect(ids(decideShow(input("sleep", { state: "DONE" })))).toEqual(["vital-sleep_hours"]);
  });

  it("shows nothing while the summary is computed (the dashboard opens)", () => {
    expect(decideShow(input("how is my heart rate?", { summary: true, recorded: ["heart_rate"] }))).toEqual([]);
  });

  it("names the topics in text order and keeps 'body temperature' about temperature", () => {
    expect(showTopics("my heart rate and my sleep")).toEqual(["heart", "sleep"]);
    expect(showTopics("what is my body temperature")).toEqual(["temperature"]);
    expect(showTopics("цусны даралт")).toEqual(["bp"]);
    expect(showTopics("цусны шинжилгээ")).toEqual(["signature"]);
  });

  it("does not take heartburn for the heart", () => {
    expect(showTopics("I have heartburn")).toEqual([]);
    expect(decideShow(input("I have heartburn", { state: "DONE" }))).toEqual([]);
    expect(showTopics("my heart beat fast")).toEqual(["heart"]);
  });

  it("the Signature card opens the crew member's own linked reference panel", () => {
    expect(decideShow(input("what does my blood panel say?", { crewId: "bat" }))).toEqual([
      { kind: "signature", id: "signature", reference: "C001" },
    ]);
    expect(decideShow(input("what does my blood panel say?", { crewId: "mira" }))[0]).toMatchObject({ reference: "C004" });
    // a crew member without a linked panel: no reference, the page picks its default
    expect(decideShow(input("what does my blood panel say?", { crewId: "someone-else" }))).toEqual([{ kind: "signature", id: "signature" }]);
    expect(parseShowPanels([{ kind: "signature", id: "signature", reference: "C002" }])).toEqual([
      { kind: "signature", id: "signature", reference: "C002" },
    ]);
    expect(parseShowPanels([{ kind: "signature", id: "signature", reference: "../x" }])).toEqual([{ kind: "signature", id: "signature" }]);
  });

  it("recognises asking and 'show' in both languages", () => {
    expect(asksToSee("show my pulse", "en")).toBe(true);
    expect(asksToSee("пульсаа харуул", "mn")).toBe(true);
    expect(asksToSee("даралт ямар байна", "mn")).toBe(true);
    expect(asksToSee("my pulse is 70", "en")).toBe(false);
  });
});

describe("a value recorded this turn gets its own card", () => {
  it.each<[KpiKey[], string[]]>([
    [["heart_rate"], ["ecg-heart_rate"]],
    [["water_ml"], ["ring-water"]],
    [["bp_systolic", "bp_diastolic"], ["vital-bp_systolic"]],
    [["symptom_headache", "symptom_dizziness", "symptom_nausea"], ["vital-symptom_headache"]],
    [["sleep_hours"], ["vital-sleep_hours"]],
    [["day_note"], []],
  ])("%j", (recorded, expected) => {
    const panels = decideShow(input("whatever was said", { recorded }));
    expect(ids(panels)).toEqual(expected);
    for (const p of panels) expect("recorded" in p && p.recorded).toBe(true);
  });

  it("puts the recorded card first and does not repeat it for a question in the same words", () => {
    expect(ids(decideShow(input("72, is my heart rate normal?", { recorded: ["heart_rate"] })))).toEqual(["ecg-heart_rate"]);
  });
});

describe("every number in a panel comes from the data", () => {
  it("today's value, the 14 past days and the personal baseline", () => {
    const [ecg] = decideShow(input("how is my heart rate?"));
    if (ecg.kind !== "ecg") throw new Error("expected the ECG card");
    const base = computeBaselines(history()).heart_rate!;
    expect(ecg.vital.value).toBe(72);
    expect(ecg.vital.history).toEqual(history().map((d) => d.values.heart_rate));
    expect(ecg.vital.mean).toBeCloseTo(base.mean!, 6);
    expect(ecg.vital.rangeText?.en).toMatch(/demo parameter/);
  });

  it("the water ring uses the dashboard's demo target", () => {
    const [ring] = decideShow(input("how much water?"));
    expect(ring).toMatchObject({ kind: "ring", metric: "water", value: 1500, max: 2000 });
  });

  it("never invents SpO2: the ring has no value", () => {
    const [ring] = decideShow(input("what is my SpO2?"));
    expect(ring).toMatchObject({ kind: "ring", metric: "spo2", value: null, status: "no_data" });
  });

  it("skips a value with no data at all, and a trend without history", () => {
    expect(decideShow(input("how is my heart rate?", { values: {}, history: [] }))).toEqual([]);
    // a trend needs at least two past days; without them the plain card is shown
    expect(ids(decideShow(input("sleep trend", { history: history().slice(0, 1), state: "DONE" })))).toEqual(["vital-sleep_hours"]);
  });

  it("the body map carries every body key", () => {
    const [body] = decideShow(input("show my body"));
    if (body.kind !== "body") throw new Error("expected the body map");
    expect(body.vitals.map((v) => v.key)).toEqual([...BODY_KEYS]);
  });
});

describe("the show event on the wire", () => {
  it("round-trips through the SSE parser and the reducer", () => {
    const event = showEvent(input("how is my heart rate and my water?"))!;
    const parsed = parseTurnEvent({ event: "message", data: JSON.stringify(event), id: null });
    expect(parsed).toEqual(event);

    let state = checkInReducer(initialCheckInState(), { type: "TURN_EVENT", event: parsed! });
    expect(state.show?.panels).toEqual(event.panels);
    const seq = state.show!.seq;
    state = checkInReducer(state, { type: "TURN_EVENT", event: parsed! });
    expect(state.show!.seq).toBeGreaterThan(seq);
    // the next question clears them; so does the close button
    expect(checkInReducer(state, { type: "SEND_START", text: "next" }).show).toBeNull();
    expect(checkInReducer(state, { type: "DISMISS_SHOW" }).show).toBeNull();
  });

  it("drops panels the screen cannot draw", () => {
    expect(
      parseShowPanels([
        { kind: "nope", id: "x" },
        { kind: "vital", id: "v", vitals: [{ key: "not_a_key" }] },
        { kind: "ring", id: "r", metric: "water", value: 3, max: 0 },
        { kind: "labs", id: "labs" },
      ]),
    ).toEqual([{ kind: "labs", id: "labs" }]);
    expect(parseTurnEvent({ event: "message", data: JSON.stringify({ type: "show", panels: [] }), id: null })).toBeNull();
  });
});

describe("drawing helpers", () => {
  it("draws one PQRST complex per beat inside the box", () => {
    const d = ecgPath(200, 40, 3);
    expect(d.startsWith("M0 ")).toBe(true);
    expect(d.match(/[ML]/g)).toHaveLength(39);
    for (const [, x, y] of d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
      expect(Number(x)).toBeGreaterThanOrEqual(0);
      expect(Number(x)).toBeLessThanOrEqual(200);
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(y)).toBeLessThanOrEqual(40);
    }
  });

  it("paces the trace from the pulse, within bounds", () => {
    expect(beatSeconds(60)).toBe(1);
    expect(beatSeconds(120)).toBe(0.5);
    expect(beatSeconds(250)).toBe(0.4);
    expect(beatSeconds(20)).toBe(1.5);
    expect(beatSeconds(null)).toBe(1);
  });

  it("anchors every callout on the figure", () => {
    for (const c of BODY_CALLOUTS) {
      for (const n of [c.x, c.y, c.labelY]) {
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThan(1);
      }
    }
  });
});

/* ───────────── through the real turn pipeline ───────────── */

describe("the turn pipeline emits the show event", () => {
  beforeEach(async () => {
    setClockForTests(TEST_TODAY);
    await freshSeededDb();
  });
  afterEach(() => setClockForTests(null));

  const START: Record<Lang, string[]> = { en: ["Hi Cosmo", "let's start"], mn: ["Сайн уу", "эхэлье"] };
  const SLEEP: Record<Lang, string> = { en: "6.5 hours", mn: "6 цаг хагас" };
  const ASK: Record<Lang, string> = { en: "How did I sleep over the past two weeks?", mn: "Сүүлийн 14 хоногийн нойр ямар байна?" };

  it.each<Lang>(["en", "mn"])("a recorded value and a question asked back (%s)", async (lang) => {
    const id = await startCheckIn("bat", lang);
    for (const line of START[lang]) await playTurn("bat", id, line);

    const answered = await playTurn("bat", id, SLEEP[lang]);
    const [shown] = eventsOf(answered, "show");
    expect(shown.panels.map((p) => p.id)).toEqual(["vital-sleep_hours"]);
    expect(shown.panels[0]).toMatchObject({ kind: "vital", recorded: true, vitals: [{ key: "sleep_hours", value: 6.5 }] });
    // after the words, before the timing
    const types = answered.map((e) => e.type);
    expect(types.indexOf("show")).toBeGreaterThan(types.indexOf("assistant"));
    expect(types.indexOf("show")).toBeLessThan(types.indexOf("timing"));

    const asked = await playTurn("bat", id, ASK[lang]);
    const [trend] = eventsOf(asked, "show");
    expect(trend.panels[0]).toMatchObject({ kind: "trend", vital: { key: "sleep_hours", value: 6.5 } });
    if (trend.panels[0].kind !== "trend") throw new Error("expected a trend");
    expect(trend.panels[0].vital.history.length).toBeGreaterThanOrEqual(2);
  });

  it("a blood-panel question links to the crew member's own reference panel", async () => {
    const id = await startCheckIn("bat", "en");
    for (const line of START.en) await playTurn("bat", id, line);
    const [shown] = eventsOf(await playTurn("bat", id, "what does my blood panel say?"), "show");
    expect(shown.panels).toContainEqual({ kind: "signature", id: "signature", reference: "C001" });
  });

  it("small talk without a value shows nothing", async () => {
    const id = await startCheckIn("bat", "en");
    const events = await playTurn("bat", id, "I'm doing well, thanks");
    expect(eventsOf(events, "show")).toEqual([]);
  });

  it("keeps the state machine where it was (a question about a value does not count as an answer)", async () => {
    const id = await startCheckIn("bat", "en");
    for (const line of START.en) await playTurn("bat", id, line);
    const events = await playTurn("bat", id, "what is my heart rate usually?");
    expect(eventsOf(events, "state")[0]).toMatchObject({ state: "KPI_CAPTURE" as ConversationState, expectedQuestion: "sleep" });
    expect(eventsOf(events, "measurement")).toEqual([]);
  });
});
