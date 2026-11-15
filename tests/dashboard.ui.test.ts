import { describe, expect, it } from "vitest";
import type { DashboardPayload, KpiKey, KpiStat, Lang, MeasurementValue } from "@/lib/types";
import { KPI_KEYS } from "@/lib/types";
import { KPI_DEFS } from "@/lib/kpi/registry";
import { dictionaries } from "@/i18n/dictionary";
import { AXIS_KEYS, HAZARD_KEYS, isReadinessAvailable } from "@/lib/health/scores";
import { SLOT_ORDER } from "@/lib/health/dayArc";
import { evaluateDay } from "@/lib/health";
import type { HistoryDay } from "@/lib/health/baseline";
import {
  DASHBOARD_FIXTURES,
  alexNoData,
  batYellow,
  miraRed,
  saraaGreen,
} from "@/lib/fixtures/dashboard";
import {
  BODY_HOTSPOTS,
  addMs,
  axisHazard,
  axisIndicators,
  axisKeys,
  buildKpiCards,
  wellbeingSummary,
  buildTimeline,
  cycleAxis,
  demoTarget,
  highlightKey,
  historySummary,
  recentBars,
  targetFraction,
  worstAxis,
  cardStatus,
  cardsRelatedToHazard,
  crewCardReadiness,
  displayValue,
  effectiveSd,
  formatClockLabel,
  formatClockUtc,
  formatDeltaText,
  isTaskRelated,
  nextSlot,
  readinessDelta,
  sortCardsForHazard,
  sparklineGeometry,
  staggerDelay,
  summaryAudioUrl,
  symptomDays,
  unitLabel,
  worstOf,
} from "@/components/dashboard/logic";
import {
  DELAY_OPTIONS,
  delayIdFor,
  delayLabelKey,
  delayMsFor,
  isDelayId,
  parseDelayId,
} from "@/components/earth/delay";
import { sortAlertsNewestFirst } from "@/components/earth/logic";

function stat(payload: DashboardPayload, key: KpiKey): KpiStat {
  const found = payload.kpis.find((k) => k.key === key);
  if (!found) throw new Error(`no stat for ${key}`);
  return found;
}

const text = (lang: Lang, key: string) => dictionaries[lang][key];

describe("delta text", () => {
  it("formats a low sleep value in English and Mongolian", () => {
    const sleep = stat(batYellow, "sleep_hours");
    expect(formatDeltaText(sleep, "en")).toEqual({ kind: "below", text: "1.7 h below your usual" });
    expect(formatDeltaText(sleep, "mn")).toEqual({ kind: "below", text: "Ердийнхөөс 1.7 цаг бага" });
  });

  it("formats integer keys without decimals and picks above / below from the sign", () => {
    const water = stat(batYellow, "water_ml");
    expect(formatDeltaText(water, "en").text).toBe("507 ml below your usual");
    expect(formatDeltaText(water, "mn").text).toBe("Ердийнхөөс 507 мл бага");
    const hr = { ...stat(batYellow, "heart_rate"), delta: 6.2, status: "yellow" as const };
    expect(formatDeltaText(hr, "en")).toEqual({ kind: "above", text: "6 bpm above your usual" });
    expect(formatDeltaText(hr, "mn")).toEqual({ kind: "above", text: "Ердийнхөөс 6 удаа/мин их" });
  });

  it("has no unit for scales", () => {
    const mood = { ...stat(batYellow, "mood"), delta: -0.6 };
    expect(formatDeltaText(mood, "en").text).toBe("0.6 below your usual");
    expect(formatDeltaText(mood, "mn").text).toBe("Ердийнхөөс 0.6 бага");
  });

  it("says 'at your usual' when the gap rounds to zero", () => {
    const hr = { ...stat(batYellow, "heart_rate"), delta: 0.3 };
    expect(formatDeltaText(hr, "en")).toEqual({ kind: "same", text: "At your usual" });
    expect(formatDeltaText(hr, "mn").kind).toBe("same");
  });

  it("says there is no baseline when there is none, and stays silent for booleans, categories, text and no data", () => {
    const noBaseline = { ...stat(batYellow, "heart_rate"), delta: null, baselineMean: null };
    expect(formatDeltaText(noBaseline, "en")).toEqual({
      kind: "none",
      text: "No personal baseline yet",
    });
    expect(formatDeltaText(noBaseline, "mn").text).toBe("Хувийн суурь түвшин хараахан алга");
    expect(formatDeltaText(stat(miraRed, "symptom_headache"), "en").text).toBe("");
    expect(formatDeltaText(stat(miraRed, "vision_check"), "en").text).toBe("");
    expect(formatDeltaText(stat(miraRed, "day_note"), "en").text).toBe("");
    expect(formatDeltaText(stat(alexNoData, "sleep_hours"), "en")).toEqual({ kind: "none", text: "" });
  });

  it("readiness delta compares whole points with the person's own usual", () => {
    expect(readinessDelta(85, 98)).toEqual({ kind: "below", points: 13 });
    expect(readinessDelta(100, 96.4)).toEqual({ kind: "above", points: 4 });
    expect(readinessDelta(80, 80.2)).toEqual({ kind: "same", points: 0 });
    expect(readinessDelta(80, null)).toEqual({ kind: "none", points: 0 });
  });
});

