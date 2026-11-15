import fs from "node:fs";
import path from "node:path";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name) as string } : undefined),
    set: (opts: { name: string; value: string }) => void mocks.jar.set(opts.name, opts.value),
    delete: (name: string) => void mocks.jar.delete(name),
  }),
}));

import type { KpiKey, Lang, MeasurementValue, TurnEvent } from "@/lib/types";
import type { HistoryDay } from "@/lib/health/baseline";
import { computeBaselines } from "@/lib/health";
import { formatNumber } from "@/lib/health/format";
import { GLUCOSE_MGDL, VITAL_SIGNS } from "@/lib/health/vitalReference";
import { KPI_DEFS, getQuestion } from "@/lib/kpi/registry";
import { DISCLAIMER } from "@/lib/health/summary";
import { MAX_EXPLAIN_BEATS, explainTurnText, parseExplainEvent, turnPart, type ExplainEvent, type Storyboard } from "@/lib/explain";
import { allowedNumerals, buildStoryboard, explainIntent, isSaneCaption, topicKeys, type StoryboardInput } from "@/server/agent/explain";
import { parseTurnEvent } from "@/components/checkin/sse";
import { checkInReducer, initialCheckInState } from "@/components/checkin/state";
import { chartGeometry } from "@/components/explain/geometry";
import { ExplainerStage } from "@/components/explain/ExplainerStage";
import { I18nProvider } from "@/i18n/I18nProvider";
import { GET as getAudio } from "@/app/api/checkins/[id]/turns/[turnId]/audio/route";
import { DEMO_SCRIPTS } from "@/server/agent/scripts";
import { setClockForTests } from "@/server/clock";
import { listTurns } from "@/server/db/repos/turn";
import { setSessionCookie } from "@/server/session";
import { demoAudioFileName } from "@/server/speech/tts";
import { eventsOf, playTurn, startCheckIn, ctxOf } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

/* ───────────── data ───────────── */

