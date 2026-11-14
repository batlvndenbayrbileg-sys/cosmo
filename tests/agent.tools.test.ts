import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KPI_KEYS, type KpiKey } from "@/lib/types";
import { QUESTIONS, getQuestion } from "@/lib/kpi/registry";
import { interpretAnswer } from "@/server/agent/interpret";
import { DEMO_SCRIPTS } from "@/server/agent/scripts";
import {
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  crossCheckNumber,
  executeTool,
  isLegalIn,
  isSubstringOfUtterance,
  toolResultContent,
  type ToolResult,
} from "@/server/agent/tools";
import { setClockForTests } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { listMeasurements } from "@/server/db/repos/measurement";
import { startCheckIn, toolContext } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

let checkInId: string;

beforeEach(async () => {
  setClockForTests(TEST_TODAY);
  await freshSeededDb();
  checkInId = await startCheckIn("bat", "en");
});
afterEach(() => setClockForTests(null));

const stored = async (crewId = "bat", id = checkInId) =>
  new Map((await listMeasurements(crewId, id)).map((m) => [m.key, m]));

async function record(utterance: string, input: Record<string, unknown>, over: Parameters<typeof toolContext>[4] = {}, state: Parameters<typeof toolContext>[2] = "KPI_CAPTURE") {
  return executeTool(toolContext("bat", checkInId, state, utterance, over), "record_measurement", {
    unit: null,
    confidence: 0.9,
    ...input,
  });
}

function expectError(result: ToolResult, code: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe(code);
}

describe("tool definitions", () => {
  it("are the six tools of the brief, in a fixed order", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect([...TOOL_NAMES]).toEqual([
      "record_measurement",
      "request_clarification",
      "correct_measurement",
      "get_baseline",
      "finish_confirmation",
      "compose_summary",
    ]);
  });

  it("are all strict with additionalProperties false", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.strict, tool.name).toBe(true);
      expect(tool.input_schema.type).toBe("object");
      expect((tool.input_schema as { additionalProperties?: unknown }).additionalProperties, tool.name).toBe(false);
    }
  });

  it("never let the model name the crew member, and list every KPI key", () => {
    const text = JSON.stringify(TOOL_DEFINITIONS);
    expect(text).not.toMatch(/crew_?id|checkin_?id|check_in_id/i);
    const record = TOOL_DEFINITIONS[0].input_schema as { properties: { key: { enum: string[] } } };
    expect(record.properties.key.enum).toEqual([...KPI_KEYS]);
  });

  it("are a constant: frozen and byte-identical on every read", async () => {
    const first = JSON.stringify(TOOL_DEFINITIONS);
    await executeTool(toolContext("bat", checkInId, "KPI_CAPTURE", "x"), "get_baseline", {});
    expect(JSON.stringify(TOOL_DEFINITIONS)).toBe(first);
    expect(Object.isFrozen(TOOL_DEFINITIONS)).toBe(true);
    expect(Object.isFrozen(TOOL_DEFINITIONS[0])).toBe(true);
  });
});