describe("values and units", () => {
  it("maps word-like units to Mongolian and leaves symbols alone", () => {
    expect(unitLabel("h", "en")).toBe("h");
    expect(unitLabel("h", "mn")).toBe("цаг");
    expect(unitLabel("min", "mn")).toBe("мин");
    expect(unitLabel("ml", "mn")).toBe("мл");
    expect(unitLabel("bpm", "mn")).toBe("удаа/мин");
    expect(unitLabel("mmHg", "mn")).toBe("mmHg");
    expect(unitLabel(null, "en")).toBe("");
  });

  it("splits a value into a big part and a unit", () => {
    expect(displayValue("sleep_hours", 5.5, "en")).toEqual({ main: "5.5", unit: "h" });
    expect(displayValue("sleep_hours", 5.5, "mn")).toEqual({ main: "5.5", unit: "цаг" });
    expect(displayValue("water_ml", 1800, "en")).toEqual({ main: "1800", unit: "ml" });
    expect(displayValue("mood", 4, "en")).toEqual({ main: "4", unit: "/5" });
    expect(displayValue("vision_check", 1, "en")).toEqual({ main: "Slightly blurred", unit: "" });
    expect(displayValue("temperature_c", 36.7, "en")).toEqual({ main: "36.7", unit: "°C" });
    expect(displayValue("day_note", "Quiet day", "en")).toEqual({ main: "Quiet day", unit: "" });
  });
});

describe("vital card grouping", () => {
  it("collapses blood pressure, symptoms and the wellbeing check into one card each (crew viewer)", () => {
    const cards = buildKpiCards(batYellow.kpis, "crew");
    expect(cards.map((c) => c.id)).toEqual([
      "sleep_hours",
      "wellbeing",
      "symptoms",
      "bp",
      "heart_rate",
      "temperature_c",
      "glucose_mgdl",
      "water_ml",
      "exercise_min",
      "vision_check",
      "workload",
      "day_note",
      "sensor_note",
    ]);
    const wellbeing = cards.find((c) => c.id === "wellbeing");
    expect(wellbeing).toMatchObject({ kind: "wellbeing", keys: ["mood", "sleep_quality", "energy", "stress", "connection"] });
    expect(wellbeingSummary(new Map(batYellow.kpis.map((k) => [k.key, k])))).toEqual({ status: "green", flagged: [] });
    const bp = cards.find((c) => c.id === "bp");
    expect(bp?.keys).toEqual(["bp_systolic", "bp_diastolic"]);
    const symptoms = cards.find((c) => c.id === "symptoms");
    expect(symptoms?.keys).toEqual(["symptom_headache", "symptom_dizziness", "symptom_nausea"]);
    expect(symptoms?.noteKey).toBe("symptom_note");
  });

  it("every one of the 16 keys lands on exactly one card, or is a hidden note for ground", () => {
    const crew = buildKpiCards(batYellow.kpis, "crew");
    const placed = crew.flatMap((c) => [...c.keys, ...(c.noteKey ? [c.noteKey] : [])]);
    expect([...placed].sort()).toEqual([...KPI_KEYS].sort());
  });

  it("drops free-text keys for the ground viewer", () => {
    const cards = buildKpiCards(miraRed.kpis, "ground");
    expect(cards.map((c) => c.id)).not.toContain("day_note");
    const all = cards.flatMap((c) => [...c.keys, ...(c.noteKey ? [c.noteKey] : [])]);
    expect(all).not.toContain("symptom_note");
    expect(all).not.toContain("day_note");
    expect(cards.find((c) => c.id === "symptoms")?.noteKey).toBeNull();
    expect(cards).toHaveLength(11);
  });

  it("uses the worst member status for a grouped card and ignores members without data", () => {
    const byKey = new Map(batYellow.kpis.map((k) => [k.key, k]));
    const cards = buildKpiCards(batYellow.kpis, "crew");
    expect(cardStatus(cards.find((c) => c.id === "bp")!, byKey)).toBe("green");
    const mira = new Map(miraRed.kpis.map((k) => [k.key, k]));
    expect(cardStatus(buildKpiCards(miraRed.kpis, "crew").find((c) => c.id === "symptoms")!, mira)).toBe(
      "yellow",
    );
    expect(worstOf(["no_data", "green"])).toBe("green");
    expect(worstOf(["green", "red", "yellow"])).toBe("red");
    expect(worstOf(["no_data", "no_data"])).toBe("no_data");
    expect(worstOf([])).toBe("no_data");
  });

  it("skips keys that are not in the payload", () => {
    const partial = batYellow.kpis.filter((k) => k.key !== "bp_diastolic" && k.key !== "day_note");
    const cards = buildKpiCards(partial, "crew");
    expect(cards.find((c) => c.id === "bp")?.keys).toEqual(["bp_systolic"]);
    expect(cards.map((c) => c.id)).not.toContain("day_note");
  });
});