/** 14 confirmed past days with gently varying values (oldest first) */
function history(days = 14): HistoryDay[] {
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-10-${String(31 - days + i).padStart(2, "0")}`,
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
      symptom_headache: i === 3 ? 1 : 0,
      symptom_dizziness: 0,
      symptom_nausea: 0,
    },
  }));
}

/** a day with a danger value (pulse 140), a low sleep (personal), low water (demo range) and a headache */
const BUSY_DAY: Partial<Record<KpiKey, MeasurementValue>> = {
  heart_rate: 140,
  sleep_hours: 5,
  bp_systolic: 118,
  bp_diastolic: 76,
  temperature_c: 36.7,
  water_ml: 1200,
  glucose_mgdl: 94,
  mood: 4,
  exercise_min: 45,
  vision_check: 0,
  workload: 2,
  symptom_headache: 1,
  symptom_dizziness: 0,
  symptom_nausea: 0,
};

/** a steady day: everything like the history */
const STEADY_DAY: Partial<Record<KpiKey, MeasurementValue>> = {
  heart_rate: 66,
  sleep_hours: 7.5,
  bp_systolic: 117,
  bp_diastolic: 75,
  temperature_c: 36.6,
  water_ml: 2100,
  glucose_mgdl: 93,
  mood: 4,
  exercise_min: 45,
  vision_check: 0,
  workload: 2,
  symptom_headache: 0,
  symptom_dizziness: 0,
  symptom_nausea: 0,
};

function board(over: Partial<StoryboardInput> = {}): Storyboard {
  const b = buildStoryboard({ intent: "summary", values: BUSY_DAY, history: history(), final: true, ...over });
  if (!b) throw new Error("expected a storyboard");
  return b;
}

const ids = (b: Storyboard) => b.beats.map((x) => x.id);
const kinds = (b: Storyboard) => b.beats.map((x) => x.panel.kind);

/**
 * Every number the data allows, computed here independently of the builder: today's values, the past days, the
 * baselines (rounded), the general reference and the demo thresholds, the day counts.
 */
function dataNumbers(values: Partial<Record<KpiKey, MeasurementValue>>, past: HistoryDay[]): Set<string> {
  const nums: number[] = [];
  for (const v of Object.values(values)) if (typeof v === "number") nums.push(v);
  for (const d of past) for (const v of Object.values(d.values)) if (typeof v === "number") nums.push(v);
  for (const b of Object.values(computeBaselines(past))) if (b?.mean != null) nums.push(b.mean);
  for (const s of Object.values(VITAL_SIGNS)) for (const n of [s.normalLow, s.normalHigh, s.dangerAbove, s.dangerBelow]) if (n !== null) nums.push(n);
  nums.push(...Object.values(GLUCOSE_MGDL));
  for (const def of Object.values(KPI_DEFS)) {
    const th = def.thresholds;
    for (const n of [th?.low?.yellow, th?.high?.yellow, def.max]) if (typeof n === "number") nums.push(n);
  }
  for (let i = 0; i <= 100; i++) nums.push(i); // day counts, readiness, value counts, "out of 5" / "100"
  return allowedNumerals(nums);
}

const NUMERAL = /\d+(?:[.,]\d+)?/g;

/* ───────────── what the words ask ───────────── */

describe("which words ask for a walkthrough", () => {
  it.each<[string, "today" | "before" | "why"]>([
    ["How am I today?", "today"],
    ["how am I doing", "today"],
    ["Walk me through my results", "today"],
    ["Өнөөдөр ямар байна?", "today"],
    ["би өнөөдөр ямар байна", "today"],
    ["Миний бие ямар байна?", "today"],
    ["Was it like this before?", "before"],
    ["has it always been like this?", "before"],
    ["is this usual for me?", "before"],
    ["Өмнө нь ийм байсан уу?", "before"],
    ["урьд нь ингэж байсан уу", "before"],
    ["Why do I feel so tired?", "why"],
    ["what could be behind how I feel?", "why"],
    ["Яагаад ядраад байна?", "why"],
    ["яагаад толгой өвдөөд байна", "why"],
  ])("%s -> %s", (text, intent) => {
    expect(explainIntent(text)).toBe(intent);
  });

  it.each([
    "How are you today?",
    "Та өнөөдөр ямар байна?",
    "how is my sleep today?",
    "why?",
    "why do you ask?",
    "I slept 7 hours",
    "Сайн уу",
    "how fast is the station going?",
  ])("not for %s", (text) => {
    expect(explainIntent(text)).toBeNull();
  });

  it("names the values the words are about", () => {
    expect(topicKeys("was my sleep like this before?")).toEqual(["sleep_hours"]);
    expect(topicKeys("миний даралт өмнө нь ийм байсан уу")).toEqual(["bp_systolic"]);
  });
});

/* ───────────── the storyboard ───────────── */

describe("the storyboard", () => {
  it("after the summary: checking, the notable values most serious first, the grid, the actions", () => {
    const b = board();
    expect(b.intent).toBe("summary");
    expect(kinds(b)[0]).toBe("checking");
    expect(kinds(b).slice(-2)).toEqual(["grid", "actions"]);
    // pulse 140 is past the urgent threshold (danger), before the low sleep, the low water and the headache
    expect(ids(b)[1]).toBe("item-heart_rate");
    expect(ids(b).filter((x) => x.startsWith("item-"))).toHaveLength(3);
    const hr = b.beats[1].panel;
    expect(hr).toMatchObject({ kind: "chart", flag: "danger", direction: "high", status: "red" });
    expect(b.beats.length).toBeLessThanOrEqual(MAX_EXPLAIN_BEATS);
  });

  it("every number comes from the data, in both languages", () => {
    const past = history();
    const allowed = dataNumbers(BUSY_DAY, past);
    for (const intent of ["summary", "today", "before", "why"] as const) {
      const b = buildStoryboard({ intent, values: BUSY_DAY, history: past, final: true, topics: intent === "before" ? ["sleep_hours"] : [] })!;
      for (const beat of b.beats) {
        for (const lang of ["en", "mn"] as const) {
          for (const n of beat.caption[lang].match(NUMERAL) ?? []) {
            expect(allowed.has(n.replace(",", ".")), `${intent}/${beat.id}/${lang}: ${n} in "${beat.caption[lang]}"`).toBe(true);
          }
        }
      }
    }
  });

  it("the chart carries the person's own days, today, the personal band and the general range", () => {
    const past = history();
    const b = board();
    const sleep = b.beats.find((x) => x.id === "item-sleep_hours")!.panel;
    if (sleep.kind !== "chart") throw new Error("expected a chart");
    expect(sleep.series[0].points.map((p) => p.value)).toEqual(past.map((d) => d.values.sleep_hours));
    expect(sleep.series[0].today).toBe(5);
    const base = computeBaselines(past).sleep_hours!;
    const sd = Math.max(base.sd!, KPI_DEFS.sleep_hours.sdFloor ?? 0);
    expect(sleep.personal!.low).toBeCloseTo(base.mean! - 2 * sd, 1);
    expect(sleep.personal!.high).toBeCloseTo(base.mean! + 2 * sd, 1);
    // sleep has no general reference: the demo range, labelled as such
    expect(sleep.normal).toMatchObject({ source: "demo", low: 7 });
    const hr = b.beats.find((x) => x.id === "item-heart_rate")!.panel;
    expect(hr).toMatchObject({ normal: { source: "general", low: 60, high: 100 } });
  });

  it("both languages say the same beats; Mongolian in Cyrillic, English without", () => {
    for (const beat of board().beats) {
      expect(beat.caption.en.trim().length).toBeGreaterThan(10);
      expect(beat.caption.mn.trim().length).toBeGreaterThan(10);
      expect(beat.caption.en).not.toMatch(/\p{Script=Cyrillic}/u);
      expect(beat.caption.mn).toMatch(/\p{Script=Cyrillic}/u);
    }
  });

  it("the danger value says to measure again and tell the crew medical officer; the actions end with the disclaimer", () => {
    const b = board();
    expect(b.beats[1].caption.en).toMatch(/urgent level of 130 beats per minute/);
    expect(b.beats[1].caption.en).toMatch(/medical officer/);
    expect(b.beats[1].caption.mn).toMatch(/эмнэлгийн офицер/);
    const actions = b.beats[b.beats.length - 1];
    if (actions.panel.kind !== "actions") throw new Error("expected the actions");
    expect(actions.panel.actions.map((a) => a.id).slice(0, 2)).toEqual(["remeasure", "tell_cmo"]);
    expect(actions.caption.en.endsWith(DISCLAIMER.en)).toBe(true);
    expect(actions.caption.mn.endsWith(DISCLAIMER.mn)).toBe(true);
    expect(actions.caption.en).toMatch(/Contact Mission Control/);
  });

  it("a red day raises the alert notice in the actions", () => {
    const b = board();
    const actions = b.beats.find((x) => x.panel.kind === "actions")!;
    expect(actions.panel).toMatchObject({ alert: true });
    expect(actions.caption.en).toMatch(/crew medical officer and ground are being informed/);
  });

  it("never names a condition, a drug or a treatment", () => {
    for (const intent of ["summary", "why"] as const) {
      for (const beat of buildStoryboard({ intent, values: BUSY_DAY, history: history(), final: true })!.beats) {
        for (const lang of ["en", "mn"] as const) {
          expect(beat.caption[lang]).not.toMatch(/prescri|medicat|dosage|treatment|insomnia|dehydrat|tachycard|hypert|migraine/iu);
        }
      }
    }
  });

  it("a steady day: no value beats, the grid says nothing stands out", () => {
    const b = buildStoryboard({ intent: "summary", values: STEADY_DAY, history: history(), final: true })!;
    expect(kinds(b)).toEqual(["checking", "grid", "actions"]);
    expect(b.beats[1].caption.en).toMatch(/Nothing stands out today/);
    expect(b.beats[1].caption.mn).toMatch(/онцгой зүйл алга/);
  });

  it("'was it like this before?' compares today with the past days of the value named", () => {
    const b = buildStoryboard({ intent: "before", values: BUSY_DAY, history: history(), final: true, topics: ["sleep_hours"] })!;
    // the pulse of 140 is urgent, so the actions come too, even for this question
    expect(ids(b)).toEqual(["item-sleep_hours", "actions"]);
    expect(b.beats[0].caption.en).toMatch(/In the last 14 days your sleep ranged from 7 hours to 8 hours\. It has not been this low on any of those days\./);
    expect(b.beats[0].caption.mn).toMatch(/Сүүлийн 14 хоногт/);
    // a usual value: within its range
    const steady = buildStoryboard({ intent: "before", values: STEADY_DAY, history: history(), final: true, topics: ["heart_rate"] })!;
    expect(steady.beats[0].caption.en).toMatch(/sits within that range/);
  });

  it("'why do I feel tired?' links the values to the feeling gently, then the actions", () => {
    const b = buildStoryboard({ intent: "why", values: { ...STEADY_DAY, sleep_hours: 5 }, history: history(), final: false })!;
    expect(ids(b)).toContain("item-sleep_hours");
    expect(b.beats.find((x) => x.id === "item-sleep_hours")!.caption.en).toMatch(/often goes with feeling tired/);
    expect(kinds(b)[kinds(b).length - 1]).toBe("actions");
    const calm = buildStoryboard({ intent: "why", values: STEADY_DAY, history: history(), final: false })!;
    expect(ids(calm)).toContain("note-nothing");
  });

  it("mid check-in: no actions unless something is urgent", () => {
    const partial = { sleep_hours: 7.5, mood: 4 } as Partial<Record<KpiKey, MeasurementValue>>;
    const b = buildStoryboard({ intent: "today", values: partial, history: history(), final: false })!;
    expect(kinds(b)).toEqual(["checking", "grid"]);
    expect(b.beats[0].caption.en).toMatch(/the 2 values from today/);
    const urgent = buildStoryboard({ intent: "today", values: { heart_rate: 140 }, history: history(), final: false })!;
    expect(kinds(urgent)).toContain("actions");
  });

  it("no history: compared with general ranges, no personal band; 'before' says there are no earlier days", () => {
    const b = buildStoryboard({ intent: "summary", values: BUSY_DAY, history: [], final: true })!;
    expect(b.beats[0].caption.en).toMatch(/with general ranges/);
    const hr = b.beats.find((x) => x.id === "item-heart_rate")!.panel;
    expect(hr).toMatchObject({ kind: "chart", personal: null });
    if (hr.kind === "chart") expect(hr.series[0].points).toEqual([]);
    const before = buildStoryboard({ intent: "before", values: BUSY_DAY, history: [], final: true })!;
    expect(ids(before)[0]).toBe("note-no-history");
  });

  it("nothing to explain: null", () => {
    expect(buildStoryboard({ intent: "summary", values: {}, history: [], final: true })).toBeNull();
    expect(buildStoryboard({ intent: "today", values: {}, history: history(), final: false })).toBeNull();
    expect(buildStoryboard({ intent: "why", values: {}, history: history(), final: false })).toBeNull();
    expect(buildStoryboard({ intent: "before", values: {}, history: [], final: false })).toBeNull();
    // nothing today, nothing named: nothing to compare
    expect(buildStoryboard({ intent: "before", values: {}, history: history(), final: false })).toBeNull();
    // but a named value with past days is compared
    expect(ids(buildStoryboard({ intent: "before", values: {}, history: history(), final: false, topics: ["sleep_hours"] })!)).toEqual(["item-sleep_hours"]);
  });
});

describe("the caption gate", () => {
  const allowed = allowedNumerals([72, 7.14]);
  it("allows the data's numbers in any rounding, and the disclaimer", () => {
    expect(isSaneCaption(`Your pulse is 72, usual 7.1. ${DISCLAIMER.en}`, allowed, "en")).toBe(true);
    expect(isSaneCaption(`Пульс 72. ${DISCLAIMER.mn}`, allowed, "mn")).toBe(true);
  });
  it("refuses a number from nowhere, an emoji, a drug or a treatment word", () => {
    expect(isSaneCaption("Your pulse is 73.", allowed, "en")).toBe(false);
    expect(isSaneCaption("Your pulse is 72 \u{1F600}", allowed, "en")).toBe(false);
    expect(isSaneCaption("Take some melatonin.", allowed, "en")).toBe(false);
    expect(isSaneCaption("This needs treatment.", allowed, "en")).toBe(false);
    expect(isSaneCaption("", allowed, "en")).toBe(false);
  });
});

/* ───────────── on the wire ───────────── */

function eventOf(b: Storyboard, lang: Lang, resume: string | null = null): ExplainEvent {
  const beats = b.beats.map((x, i) => ({ id: x.id, part: i, caption: x.caption[lang], panel: x.panel }));
  return { type: "explain", intent: b.intent, turnId: "turn-1", language: lang, beats, resume: resume ? { part: beats.length, text: resume } : null };
}

describe("the explain event", () => {
  it("round-trips through the SSE parser; the reducer leaves the conversation as it is", () => {
    const event = eventOf(board(), "en", "How many hours did you sleep?");
    const parsed = parseTurnEvent({ event: "message", data: JSON.stringify(event), id: null });
    expect(parsed).toEqual(event);
    const state = initialCheckInState();
    expect(checkInReducer(state, { type: "TURN_EVENT", event: parsed! })).toBe(state);
  });

  it("drops what the screen cannot draw", () => {
    const parsed = parseExplainEvent({
      turnId: "t",
      intent: "today",
      language: "mn",
      beats: [
        { id: "a", part: 0, caption: "x", panel: { kind: "nope" } },
        { id: "b", part: 1, caption: "", panel: { kind: "note", tone: "calm" } },
        { id: "c", part: 2, caption: "ok", panel: { kind: "chart", key: "not_a_key", series: [] } },
        { id: "d", part: 3, caption: "ok", panel: { kind: "note", tone: "calm" } },
      ],
    });
    expect(parsed?.beats.map((b) => [b.id, b.part])).toEqual([["d", 3]]);
    expect(parseExplainEvent({ turnId: "t", beats: [] })).toBeNull();
    expect(parseExplainEvent({ beats: [{ id: "d", caption: "ok", panel: { kind: "note" } }] })).toBeNull();
  });

  it("one stored turn, one caption per line", () => {
    const text = explainTurnText([{ caption: "One.\nstill one" }, { caption: "Two." }], "Three?");
    expect(text.split("\n")).toEqual(["One. still one", "Two.", "Three?"]);
    expect(turnPart(text, 1)).toBe("Two.");
    expect(turnPart(text, 3)).toBeNull();
    expect(turnPart(text, -1)).toBeNull();
  });
});

describe("chart geometry", () => {
  it("puts today last, the band and the range inside the box", () => {
    const panel = board().beats.find((x) => x.id === "item-sleep_hours")!.panel;
    if (panel.kind !== "chart") throw new Error("expected a chart");
    const g = chartGeometry(panel, 640, 240, 1);
    expect(g.series[0].dots).toHaveLength(14);
    expect(g.series[0].today?.x).toBe(g.xToday);
    expect(g.series[0].dots.every((d) => d.x < g.xToday)).toBe(true);
    expect(g.personal!.top).toBeLessThan(g.personal!.bottom);
    for (const y of [g.personal!.top, g.personal!.bottom, g.series[0].today!.y]) {
      expect(y).toBeGreaterThanOrEqual(g.top);
      expect(y).toBeLessThanOrEqual(g.bottom);
    }
  });
});

/* ───────────── server render of the stage ───────────── */

const Provider = I18nProvider as unknown as ComponentType<{ initialLang: Lang; children?: ReactNode }>;
const render = (node: ReactNode, lang: Lang = "en") => renderToStaticMarkup(createElement(Provider, { initialLang: lang }, node));
const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function stage(event: ExplainEvent, step: number, lang: Lang = "en", extra: Record<string, unknown> = {}) {
  return render(
    createElement(ExplainerStage, {
      explain: event,
      checkInId: "c1",
      initialStep: step,
      autoPlay: false,
      onClose: () => {},
      onContactGround: () => {},
      onOpenGuide: () => {},
      ...extra,
    }),
    lang,
  );
}

describe("the stage, server-rendered", () => {
  const b = board();

  it("a dialog with the caption in a live region, the controls and the footer (en + mn)", () => {
    const html = stage(eventOf(b, "en"), 0);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-panel="checking"');
    expect(html).toMatch(/aria-live="polite"[^>]*>Your check-in is saved/);
    for (const label of ["Previous step", "Play", "Next step", "Close the walkthrough"]) expect(html).toContain(label);
    expect(html).toContain("Step 1 of");
    expect(html).toContain("not a diagnosis");
    expect(html).toContain("url(/visuals/space-earth.png)");
    const mn = stage(eventOf(b, "mn"), 0, "mn");
    expect(mn).toContain("Таны бүртгэл хадгалагдлаа");
    expect(mn).toContain("онош биш");
    expect(mn).toContain("Өмнөх алхам");
  });

  it("a chart beat: the person's line, the band, the normal range, today highlighted with a pill", () => {
    const step = ids(b).indexOf("item-sleep_hours");
    const html = stage(eventOf(b, "en"), step);
    expect(html).toContain('data-panel="chart"');
    expect(html).toContain('data-slot="explainer-band"');
    expect(html).toContain('data-slot="explainer-normal"');
    expect(html).toContain('data-slot="explainer-today"');
    // 5 hours is under the demo range's 7 (a yellow status by the fixed range, before any baseline rule)
    expect(strip(html)).toContain("Below the demo range");
    expect(strip(html)).toContain("Personal baseline · Sleep");
    expect(strip(html)).toContain("Demo range");
    expect(stage(eventOf(b, "mn"), step, "mn")).toContain("Демо мужаас доош");
  });

  it("the grid: one round chip per vital, the flagged ones marked", () => {
    const step = ids(b).indexOf("grid");
    const html = stage(eventOf(b, "en"), step);
    expect(html.match(/data-chip="/g)).toHaveLength(13);
    expect(html).toContain('data-chip="heart_rate" data-status="red"');
    expect(html).toContain("url(/visuals/body-front.png)");
  });

  it("the actions: numbered steps, Contact Mission Control, the guide, the dashboard button after the summary", () => {
    const step = b.beats.length - 1;
    const html = stage(eventOf(b, "en"), step, "en", { onOpenDashboard: () => {} });
    expect(html).toContain('data-panel="actions"');
    expect(strip(html)).toContain("Measure again to confirm");
    expect(html).toContain('data-slot="explainer-contact"');
    expect(html).toContain("Open full dashboard");
    expect(strip(html)).toContain("Alert raised");
    const mn = stage(eventOf(b, "mn"), step, "mn");
    expect(mn).toContain("Нислэгийн удирдлагатай холбогдох");
    expect(mn).not.toContain("Open full dashboard");
  });
});

/* ───────────── through the real turn pipeline ───────────── */

describe("the turn pipeline", () => {
  beforeEach(async () => {
    setClockForTests(TEST_TODAY);
    await freshSeededDb();
    mocks.jar.clear();
  });
  afterEach(() => setClockForTests(null));

  it.each<Lang>(["en", "mn"])("after the summary the walkthrough is sent, stored as one Cosmo turn (%s)", async (lang) => {
    const id = await startCheckIn("bat", lang);
    let last: TurnEvent[] = [];
    for (const line of DEMO_SCRIPTS[lang].lines) last = await playTurn("bat", id, line.say);
    const [summary] = eventsOf(last, "summary");
    const [explain] = eventsOf(last, "explain");
    expect(summary).toBeDefined();
    expect(explain).toBeDefined();
    const types = last.map((e) => e.type);
    expect(types.indexOf("explain")).toBeGreaterThan(types.indexOf("summary"));
    expect(types.indexOf("explain")).toBeLessThan(types.indexOf("timing"));
    expect(explain.intent).toBe("summary");
    expect(explain.language).toBe(lang);
    expect(explain.beats[0].panel.kind).toBe("checking");
    expect(explain.beats[explain.beats.length - 1].panel.kind).toBe("actions");
    const turn = (await listTurns("bat", id)).find((t) => t.id === explain.turnId);
    expect(turn?.speaker).toBe("cosmo");
    expect(turn?.text.split("\n")).toEqual(explain.beats.map((b) => b.caption));
    // the summary itself is unchanged (the dashboard's replay button and the scripted demo audio)
    expect(summary.summary.spoken.text).toContain(summary.summary.disclaimer[lang]);
  });

  it("'how am I today?' mid check-in: the walkthrough, then the open question again; nothing recorded or moved", async () => {
    const id = await startCheckIn("bat", "en");
    for (const line of ["Hi Cosmo", "let's start", "6.5 hours", "4"]) await playTurn("bat", id, line);
    const before = await ctxOf("bat", id);
    const events = await playTurn("bat", id, "How am I today?");
    const [explain] = eventsOf(events, "explain");
    expect(explain).toBeDefined();
    expect(explain.intent).toBe("today");
    expect(eventsOf(events, "measurement")).toEqual([]);
    const [state] = eventsOf(events, "state");
    expect(state).toMatchObject({ state: "KPI_CAPTURE", expectedQuestion: before.state === "KPI_CAPTURE" ? expect.any(String) : null });
    const prompt = getQuestion(state.expectedQuestion!).prompts.en;
    expect(explain.resume).toEqual({ part: explain.beats.length, text: prompt });
    const [assistant] = eventsOf(events, "assistant");
    expect(assistant.turnId).toBe(explain.turnId);
    expect(assistant.text.split("\n").pop()).toBe(prompt);
    expect(await ctxOf("bat", id)).toEqual(before);
    // and the check-in goes on: the next answer is recorded for the same question
    const next = await playTurn("bat", id, "no symptoms");
    expect(eventsOf(next, "explain")).toEqual([]);
  });

  it("'өмнө нь ийм байсан уу?' after the check-in compares with the past days (mn)", async () => {
    const id = await startCheckIn("bat", "mn");
    for (const line of DEMO_SCRIPTS.mn.lines) await playTurn("bat", id, line.say);
    const events = await playTurn("bat", id, "Нойр өмнө нь ийм байсан уу?");
    const [explain] = eventsOf(events, "explain");
    expect(explain?.intent).toBe("before");
    expect(explain.beats[0].id).toBe("item-sleep_hours");
    expect(explain.beats[0].caption).toMatch(/Сүүлийн \d+ хоногт/);
    expect(explain.resume).toBeNull();
  });

  it("asking Cosmo how she is, or giving a value, runs the turn as usual", async () => {
    const id = await startCheckIn("bat", "en");
    expect(eventsOf(await playTurn("bat", id, "How are you today?"), "explain")).toEqual([]);
    for (const line of ["let's start"]) await playTurn("bat", id, line);
    const answered = await playTurn("bat", id, "why am I so tired, I slept 5 hours");
    expect(eventsOf(answered, "explain")).toEqual([]);
    expect(eventsOf(answered, "measurement").map((m) => m.key)).toContain("sleep_hours");
  });

  it("the audio route voices one line of the walkthrough turn (?part=n), and nothing past its end", async () => {
    await setSessionCookie({ role: "crew", crewId: "bat" });
    const id = await startCheckIn("bat", "en");
    for (const line of DEMO_SCRIPTS.en.lines) await playTurn("bat", id, line.say);
    const turn = (await listTurns("bat", id)).filter((t) => t.speaker === "cosmo").pop()!;
    const lines = turn.text.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    const dir = path.join(process.cwd(), "public", "demo", "audio");
    const file = path.join(dir, demoAudioFileName(lines[1], "en"));
    const existed = fs.existsSync(file);
    fs.mkdirSync(dir, { recursive: true });
    if (!existed) fs.writeFileSync(file, Buffer.from([0x49, 0x44, 0x33, 3, 0, 0]));
    const ctx = { params: Promise.resolve({ id, turnId: turn.id }) };
    try {
      const ok = await getAudio(new Request("http://localhost/x?part=1"), ctx);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toBe("audio/mpeg");
    } finally {
      if (!existed) fs.rmSync(file, { force: true });
    }
    expect((await getAudio(new Request(`http://localhost/x?part=${lines.length}`), ctx)).status).toBe(404);
    expect((await getAudio(new Request("http://localhost/x?part=abc"), ctx)).status).toBe(404);
  });

  it("a number in every caption on the wire is one the data allows (live storyboard of the demo day)", async () => {
    const id = await startCheckIn("bat", "en");
    let last: TurnEvent[] = [];
    for (const line of DEMO_SCRIPTS.en.lines) last = await playTurn("bat", id, line.say);
    const [explain] = eventsOf(last, "explain");
    for (const beat of explain.beats) {
      for (const n of beat.caption.match(NUMERAL) ?? []) expect(Number.isFinite(Number(n.replace(",", ".")))).toBe(true);
      expect(beat.caption).not.toMatch(/undefined|NaN|null/);
    }
    expect(formatNumber(1, 0)).toBe("1");
  });
});
