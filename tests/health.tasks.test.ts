import { describe, expect, it } from "vitest";
import { evaluateDay } from "@/lib/health";
import { buildTasks } from "@/lib/health/tasks";
import { computeBaselines } from "@/lib/health/baseline";
import { evaluateIndicators } from "@/lib/health/status";
import { evaluateRedFlags } from "@/lib/health/flags";
import {
  batDemoToday,
  batHistory,
  collectStrings,
  constantHistory,
  normalToday,
  steadyHistory,
  type DayValues,
} from "./helpers/health";

const FORBIDDEN = /diagnos|prescri|dose|medicat/i;

const SCENARIOS: Record<string, { today: DayValues; history: ReturnType<typeof steadyHistory> }> = {
  "normal day": { today: normalToday(), history: steadyHistory() },
  "empty day": { today: {}, history: [] },
  "bat demo": { today: batDemoToday(), history: batHistory() },
  "everything off": {
    today: normalToday({
      sleep_hours: 4, mood: 2, symptom_headache: 1, symptom_dizziness: 1, symptom_nausea: 1,
      bp_systolic: 150, heart_rate: 120, glucose_mgdl: 200, water_ml: 400, exercise_min: 0,
      vision_check: 2, workload: 5, symptom_note: "chest pain",
    }),
    history: steadyHistory(),
  },
  "glucose high only": { today: normalToday({ glucose_mgdl: 160 }), history: [] },
  "vitals only": { today: normalToday({ heart_rate: 100, temperature_c: 37.8 }), history: [] },
  "vision yellow": { today: normalToday({ vision_check: 1 }), history: [] },
  "low mood": { today: normalToday({ mood: 2 }), history: [] },
  "high workload": { today: normalToday({ workload: 5 }), history: [] },
  "no history, low sleep": { today: normalToday({ sleep_hours: 5.5 }), history: [] },
};

function tasksOf(name: string) {
  return evaluateDay(SCENARIOS[name].today, SCENARIOS[name].history).tasks;
}

describe("tasks: count, shape and wording", () => {
  it.each(Object.keys(SCENARIOS))("gives 3 or 4 tasks with stable unique ids: %s", (name) => {
    const tasks = tasksOf(name);
    expect(tasks.length).toBeGreaterThanOrEqual(3);
    expect(tasks.length).toBeLessThanOrEqual(4);
    const ids = tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of tasks) {
      expect(t.id).toMatch(/^[a-z_]+$/);
      expect(t.title.en.length).toBeGreaterThan(5);
      expect(t.title.mn.length).toBeGreaterThan(5);
      expect(t.why.en.length).toBeGreaterThan(10);
      expect(t.why.mn.length).toBeGreaterThan(10);
    }
  });

  it.each(Object.keys(SCENARIOS))("is lifestyle only, never diagnosis, prescription, dose or medication: %s", (name) => {
    for (const s of collectStrings(tasksOf(name))) expect(s).not.toMatch(FORBIDDEN);
  });

  it("does not use drug or treatment wording in any language across all scenarios", () => {
    const all = Object.keys(SCENARIOS).flatMap((n) => collectStrings(tasksOf(n)));
    for (const s of all) {
      expect(s).not.toMatch(/\b(pill|tablet|treat|treatment|therapy|cure|drug|insulin|ibuprofen|aspirin)\b/i);
      expect(s).not.toMatch(/\bэм\b|эмчилгээ|тун\b/i);
    }
  });

  it("is deterministic", () => {
    const a = tasksOf("everything off");
    const b = tasksOf("everything off");
    expect(a).toEqual(b);
  });
});

describe("tasks: defaults", () => {
  it("pads a normal day to exactly 3 default tasks", () => {
    const tasks = tasksOf("normal day");
    expect(tasks.map((t) => t.id)).toEqual(["default_hydration", "default_light_exposure", "default_stretching"]);
  });

  it("pads an empty day to 3 and mentions no water number it does not have", () => {
    const tasks = tasksOf("empty day");
    expect(tasks).toHaveLength(3);
    expect(tasks[0].why.en).not.toMatch(/\d/);
  });

  it("pads with defaults that do not duplicate the rule tasks", () => {
    const tasks = tasksOf("no history, low sleep");
    expect(tasks.map((t) => t.id)).toEqual(["sleep_wind_down", "default_hydration", "default_stretching"]);
  });
});