describe("hazard to card mapping", () => {
  const cards = buildKpiCards(batYellow.kpis, "crew");
  const hazard = (key: string) => batYellow.hazards.find((h) => h.hazard === key) ?? null;

  it("relates the gravity hazard to the cards that hold its indicators", () => {
    const related = cardsRelatedToHazard(cards, hazard("gravity"));
    expect([...related].sort()).toEqual(
      ["bp", "exercise_min", "heart_rate", "symptoms", "vision_check", "water_ml"].sort(),
    );
  });

  it("sorts related cards first and keeps the original order inside each group", () => {
    const sorted = sortCardsForHazard(cards, hazard("isolation_confinement"));
    expect(sorted.map((c) => c.id).slice(0, 3)).toEqual(["sleep_hours", "wellbeing", "workload"]);
    const rest = sorted.slice(3).map((c) => c.id);
    expect(rest).toEqual(cards.map((c) => c.id).filter((id) => !["sleep_hours", "wellbeing", "workload"].includes(id)));
  });

  it("changes nothing without a hazard or for a hazard nothing is linked to", () => {
    expect(sortCardsForHazard(cards, null).map((c) => c.id)).toEqual(cards.map((c) => c.id));
    expect(cardsRelatedToHazard(cards, null).size).toBe(0);
    const radiation = hazard("radiation");
    expect(radiation?.status).toBe("not_monitored");
    expect(radiation?.keys).toEqual([]);
    expect(sortCardsForHazard(cards, radiation).map((c) => c.id)).toEqual(cards.map((c) => c.id));
  });

  it("every indicator of a hazard stat is registered for that hazard", () => {
    for (const h of batYellow.hazards) {
      for (const key of h.keys) expect(KPI_DEFS[key].hazards).toContain(h.hazard);
    }
  });

  it("relates tasks by their hazard tag or a shared indicator", () => {
    const gravity = hazard("gravity");
    const hydration = batYellow.tasks.find((t) => t.id === "hydration_plan")!;
    const sleep = batYellow.tasks.find((t) => t.id === "sleep_wind_down")!;
    expect(isTaskRelated(hydration, gravity)).toBe(true);
    expect(isTaskRelated(sleep, gravity)).toBe(false);
    expect(isTaskRelated({ ...sleep, hazard: null, relatedKeys: ["heart_rate"] }, gravity)).toBe(true);
    expect(isTaskRelated(hydration, null)).toBe(false);
  });
});

describe("sparkline geometry", () => {
  const sleep = stat(batYellow, "sleep_hours");
  const sd = effectiveSd("sleep_hours", sleep.baselineSd);
  const g = sparklineGeometry({
    history: sleep.history.map((h) => h.value),
    today: 5.5,
    mean: sleep.baselineMean,
    sd,
    width: 240,
    height: 48,
    pad: 6,
  });

  it("places one point per past day plus today as the last x position", () => {
    expect(g.points).toHaveLength(14);
    expect(g.today).not.toBeNull();
    const xs = g.points.map((p) => p.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(xs[0]).toBe(6);
    expect(g.today!.x).toBe(234);
    expect(g.today!.x).toBeGreaterThan(xs[xs.length - 1]);
  });

  it("draws the band mean +/- 2 sd inside the box with top above bottom", () => {
    expect(g.band).not.toBeNull();
    const { top, bottom } = g.band!;
    expect(top).toBeLessThan(bottom);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(48);
    // sleepFloor 0.3 > real sd, so the band is the 7.2 +/- 0.6 range: 12 hours of height cover it
    const span = g.domain.max - g.domain.min;
    const expectedHeight = ((2 * 2 * (sd as number)) / span) * (48 - 12);
    expect(bottom - top).toBeCloseTo(expectedHeight, 1);
  });

  it("puts a low today below the band (larger y) and keeps every point inside the box", () => {
    expect(g.today!.y).toBeGreaterThan(g.band!.bottom);
    for (const p of g.points) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(48);
    }
    expect(g.today!.y).toBeLessThanOrEqual(48);
    expect(g.linePath.startsWith("M6 ")).toBe(true);
  });

  it("uses the sd floor so a flat history still gets a visible band", () => {
    expect(effectiveSd("sleep_hours", 0.1)).toBe(0.3);
    expect(effectiveSd("sleep_hours", 0.8)).toBe(0.8);
    expect(effectiveSd("sleep_hours", null)).toBeNull();
    const flat = sparklineGeometry({
      history: [7, 7, 7, 7, 7, 7],
      today: 7,
      mean: 7,
      sd: effectiveSd("sleep_hours", 0),
      width: 100,
      height: 40,
    });
    expect(flat.band!.bottom - flat.band!.top).toBeGreaterThan(1);
  });

  it("handles a lone today point, no data and a missing baseline", () => {
    const lone = sparklineGeometry({ history: [], today: 5, mean: null, sd: null, width: 100, height: 40 });
    expect(lone.points).toEqual([]);
    expect(lone.linePath).toBe("");
    expect(lone.band).toBeNull();
    expect(lone.today).toEqual({ x: 50, y: 20 });
    const none = sparklineGeometry({ history: [], today: null, mean: null, sd: null, width: 100, height: 40 });
    expect(none.today).toBeNull();
    expect(none.points).toEqual([]);
    const noBand = sparklineGeometry({ history: [1, 2, 3], today: null, mean: null, sd: null, width: 100, height: 40 });
    expect(noBand.band).toBeNull();
    expect(noBand.linePath.startsWith("M")).toBe(true);
  });
});