describe("record_measurement: validation", () => {
  it("stores a valid value with the registry unit, the given confidence and the context source", async () => {
    const res = await record("I slept 7 hours", { key: "sleep_hours", value: 7, unit: "wrong unit", source_text: "7 hours" }, { source: "voice" });
    expect(res.ok).toBe(true);
    const row = (await stored()).get("sleep_hours");
    expect(row).toMatchObject({ value: 7, unit: "h", sourceText: "7 hours", confidence: 0.9, source: "voice" });
  });

  it("rejects a value outside the hard range and writes nothing (reason: range)", async () => {
    const res = await record("I slept 20 hours", { key: "sleep_hours", value: 20, source_text: "20 hours" });
    expectError(res, "invalid_value");
    if (!res.ok) expect(res.reason).toBe("range");
    expect((await stored()).size).toBe(0);
  });

  it("rejects a value of the wrong type (reason: type)", async () => {
    const res = await record("lots", { key: "heart_rate", value: "lots", source_text: "lots" });
    expectError(res, "invalid_value");
    if (!res.ok) expect(res.reason).toBe("type");
    const fraction = await record("68.5 bpm", { key: "heart_rate", value: 68.5, source_text: "68.5" });
    expectError(fraction, "invalid_value");
  });

  it("rejects an unknown key, a missing field and unknown fields (including a crew id)", async () => {
    expectError(await record("x", { key: "spo2", value: 98, source_text: "98" }), "bad_input");
    expectError(await executeTool(toolContext("bat", checkInId, "KPI_CAPTURE", "98"), "record_measurement", { key: "mood", value: 4 }), "bad_input");
    expectError(await record("4", { key: "mood", value: 4, source_text: "4", crewId: "saraa" }), "bad_input");
    expectError(await executeTool(toolContext("bat", checkInId, "KPI_CAPTURE", "x"), "launch_rocket", {}), "unknown_tool");
    expect((await stored()).size).toBe(0);
  });

  it("normalises yes/no words for the symptom keys", async () => {
    const res = await record("yes a headache", { key: "symptom_headache", value: "yes", source_text: "yes" });
    expect(res.ok).toBe(true);
    expect((await stored()).get("symptom_headache")?.value).toBe(1);
  });
});