describe("tasks: rules", () => {
  it("builds the sleep wind-down task with numbers computed in code", () => {
    const sleep = tasksOf("bat demo").find((t) => t.id === "sleep_wind_down")!;
    expect(sleep.why.en).toBe("You slept 5.5 h, about 1.7 h below your usual 7.2 h.");
    expect(sleep.relatedKeys).toEqual(["sleep_hours"]);
    expect(sleep.hazard).toBe("isolation_confinement");
    expect(sleep.why.mn).toContain("5.5");
    expect(sleep.why.mn).toContain("1.7");
  });

  it("falls back to the demo parameter when there is no baseline", () => {
    const sleep = tasksOf("no history, low sleep").find((t) => t.id === "sleep_wind_down")!;
    expect(sleep.why.en).toBe("You slept 5.5 h, below the 7 h demo parameter.");
  });

  it("builds the hydration task with a computed amount", () => {
    const water = tasksOf("bat demo").find((t) => t.id === "hydration_plan")!;
    expect(water.why.en).toBe("You have had 1800 ml of water, about 507 ml below your usual 2307 ml.");
    expect(water.title.en).toBe("Drink about 550 ml more, spread through the day");
    expect(water.hazard).toBe("gravity");
  });

  it("builds the exercise task for low exercise", () => {
    const today = normalToday({ exercise_min: 10 });
    const tasks = evaluateDay(today, []).tasks;
    const ex = tasks.find((t) => t.id === "exercise_session")!;
    expect(ex.why.en).toBe("You logged 10 min of exercise, below the 45 min demo parameter.");
    expect(ex.title.en).toBe("Schedule a 45-minute exercise session");
  });

  it("suggests a break and talking to crew or family for low mood or high workload", () => {
    const mood = tasksOf("low mood").find((t) => t.id === "short_break_connect")!;
    expect(mood.why.en).toBe("Your mood was 2 out of 5.");
    expect(mood.relatedKeys).toEqual(["mood"]);
    const work = tasksOf("high workload").find((t) => t.id === "short_break_connect")!;
    expect(work.why.en).toBe("Today's workload was 5 out of 5.");
    const both = evaluateDay(normalToday({ mood: 2, workload: 5 }), []).tasks.find((t) => t.id === "short_break_connect")!;
    expect(both.relatedKeys).toEqual(["mood", "workload"]);
    expect(both.why.en).toContain("mood was 2 out of 5");
    expect(both.why.en).toContain("workload was 5 out of 5");
  });

  it("asks to repeat the vision self-check when vision is yellow", () => {
    const v = tasksOf("vision yellow").find((t) => t.id === "vision_recheck")!;
    expect(v.title.en).toBe("Repeat the vision self-check this evening");
    expect(v.why.en).toContain("slightly blurred");
    expect(v.why.en).toMatch(/crew medical officer or flight surgeon/);
  });

  it("keeps the next meal on schedule for glucose out of green, and points medical questions to the medical officer", () => {
    const g = tasksOf("glucose high only").find((t) => t.id === "glucose_meal_schedule")!;
    expect(g.title.en).toBe("Keep your next meal on schedule and measure again later");
    expect(g.why.en).toContain("160 mg/dL");
    expect(g.why.en).toContain("above the demo range");
    expect(g.why.en).toMatch(/ask your crew medical officer or flight surgeon/);
    expect(g.why.mn).toContain("160");
  });

  it("asks for a rest and a re-measure for other vitals out of green", () => {
    const v = tasksOf("vitals only").find((t) => t.id === "vitals_recheck")!;
    expect(v.relatedKeys).toEqual(["heart_rate", "temperature_c"]);
    expect(v.why.en).toMatch(/crew medical officer or flight surgeon/);
  });

  it("puts the crew medical officer first when a red flag exists", () => {
    const tasks = tasksOf("everything off");
    expect(tasks).toHaveLength(4);
    expect(tasks[0].id).toBe("contact_medical_officer");
    expect(tasks[0].hazard).toBeNull();
    expect(tasks[0].title.en).toMatch(/crew medical officer/);
  });

  it("ranks red before yellow, then by |z|, and caps at 4", () => {
    const tasks = tasksOf("bat demo").map((t) => t.id);
    // sleep (|z| about 5.7), water (about 3.4), exercise (about 1.1)
    expect(tasks).toEqual(["sleep_wind_down", "hydration_plan", "exercise_session"]);
    const redFirst = evaluateDay(normalToday({ glucose_mgdl: 190, sleep_hours: 6 }), []).tasks.map((t) => t.id);
    // glucose 190 is a red vital -> red flag -> medical officer first, then the red glucose task, then yellow sleep
    expect(redFirst.slice(0, 3)).toEqual(["contact_medical_officer", "glucose_meal_schedule", "sleep_wind_down"]);
  });

  it("does not suggest hydration for a high-water baseline outlier", () => {
    const history = constantHistory({ water_ml: 2300 });
    const tasks = evaluateDay(normalToday({ water_ml: 3600 }), history).tasks.map((t) => t.id);
    expect(tasks).not.toContain("hydration_plan");
    expect(tasks).toContain("default_hydration");
  });

  it("can be built directly from a context", () => {
    const today = normalToday({ heart_rate: 130 });
    const baselines = computeBaselines([]);
    const indicators = evaluateIndicators(today, baselines);
    const redFlags = evaluateRedFlags(today, indicators);
    const tasks = buildTasks({ today, indicators, baselines, redFlags });
    expect(tasks[0].id).toBe("contact_medical_officer");
    expect(tasks.length).toBeGreaterThanOrEqual(3);
  });
});