describe("delay options", () => {
  it("maps Live / 3 min / 20 min to 0 / 180000 / 1200000 ms", () => {
    expect(DELAY_OPTIONS.map((o) => o.id)).toEqual(["live", "3min", "20min"]);
    expect(delayMsFor("live")).toBe(0);
    expect(delayMsFor("3min")).toBe(180_000);
    expect(delayMsFor("20min")).toBe(1_200_000);
  });

  it("maps milliseconds back to an option, defaulting to Live", () => {
    expect(delayIdFor(0)).toBe("live");
    expect(delayIdFor(180_000)).toBe("3min");
    expect(delayIdFor(1_200_000)).toBe("20min");
    expect(delayIdFor(60_000)).toBe("live");
    expect(delayIdFor(Number.NaN)).toBe("live");
  });

  it("parses the ?delay= query value safely", () => {
    expect(parseDelayId("3min")).toBe("3min");
    expect(parseDelayId(["20min", "live"])).toBe("20min");
    expect(parseDelayId("nope")).toBe("live");
    expect(parseDelayId(undefined)).toBe("live");
    expect(parseDelayId(null)).toBe("live");
    expect(isDelayId("20min")).toBe(true);
    expect(isDelayId("5min")).toBe(false);
  });

  it("has a label in both languages for every option", () => {
    for (const lang of ["en", "mn"] as const) {
      for (const option of DELAY_OPTIONS) {
        expect(text(lang, delayLabelKey(option.id)), `${lang} ${option.id}`).toBeTruthy();
      }
    }
    expect(text("en", "earth.delay.live")).toBe("Live");
    expect(text("en", "earth.delay.3min")).toBe("3 min");
    expect(text("en", "earth.delay.20min")).toBe("20 min");
  });
});

describe("crew card readiness on the Earth console", () => {
  /** the card the ground route builds from a payload: stars = per-key status, readiness copied as is */
  const cardFrom = (today: Partial<Record<KpiKey, MeasurementValue>>) => {
    const result = evaluateDay(today, []);
    return {
      overall: result.overall,
      readiness: result.readiness,
      stars: KPI_KEYS.map((key) => ({ key, status: result.indicators[key].status })),
    };
  };

  it("hides the engine's bare 0 when fewer than 3 axes have data (reviewer repro)", () => {
    const card = cardFrom({ sleep_hours: 4, water_ml: 800 });
    // the repro: a red overall result with readiness 0 and only 2 axes (sleep, metabolic) scored
    expect(card.overall).toBe("red");
    expect(card.readiness).toBe(0);
    expect(crewCardReadiness(card)).toBeNull();
  });

  it("shows readiness once at least 3 distinct axes have data, like isReadinessAvailable", () => {
    const card = cardFrom({ sleep_hours: 7.5, water_ml: 2200, heart_rate: 62, bp_systolic: 118 });
    const result = evaluateDay(
      { sleep_hours: 7.5, water_ml: 2200, heart_rate: 62, bp_systolic: 118 },
      [],
    );
    expect(isReadinessAvailable(result.axes)).toBe(true);
    expect(crewCardReadiness(card)).toBe(card.readiness);
  });

  it("counts distinct axes, not stars: several keys on one axis are still one axis", () => {
    const stars = [
      { key: "bp_systolic", status: "green" },
      { key: "bp_diastolic", status: "green" },
      { key: "heart_rate", status: "green" },
    ] as const;
    expect(new Set(stars.map((s) => KPI_DEFS[s.key].axis)).size).toBe(1);
    expect(crewCardReadiness({ readiness: 100, stars })).toBeNull();
  });

  it("ignores no_data stars and keys without an axis", () => {
    const stars = [
      { key: "sleep_hours", status: "green" },
      { key: "water_ml", status: "no_data" },
      { key: "heart_rate", status: "no_data" },
      { key: "day_note", status: "green" },
    ] as const;
    expect(crewCardReadiness({ readiness: 90, stars })).toBeNull();
  });

  it("keeps null as null and leaves the fixtures' real readiness untouched", () => {
    expect(crewCardReadiness({ readiness: null, stars: [] })).toBeNull();
    for (const { payload } of DASHBOARD_FIXTURES) {
      const card = {
        readiness: payload.readiness,
        stars: payload.kpis.map((k) => ({ key: k.key, status: k.status })),
      };
      const expected = isReadinessAvailable(payload.axes) ? payload.readiness : null;
      expect(crewCardReadiness(card), payload.crew.name).toBe(expected);
    }
  });
});