describe("record_measurement: cross-check against the speaker's words (PLAN 4.5)", () => {
  it("rejects a source_text that is not a quote of the latest utterance", async () => {
    const res = await record("I slept 6 hours", { key: "sleep_hours", value: 7, source_text: "7 hours" });
    expectError(res, "source_mismatch");
    expect((await stored()).size).toBe(0);
  });

  it("rejects an empty source_text", async () => {
    expectError(await record("I slept 6 hours", { key: "sleep_hours", value: 6, source_text: "  " }), "source_mismatch");
  });

  it("rejects a number that does not appear in the words (the model heard something else)", async () => {
    const res = await record("I slept 6 hours last night", { key: "sleep_hours", value: 7, source_text: "6 hours" });
    expectError(res, "number_mismatch");
    if (!res.ok) expect(res.reason).toBe("unclear");
    expect((await stored()).size).toBe(0);
  });

  it("accepts a value that matches a number in the words and keeps the confidence", async () => {
    const res = await record("my pulse is sixty eight", { key: "heart_rate", value: 68, source_text: "sixty eight", confidence: 0.95 });
    expect(res.ok).toBe(true);
    expect((await stored()).get("heart_rate")?.confidence).toBe(0.95);
  });

  it("reads Mongolian number words", async () => {
    const res = await record("Пульс жаран найм", { key: "heart_rate", value: 68, source_text: "жаран найм" });
    expect(res.ok).toBe(true);
    expect((await record("Пульс жаран найм", { key: "bp_systolic", value: 110, source_text: "жаран найм" })).ok).toBe(false);
  });

  it("accepts a value with no number to check but caps the confidence at 0.6", async () => {
    const res = await record("I slept really well", { key: "sleep_hours", value: 8, source_text: "slept really well", confidence: 0.95 });
    expect(res.ok).toBe(true);
    expect((await stored()).get("sleep_hours")?.confidence).toBe(0.6);
  });

  it("allows unit conversions and compounds that the words really say", () => {
    const cases: Array<[KpiKey, number, string]> = [
      ["water_ml", 1800, "1.8 litres"],
      ["water_ml", 1500, "1 litre 500 ml"],
      ["exercise_min", 90, "1 hour 30 minutes"],
      ["exercise_min", 120, "2 hours"],
      ["sleep_hours", 6.5, "6 hours 30 minutes"],
      ["sleep_hours", 7.5, "7 and a half hours"],
      ["temperature_c", 37, "98.6 F"],
      ["glucose_mgdl", 99, "5.5 mmol/L"],
      ["temperature_c", 36.7, "thirty six point seven"],
    ];
    for (const [key, value, said] of cases) {
      expect(crossCheckNumber(key, value, said), `${key} ${value} from "${said}"`).not.toBe("mismatch");
    }
    expect(crossCheckNumber("water_ml", 1800, "1.8 litres")).toBe("match");
    expect(crossCheckNumber("water_ml", 1900, "1.8 litres")).toBe("mismatch");
  });

  it("matches quotes ignoring case, curly apostrophes and extra spaces", () => {
    expect(isSubstringOfUtterance("it's  FINE", "Well, it’s fine today")).toBe(true);
    expect(isSubstringOfUtterance("", "anything")).toBe(false);
    expect(isSubstringOfUtterance("fine", "mostly good")).toBe(false);
  });

  it("everything the rule-based interpreter returns passes the same check (same path for scripted and live)", async () => {
    const phrases: Array<[string, string]> = [
      ["sleep", "I slept 6 hours 30 minutes"],
      ["sleep", "about an hour and a half"],
      ["sleep", "Тав хагас цаг унтсан."],
      ["water", "1 litre 500 ml"],
      ["water", "half a litre"],
      ["exercise", "an hour"],
      ["exercise", "half an hour"],
      ["temperature", "98.6 F"],
      ["temperature", "Thirty six point seven."],
      ["glucose", "5.5 mmol/L"],
      ["blood_pressure", "120/80"],
      ["blood_pressure", "124 дээр 82"],
      ["heart_rate", "Пульс жаран найм"],
      ...DEMO_SCRIPTS.en.lines.filter((l) => QUESTIONS.some((q) => q.id === l.expect)).map((l): [string, string] => [l.expect, l.say]),
      ...DEMO_SCRIPTS.mn.lines.filter((l) => QUESTIONS.some((q) => q.id === l.expect)).map((l): [string, string] => [l.expect, l.say]),
    ];
    let checked = 0;
    for (const [id, say] of phrases) {
      const result = interpretAnswer(getQuestion(id as never), say, "en");
      for (const r of result.records) {
        const res = await executeTool(toolContext("bat", checkInId, "KPI_CAPTURE", say, { dryRun: true }), "record_measurement", {
          key: r.key,
          value: r.value,
          unit: r.unit,
          source_text: r.sourceText,
          confidence: r.confidence,
        });
        expect(res.ok, `${id}: "${say}" -> ${r.key}=${r.value} (${r.sourceText})`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(25);
  });
});

describe("free-text keys", () => {
  it("stores a note that is the astronaut's own words and refuses an invented one", async () => {
    const ok = await executeTool(
      toolContext("bat", checkInId, "KPI_CAPTURE", "Nothing special, just a long shift"),
      "record_measurement",
      { key: "day_note", value: "just a long shift", unit: "", source_text: "just a long shift", confidence: 0.9 },
    );
    expect(ok.ok).toBe(true);
    expect((await stored()).get("day_note")?.value).toBe("just a long shift");

    const invented = await executeTool(
      toolContext("bat", checkInId, "KPI_CAPTURE", "Nothing special"),
      "record_measurement",
      { key: "symptom_note", value: "felt a sharp pain in my chest", unit: "", source_text: "Nothing special", confidence: 0.9 },
    );
    expectError(invented, "source_mismatch");
    expect((await stored()).has("symptom_note")).toBe(false);
  });
});

describe("state legality", () => {
  it("record_measurement is legal in GREETING, SMALL_TALK and KPI_CAPTURE only", async () => {
    const base = { key: "mood", value: 4, source_text: "4" };
    for (const state of ["GREETING", "SMALL_TALK", "KPI_CAPTURE"] as const) {
      expect((await record("4", base, { dryRun: true }, state)).ok, state).toBe(true);
    }
    for (const state of ["CONFIRM", "SUMMARY", "DONE"] as const) {
      expectError(await record("4", base, { dryRun: true }, state), "illegal_state");
    }
    expect((await stored()).size).toBe(0);
  });

  it("DONE refuses every writing tool and nothing reaches the database", async () => {
    const tc = toolContext("bat", checkInId, "DONE", "I slept 6 hours");
    expectError(await executeTool(tc, "record_measurement", { key: "sleep_hours", value: 6, unit: "h", source_text: "6 hours", confidence: 1 }), "illegal_state");
    expectError(await executeTool(tc, "correct_measurement", { key: "sleep_hours", value: 6 }), "illegal_state");
    expectError(await executeTool(tc, "request_clarification", { key: "sleep_hours", reason: "x" }), "illegal_state");
    expectError(await executeTool(tc, "finish_confirmation", { confirmed: true }), "illegal_state");
    expect((await stored()).size).toBe(0);
  });

  it("the legality table matches the plan", () => {
    expect(isLegalIn("correct_measurement", "CONFIRM")).toBe(true);
    expect(isLegalIn("correct_measurement", "KPI_CAPTURE")).toBe(false);
    expect(isLegalIn("request_clarification", "KPI_CAPTURE")).toBe(true);
    expect(isLegalIn("request_clarification", "CONFIRM")).toBe(true);
    expect(isLegalIn("request_clarification", "SMALL_TALK")).toBe(false);
    expect(isLegalIn("finish_confirmation", "CONFIRM")).toBe(true);
    expect(isLegalIn("finish_confirmation", "KPI_CAPTURE")).toBe(false);
    expect(isLegalIn("compose_summary", "SUMMARY")).toBe(true);
    expect(isLegalIn("compose_summary", "DONE")).toBe(true);
    expect(isLegalIn("compose_summary", "KPI_CAPTURE")).toBe(false);
    expect(isLegalIn("get_baseline", "KPI_CAPTURE")).toBe(true);
  });

  it("refuses to overwrite a value that is already recorded outside the read-back", async () => {
    const res = await record("I slept 8 hours", { key: "sleep_hours", value: 8, source_text: "8 hours" }, { filled: new Set<KpiKey>(["sleep_hours"]) });
    expectError(res, "already_recorded");
    expect((await stored()).size).toBe(0);
  });
});

describe("correct_measurement, request_clarification, finish_confirmation", () => {
  it("corrects an existing value at the read-back (change: corrected) and cross-checks the number against the words", async () => {
    await record("I slept 5.5 hours", { key: "sleep_hours", value: 5.5, source_text: "5.5 hours" });
    const tc = toolContext("bat", checkInId, "CONFIRM", "No, I slept 7 hours", { filled: new Set<KpiKey>(["sleep_hours"]) });
    const res = await executeTool(tc, "correct_measurement", { key: "sleep_hours", value: 7 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.effect).toMatchObject({ type: "measurement", key: "sleep_hours", value: 7, change: "corrected" });
    expect((await stored()).get("sleep_hours")?.value).toBe(7);

    expectError(await executeTool(tc, "correct_measurement", { key: "sleep_hours", value: 9 }), "number_mismatch");
    expectError(await executeTool(tc, "correct_measurement", { key: "sleep_hours", value: 99 }), "invalid_value");
    expect((await stored()).get("sleep_hours")?.value).toBe(7);
  });

  it("request_clarification returns a clarification effect without writing", async () => {
    const res = await executeTool(toolContext("bat", checkInId, "KPI_CAPTURE", "hm"), "request_clarification", { key: "mood", reason: "no number heard" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.effect).toEqual({ type: "clarification", key: "mood", reason: "no number heard" });
    expect((await stored()).size).toBe(0);
  });

  it("finish_confirmation(true) carries the code-computed summary; false does not", async () => {
    for (const [key, value, said] of [["sleep_hours", 6, "6 hours"], ["water_ml", 1800, "1800 ml"]] as const) {
      await record(said, { key, value, source_text: said });
    }
    const tc = toolContext("bat", checkInId, "CONFIRM", "yes");
    const yes = await executeTool(tc, "finish_confirmation", { confirmed: true });
    expect(yes.ok).toBe(true);
    if (yes.ok) {
      expect(yes.effect).toEqual({ type: "confirmation", confirmed: true });
      expect((yes.data as { summary: { overall: string } }).summary.overall).toBeDefined();
    }
    const no = await executeTool(tc, "finish_confirmation", { confirmed: false });
    expect(no.ok && no.data).toEqual({ confirmed: false });
  });

  it("dryRun validates exactly like a real call but writes nothing", async () => {
    const dry = await record("I slept 6 hours", { key: "sleep_hours", value: 6, source_text: "6 hours" }, { dryRun: true });
    expect(dry.ok).toBe(true);
    expect((await stored()).size).toBe(0);
    const bad = await record("I slept 6 hours", { key: "sleep_hours", value: 7, source_text: "6 hours" }, { dryRun: true });
    expectError(bad, "number_mismatch");
  });
});

describe("get_baseline and compose_summary return code-computed data", () => {
  it("get_baseline: Bat's own 14-day mean and sd from the seeded history", async () => {
    const res = await executeTool(toolContext("bat", checkInId, "KPI_CAPTURE", "x"), "get_baseline", {});
    expect(res.ok).toBe(true);
    const data = (res.ok ? res.data : null) as { baselines: Record<string, { mean: number | null; sd: number | null; n: number }> };
    expect(data.baselines.sleep_hours.n).toBe(14);
    expect(data.baselines.sleep_hours.mean).toBeGreaterThan(6.8);
    expect(data.baselines.sleep_hours.mean).toBeLessThan(7.6);
    expect(data.baselines.sleep_hours.sd).toBeGreaterThan(0);
    expect(data.baselines).not.toHaveProperty("symptom_note");
    expect(toolResultContent(res)).toContain("sleep_hours");
  });

  it("get_baseline takes no crew id from the model", async () => {
    expectError(await executeTool(toolContext("bat", checkInId, "KPI_CAPTURE", "x"), "get_baseline", { crewId: "saraa" }), "bad_input");
  });

  it("compose_summary: legal in DONE, computed from the stored values", async () => {
    for (const [key, value, said] of [["sleep_hours", 5, "5 hours"], ["heart_rate", 68, "68"], ["mood", 4, "4"]] as const) {
      await record(said, { key, value, source_text: said });
    }
    const res = await executeTool(toolContext("bat", checkInId, "DONE", ""), "compose_summary", {});
    expect(res.ok).toBe(true);
    const findings = (res.ok ? res.data : null) as { overall: string; findings: unknown[]; disclaimer: { en: string } };
    expect(findings.disclaimer.en).toBe("Decision support, not a diagnosis.");
    expect(Array.isArray(findings.findings)).toBe(true);
    expectError(await executeTool(toolContext("bat", checkInId, "KPI_CAPTURE", ""), "compose_summary", {}), "illegal_state");
  });
});

describe("crew isolation", () => {
  it("a tool call under another crew member's session can neither write to nor read from this check-in", async () => {
    const before = await stored();
    const tc = toolContext("saraa", checkInId, "KPI_CAPTURE", "I slept 6 hours");
    const write = await executeTool(tc, "record_measurement", { key: "sleep_hours", value: 6, unit: "h", source_text: "6 hours", confidence: 1 });
    expectError(write, "write_refused");
    expectError(await executeTool({ ...tc, state: "DONE" }, "compose_summary", {}), "not_found");
    expectError(await executeTool(tc, "get_baseline", {}), "not_found");
    expect(await stored()).toEqual(before);
    expect(await listMeasurements("bat", checkInId)).toHaveLength(0);
  });

  it("a write cannot reach a confirmed check-in either", async () => {
    const tc = toolContext("bat", checkInId, "KPI_CAPTURE", "I slept 6 hours");
    expect((await executeTool(tc, "record_measurement", { key: "sleep_hours", value: 6, unit: "h", source_text: "6 hours", confidence: 1 })).ok).toBe(true);
    // confirm through the repo, then try again
    const db = await getDb();
    await db.run("UPDATE check_in SET confirmed_at = ? WHERE id = ?", new Date().toISOString(), checkInId);
    const res = await executeTool(toolContext("bat", checkInId, "KPI_CAPTURE", "my pulse is 70"), "record_measurement", { key: "heart_rate", value: 70, unit: "bpm", source_text: "70", confidence: 1 });
    expectError(res, "write_refused");
  });
});