describe("clock, arc and small helpers", () => {
  it("formats instants in UTC so server and browser agree", () => {
    expect(formatClockUtc("2026-11-14T08:42:00.000Z")).toBe("08:42");
    expect(formatClockUtc("2026-11-14T23:05:59.000Z")).toBe("23:05");
    expect(formatClockUtc(null)).toBe("-");
    expect(formatClockUtc("not a date")).toBe("-");
    expect(formatClockLabel("2026-11-14T08:42:00.000Z", "en")).toBe("08:42 UTC");
    expect(formatClockLabel("2026-11-14T08:42:00.000Z", "mn")).toBe("08:42 UTC");
  });

  it("adds a simulated delay to a timestamp", () => {
    expect(addMs("2026-11-14T08:44:00.000Z", 180_000)).toBe("2026-11-14T08:47:00.000Z");
    expect(addMs("2026-11-14T08:44:00.000Z", 0)).toBe("2026-11-14T08:44:00.000Z");
    expect(addMs(null, 1000)).toBeNull();
    expect(addMs("x", 1000)).toBeNull();
  });

  it("marks the first slot that is not done as next, else bedtime", () => {
    expect(nextSlot(batYellow.dayArc)).toBe("bedtime");
    expect(nextSlot(saraaGreen.dayArc)).toBe("evening");
    expect(nextSlot(alexNoData.dayArc)).toBe("morning");
  });

  it("counts the past days with at least one reported symptom", () => {
    const mk = (key: KpiKey, values: number[]): KpiStat => ({
      ...stat(batYellow, key),
      history: values.map((value, i) => ({ date: `2026-11-0${i + 1}`, value })),
    });
    expect(
      symptomDays([
        mk("symptom_headache", [1, 0, 0, 1, 0]),
        mk("symptom_dizziness", [0, 0, 1, 1, 0]),
        mk("symptom_nausea", [0, 0, 0, 0, 0]),
      ]),
    ).toEqual({ count: 3, total: 5 });
    expect(symptomDays([])).toEqual({ count: 0, total: 0 });
  });

  it("builds the same-origin summary audio url without any text in it", () => {
    expect(summaryAudioUrl("chk-1", "turn-9")).toBe("/api/checkins/chk-1/turns/turn-9/audio");
    expect(summaryAudioUrl("a b", "c/d")).toBe("/api/checkins/a%20b/turns/c%2Fd/audio");
  });

  it("staggers entrance delays and caps them", () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBeCloseTo(0.06);
    expect(staggerDelay(100)).toBe(0.7);
    expect(staggerDelay(-3)).toBe(0);
  });

  it("sorts alerts newest first and keeps the order of equal or unreadable times", () => {
    const base = miraRed.alerts[0];
    const a = { ...base, id: "a", createdAt: "2026-11-14T08:00:00.000Z" };
    const b = { ...base, id: "b", createdAt: "2026-11-14T10:00:00.000Z" };
    const c = { ...base, id: "c", createdAt: "2026-11-14T10:00:00.000Z" };
    expect(sortAlertsNewestFirst([a, b, c]).map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(sortAlertsNewestFirst([]).length).toBe(0);
  });
});

describe("dictionary coverage for the dashboard pieces", () => {
  it("has a name for every axis, slot, slot state, link state and hazard-independent label", () => {
    const keys = [
      ...AXIS_KEYS.map((a) => `dashboard.axis.${a}`),
      ...SLOT_ORDER.map((s) => `dashboard.dayArc.${s}`),
      "dashboard.dayArc.bedtime",
      "dashboard.dayArc.done",
      "dashboard.dayArc.partial",
      "dashboard.dayArc.pending",
      "dashboard.link.state.online",
      "dashboard.link.state.delayed",
      "dashboard.link.state.offline",
      "dashboard.hazards.caption",
    ];
    for (const lang of ["en", "mn"] as const) {
      for (const key of keys) expect(text(lang, key), `${lang} ${key}`).toBeTruthy();
    }
    expect(text("en", "dashboard.hazards.caption")).toBe("Links are suggested, not official.");
  });

  it("keeps the earth console wording the plan asks for", () => {
    expect(text("en", "earth.title")).toBe("Earth console - simulated link");
    expect(text("en", "earth.privacy.note")).toBe(
      "All data is sent automatically (team decision); a crew consent switch is a planned addition.",
    );
    expect(text("en", "earth.crewPage.emptyTitle")).toBe("No data visible yet");
  });

  it("says 'demo parameter' on every threshold label shown on the cards", () => {
    for (const payload of DASHBOARD_FIXTURES.map((f) => f.payload)) {
      for (const k of payload.kpis) {
        if (k.rangeText) {
          expect(k.rangeText.en).toContain("demo parameter");
          expect(k.rangeText.mn).toContain("демо параметр");
        }
      }
    }
  });
});

/* ───────────── fixtures: shape, honesty and agreement with the real health engine ───────────── */

function todayOf(payload: DashboardPayload): Partial<Record<KpiKey, MeasurementValue>> {
  const out: Partial<Record<KpiKey, MeasurementValue>> = {};
  for (const k of payload.kpis) if (k.value !== null) out[k.key] = k.value;
  return out;
}

function historyOf(payload: DashboardPayload): HistoryDay[] {
  const byDate = new Map<string, HistoryDay>();
  for (const k of payload.kpis) {
    for (const point of k.history) {
      const day = byDate.get(point.date) ?? { date: point.date, values: {} };
      day.values[k.key] = point.value;
      byDate.set(point.date, day);
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

describe("dashboard fixtures", () => {
  it("are four distinct, fully shaped payloads", () => {
    expect(DASHBOARD_FIXTURES.map((f) => f.id)).toEqual([
      "bat-yellow",
      "saraa-green",
      "mira-red",
      "alex-no-data",
    ]);
    for (const { payload } of DASHBOARD_FIXTURES) {
      expect(payload.kpis.map((k) => k.key)).toEqual([...KPI_KEYS]);
      expect(payload.axes.map((a) => a.axis)).toEqual(AXIS_KEYS);
      expect(payload.hazards.map((h) => h.hazard)).toEqual(HAZARD_KEYS);
      expect(payload.dayArc.map((s) => s.slot)).toEqual(SLOT_ORDER);
      expect(payload.tasks.length).toBeGreaterThanOrEqual(3);
      expect(payload.tasks.length).toBeLessThanOrEqual(4);
      expect(payload.summary.recommendations.length).toBeLessThanOrEqual(2);
      expect(payload.summary.findings.length).toBeLessThanOrEqual(2);
      expect(payload.link.simulated).toBe(true);
    }
  });

  it("tell the stories the plan asks for", () => {
    expect(batYellow.overall).toBe("yellow");
    expect(stat(batYellow, "sleep_hours").value).toBe(5.5);
    expect(stat(batYellow, "water_ml").value).toBe(1800);
    expect(batYellow.summary.findings.map((f) => f.key)).toEqual(["sleep_hours", "water_ml"]);
    expect(saraaGreen.overall).toBe("green");
    expect(saraaGreen.alerts).toEqual([]);
    expect(miraRed.overall).toBe("red");
    expect(miraRed.alerts).toHaveLength(1);
    expect(miraRed.alerts[0].level).toBe("red");
    expect(miraRed.summary.redFlags.map((r) => r.rule)).toEqual(["HEADACHE_PLUS_VISION"]);
    expect(stat(miraRed, "symptom_headache").value).toBe(1);
    expect(stat(miraRed, "vision_check").value).toBe(1);
    expect(alexNoData.overall).toBe("no_data");
    expect(alexNoData.kpis.every((k) => k.status === "no_data" && k.value === null)).toBe(true);
  });

  it("never show missing data as a value", () => {
    for (const k of alexNoData.kpis) {
      expect(k.value).toBeNull();
      expect(k.reason).toBe("missing");
      expect(k.source).toBeNull();
    }
    expect(alexNoData.axes.every((a) => a.score === null)).toBe(true);
    expect(alexNoData.readinessBaseline).toBeNull();
    expect(alexNoData.link.lastSentAt).toBeNull();
  });

  it("carry text notes only where a person wrote them (the UI hides them for ground)", () => {
    expect(typeof stat(miraRed, "symptom_note").value).toBe("string");
    expect(typeof stat(miraRed, "day_note").value).toBe("string");
    const ground = buildKpiCards(miraRed.kpis, "ground");
    const shown = ground.flatMap((c) => c.keys);
    expect(shown).not.toContain("symptom_note");
    expect(shown).not.toContain("day_note");
  });

  it("use only calm wording: alert or watch, no diagnosis, drug or treatment words", () => {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    for (const { payload } of DASHBOARD_FIXTURES) {
      walk(payload.tasks);
      walk(payload.alerts);
      walk(payload.summary);
    }
    const banned = /\b(diagnos(?:ed|is)\b(?! is not)|prescri|medication|dose|dosage|treat(?:ment)?|cure|ibuprofen|aspirin)/i;
    for (const s of strings) {
      if (/not a diagnosis|онош биш/i.test(s)) continue; // the disclaimer itself
      expect(s, s).not.toMatch(banned);
    }
  });

  for (const fixture of [batYellow, saraaGreen, miraRed, alexNoData]) {
    it(`agree with evaluateDay for ${fixture.crew.name}: statuses, hazards, axes, overall, readiness`, () => {
      const result = evaluateDay(todayOf(fixture), historyOf(fixture));
      expect(fixture.overall).toBe(result.overall);
      expect(fixture.readiness).toBe(result.readiness);
      for (const k of fixture.kpis) {
        expect(k.status, `${fixture.crew.name} ${k.key} status`).toBe(result.indicators[k.key].status);
        expect(k.reason, `${fixture.crew.name} ${k.key} reason`).toBe(result.indicators[k.key].reason);
      }
      for (const h of fixture.hazards) {
        const expected = result.hazards.find((x) => x.hazard === h.hazard);
        expect(h.status, `${fixture.crew.name} ${h.hazard}`).toBe(expected?.status);
        expect(h.keys).toEqual(expected?.keys);
      }
      for (const a of fixture.axes) {
        const expected = result.axes.find((x) => x.axis === a.axis);
        expect(a.score, `${fixture.crew.name} ${a.axis} score`).toBe(expected?.score);
        expect(a.status, `${fixture.crew.name} ${a.axis} status`).toBe(expected?.status);
        if (expected?.baseline == null) expect(a.baseline).toBeNull();
        else expect(a.baseline).toBeCloseTo(expected.baseline, 1);
      }
      for (const slot of fixture.dayArc) {
        const expected = result.dayArc.find((x) => x.slot === slot.slot);
        expect(slot.state, `${fixture.crew.name} ${slot.slot}`).toBe(expected?.state);
        expect([...slot.logged].sort()).toEqual([...(expected?.logged ?? [])].sort());
        expect([...slot.missing].sort()).toEqual([...(expected?.missing ?? [])].sort());
      }
    });
  }
});

/* ───────────── design v2 helpers (docs/DESIGN_V2.md section 2) ───────────── */

describe("body map helpers", () => {
  it("has exactly one hotspot per radar axis, inside the image", () => {
    expect([...BODY_HOTSPOTS.map((h) => h.axis)].sort()).toEqual([...AXIS_KEYS].sort());
    for (const h of BODY_HOTSPOTS) {
      expect(h.x).toBeGreaterThan(0);
      expect(h.x).toBeLessThan(1);
      expect(h.y).toBeGreaterThan(0);
      expect(h.y).toBeLessThan(1);
    }
  });

  it("cycles the axes head to knee and wraps both ways", () => {
    expect(cycleAxis(null, 1)).toBe("neuro_ocular");
    expect(cycleAxis(null, -1)).toBe("musculoskeletal");
    expect(cycleAxis("neuro_ocular", 1)).toBe("sleep");
    expect(cycleAxis("musculoskeletal", 1)).toBe("neuro_ocular");
    expect(cycleAxis("neuro_ocular", -1)).toBe("musculoskeletal");
  });

  it("maps each axis to its indicators and its most linked NASA hazard", () => {
    expect(axisKeys("cardio")).toEqual(["bp_systolic", "bp_diastolic", "heart_rate"]);
    expect(axisKeys("sleep")).toEqual(["sleep_hours", "sleep_quality", "energy"]);
    expect(axisHazard("sleep")).toBe("isolation_confinement");
    expect(axisHazard("cardio")).toBe("gravity");
    expect(axisHazard("metabolic")).toBe("hostile_closed_environment");
    expect(axisHazard("musculoskeletal")).toBe("gravity");
    for (const axis of AXIS_KEYS) expect(axisHazard(axis)).not.toBeNull();
  });

  it("lists the worst indicators of an axis first, at most three", () => {
    const neuro = axisIndicators("neuro_ocular", miraRed.kpis);
    expect(neuro).toHaveLength(3);
    expect(neuro[0].status).not.toBe("green");
    expect(axisIndicators("metabolic", batYellow.kpis, 3)[0].key).toBe("water_ml");
    expect(axisIndicators("metabolic", batYellow.kpis, 2)).toHaveLength(2);
  });

  it("picks the worst axis, or none without data", () => {
    expect(worstAxis(batYellow.axes)).toBe("sleep");
    expect(worstAxis(alexNoData.axes)).toBeNull();
  });
});

describe("highlight vital helpers", () => {
  it("uses the first chartable finding, else a non-green chartable reading, else heart rate", () => {
    expect(highlightKey(batYellow.summary.findings, batYellow.kpis)).toBe("sleep_hours");
    const mira = highlightKey(miraRed.summary.findings, miraRed.kpis);
    expect(KPI_DEFS[mira].type).not.toBe("boolean");
    expect(KPI_DEFS[mira].type).not.toBe("category");
    expect(highlightKey([], saraaGreen.kpis)).toBe("heart_rate");
    expect(highlightKey(alexNoData.summary.findings, alexNoData.kpis)).toBe("heart_rate");
  });

  it("summarises the past days: personal mean, min and max", () => {
    const sleep = stat(batYellow, "sleep_hours");
    const s = historySummary(sleep)!;
    expect(s.n).toBe(14);
    expect(s.avg).toBeCloseTo(sleep.baselineMean!, 6);
    expect(s.min).toBe(6.8);
    expect(s.max).toBe(7.6);
    expect(historySummary(stat(alexNoData, "sleep_hours"))).toBeNull();
  });

  it("keeps the last bars with today last, and no today bar without a value", () => {
    const bars = recentBars(stat(batYellow, "sleep_hours"), 10);
    expect(bars).toHaveLength(10);
    expect(bars[9]).toEqual({ date: null, value: 5.5, today: true });
    expect(bars[8].date).toBe("2026-11-13");
    expect(bars.filter((b) => b.today)).toHaveLength(1);
    expect(recentBars(stat(alexNoData, "sleep_hours"), 10)).toEqual([]);
  });

  it("measures progress against the demo-parameter target", () => {
    expect(demoTarget("water_ml")).toBe(2000);
    expect(demoTarget("exercise_min")).toBe(45);
    expect(demoTarget("sleep_hours")).toBe(7);
    expect(targetFraction(1800, 2000)).toBeCloseTo(0.9);
    expect(targetFraction(3000, 2000)).toBe(1);
    expect(targetFraction(null, 2000)).toBeNull();
  });
});

describe("timeline", () => {
  const input = (p: DashboardPayload) => ({
    kpis: p.kpis,
    overall: p.overall,
    axes: p.axes,
    confirmedAt: p.checkIn.confirmedAt,
  });

  it("covers the last 15 days ending today, oldest first", () => {
    const days = buildTimeline(input(batYellow));
    expect(days).toHaveLength(15);
    expect(days[0].date).toBe("2026-10-31");
    expect(days[14]).toMatchObject({ date: "2026-11-14", today: true, status: "yellow", axis: "sleep" });
    expect(days.filter((d) => d.today)).toHaveLength(1);
  });

  it("re-evaluates past days with the health engine and never invents data", () => {
    const days = buildTimeline(input(saraaGreen));
    for (const d of days.slice(0, 14)) {
      expect(d.hasData).toBe(true);
      if (d.status === "green") expect(d.axis).toBeNull();
      if (d.status === "yellow" || d.status === "red") expect(d.axis).not.toBeNull();
    }
    const empty = buildTimeline(input(alexNoData));
    expect(empty.every((d) => d.status === "no_data" && d.axis === null)).toBe(true);
    expect(empty.slice(0, 14).every((d) => !d.hasData)).toBe(true);
  });

  it("shows a hollow day when a date is missing from the history", () => {
    const gappy = batYellow.kpis.map((k) => ({
      ...k,
      history: k.history.filter((h) => h.date !== "2026-11-05"),
    }));
    const days = buildTimeline({ ...input(batYellow), kpis: gappy });
    expect(days.find((d) => d.date === "2026-11-05")).toMatchObject({
      status: "no_data",
      hasData: false,
      axis: null,
    });
  });
});

describe("dictionary coverage for the v2 dashboard", () => {
  it("has every new label in both languages", () => {
    const keys = [
      ...["overview", "vitals", "plan", "trends", "earth"].map((n) => `dashboard.nav.${n}`),
      "dashboard.top.welcome",
      "dashboard.highlight.avg",
      "dashboard.highlight.range",
      "dashboard.body.hotspot",
      "dashboard.radar.titleLight",
      "dashboard.radar.titleStrong",
      "dashboard.plan.titleLight",
      "dashboard.plan.titleStrong",
      "dashboard.heart.title",
      "dashboard.hydration.title",
      "dashboard.timeline.title",
      "dashboard.profile.readinessNote",
    ];
    for (const lang of ["en", "mn"] as const) {
      for (const key of keys) expect(text(lang, key), `${lang} ${key}`).toBeTruthy();
    }
    expect(text("en", "dashboard.profile.readinessNote")).toContain("demo calculation");
  });
});
