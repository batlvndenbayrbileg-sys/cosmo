import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Lang } from "@/lib/types";
import { getQuestion } from "@/lib/kpi/registry";
import type { Agent } from "@/server/agent/agent";
import { dangerNotice, rangeReply, rulesRangeKeys } from "@/server/agent/valueChecks";
import { setClockForTests } from "@/server/clock";
import { listAlerts } from "@/server/db/repos/alert";
import { assistantText, ctxOf, eventsOf, playTurn, startCheckIn } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

/**
 * Impossible and alarming values (team feedback 2026-11-15): "50" for body temperature made Cosmo say "Sorry, I didn't
 * catch that" when the live model asked for a clarification with reason "unclear"; a temperature of 42 °C was
 * acknowledged like any other value.
 */

/** a live-model stand-in that records nothing and asks for a clarification with reason "unclear", as Claude did */
const unclearModel: Agent = {
  name: "claude",
  decide: async (a) => ({
    records: [],
    emotion: "neutral",
    clarifications: a.expected ? [{ key: getQuestion(a.expected).keys[0], reason: "unclear" }] : [],
    replyText: "Sorry, I didn't catch that.",
  }),
};

/** a live-model stand-in that acknowledges whatever was recorded blandly */
const blandModel = (inner: Agent): Agent => ({
  name: "claude",
  decide: async (a) => ({ ...(await inner.decide(a)), replyText: "Great, thanks! Next one." }),
});

describe("rulesRangeKeys / rangeReply", () => {
  it.each<[string, Lang]>([
    ["50", "en"],
    ["50 градус", "mn"],
    ["тавь", "mn"],
    ["fifty degrees", "en"],
  ])("temperature %j is out of range", (text, lang) => {
    expect(rulesRangeKeys("temperature", text, lang)).toEqual(["temperature_c"]);
  });

  it("names what was heard and the possible range", () => {
    expect(rangeReply(getQuestion("temperature"), "50", "en", 0)).toBe(
      "I heard 50 degrees, which is too high for body temperature: it must be between 34 and 42 degrees. Could you measure again?",
    );
    expect(rangeReply(getQuestion("temperature"), "тавь", "mn", 0)).toBe(
      "Биеийн температур: 50 хэм гэж сонслоо, энэ нь хэт өндөр утга байна (34-42 хэм хооронд байх ёстой). Дахин хэмжээд хэлнэ үү?",
    );
    expect(rangeReply(getQuestion("heart_rate"), "300", "en", 0)).toMatch(/^I heard 300 beats per minute, which is too high for heart rate/u);
    expect(rangeReply(getQuestion("heart_rate"), "20", "mn", 0)).toMatch(/минутад 20 удаа гэж сонслоо, энэ нь хэт бага утга/u);
    expect(rangeReply(getQuestion("blood_pressure"), "250 over 80", "en", 0)).toMatch(/^I heard 250 over 80, which is too high for systolic/u);
    expect(rangeReply(getQuestion("temperature"), "hmm", "en", 0)).toBeNull();
  });
});

describe("dangerNotice", () => {
  it.each<[string, number, RegExp, RegExp]>([
    ["temperature_c", 42, /^Body temperature 42 degrees is above the urgent level of 39\.5 degrees/u, /Биеийн температур 42 хэм нь яаралтай босгоос \(39\.5 хэм\) дээш/u],
    ["temperature_c", 34.5, /below the urgent level of 35 degrees/u, /доош/u],
    ["heart_rate", 140, /^Heart rate 140 beats per minute is above the urgent level of 130/u, /минутад 140 удаа нь яаралтай босгоос \(минутад 130 удаа\) дээш/u],
    ["heart_rate", 35, /below the urgent level of 40/u, /доош/u],
    ["glucose_mgdl", 320, /above the urgent level of 300/u, /дээш/u],
    ["bp_systolic", 185, /above the urgent level of 180/u, /дээш/u],
  ])("%s %s", (key, value, en, mn) => {
    const rec = [{ key: key as never, value }];
    expect(dangerNotice(rec, "en")).toMatch(en);
    expect(dangerNotice(rec, "en")).toMatch(/measure again.*crew medical officer/u);
    expect(dangerNotice(rec, "mn")).toMatch(mn);
    expect(dangerNotice(rec, "mn")).toMatch(/багийн эмнэлгийн офицерт/u);
  });

  it("is empty inside the thresholds", () => {
    expect(dangerNotice([{ key: "temperature_c", value: 37.4 }, { key: "heart_rate", value: 125 }, { key: "bp_systolic", value: 150 }], "en")).toBe("");
  });
});

/* ───────────── through the turn pipeline ───────────── */

beforeEach(async () => {
  setClockForTests(TEST_TODAY);
  await freshSeededDb();
});
afterEach(() => setClockForTests(null));

const TO_TEMPERATURE: Record<Lang, string[]> = {
  en: ["Hi Cosmo", "let's start", "6.5 hours", "4", "no headache, no dizziness, no nausea", "124 over 82", "68"],
  mn: ["Сайн уу", "эхэлье", "6 цаг хагас", "дөрөв", "толгой өвдөхгүй, эргэхгүй, дотор муухайрахгүй", "124 дээр 82", "68"],
};
const AFTER_TEMPERATURE: Record<Lang, string[]> = {
  en: ["98", "1500 ml", "40 minutes", "clear", "3", "nothing", "yes"],
  mn: ["98", "1500 мл", "40 минут", "тод", "3", "үгүй", "тийм"],
};

async function atTemperature(lang: Lang): Promise<string> {
  const id = await startCheckIn("bat", lang);
  for (const line of TO_TEMPERATURE[lang]) await playTurn("bat", id, line);
  return id;
}

describe.each<[Lang, string, RegExp]>([
  ["en", "50", /^I heard 50 degrees, which is too high for body temperature/u],
  ["mn", "50 градус", /^Биеийн температур: 50 хэм гэж сонслоо, энэ нь хэт өндөр утга байна/u],
])("an impossible temperature (%s) while the model says 'unclear'", (lang, said, re) => {
  it("is explained as out of range, never 'I didn't catch that'", async () => {
    const id = await atTemperature(lang);
    const events = await playTurn("bat", id, said, { agent: unclearModel });
    const text = assistantText(events);
    expect(text).toMatch(re);
    expect(text).not.toMatch(/didn't catch|сонссонгүй|уучлаарай/iu);
    expect(eventsOf(events, "clarification")).toEqual([{ type: "clarification", key: "temperature_c", reason: "out_of_range" }]);
    expect(eventsOf(events, "assistant")[0].emotion).toBe("concerned");
    expect((await ctxOf("bat", id)).clarifyCount.temperature).toBe(1);
  });
});

describe("an impossible correction at the read-back while the model says nothing usable", () => {
  it("is explained as out of range", async () => {
    const id = await atTemperature("en");
    // temperature first, then glucose ... day note; stops before the read-back "yes"
    for (const line of ["36.6", ...AFTER_TEMPERATURE.en.slice(0, -1)]) await playTurn("bat", id, line);
    expect((await ctxOf("bat", id)).state).toBe("CONFIRM");
    const noAnswer: Agent = { name: "claude", decide: async () => ({ records: [], emotion: "neutral", yesNo: false }) };
    const events = await playTurn("bat", id, "no, my pulse was 300", { agent: noAnswer });
    expect(assistantText(events)).toMatch(/^I heard 300 beats per minute, which is too high for heart rate/u);
    expect((await ctxOf("bat", id)).state).toBe("CONFIRM");
  });
});

describe.each<Lang>(["en", "mn"])("a temperature past the danger threshold (%s)", (lang) => {
  it("is acknowledged with the urgent notice, even when the model words it blandly, and the summary raises the alert", async () => {
    const id = await atTemperature(lang);
    const { ScriptedAgent } = await import("@/server/agent/scriptedAgent");
    const events = await playTurn("bat", id, "42", { agent: blandModel(new ScriptedAgent()) });
    expect(eventsOf(events, "measurement").map((e) => [e.key, e.value])).toEqual([["temperature_c", 42]]);
    const text = assistantText(events);
    expect(text).not.toMatch(/Great, thanks/u);
    expect(text).toMatch(lang === "en" ? /above the urgent level of 39\.5 degrees/u : /яаралтай босгоос \(39\.5 хэм\) дээш/u);
    expect(text).toMatch(lang === "en" ? /What is your blood glucose/u : /Цусны сахар хэд байна/u);
    expect(eventsOf(events, "assistant")[0].emotion).toBe("concerned");

    for (const line of AFTER_TEMPERATURE[lang]) await playTurn("bat", id, line);
    expect((await ctxOf("bat", id)).state).toBe("DONE");
    const alerts = await listAlerts("bat");
    expect(alerts.some((a) => a.checkInId === id)).toBe(true);
  });
});

describe("a corrected value past the danger threshold at the read-back", () => {
  it("is confirmed with the urgent notice", async () => {
    const id = await atTemperature("mn");
    for (const line of ["36.6", ...AFTER_TEMPERATURE.mn.slice(0, -1)]) await playTurn("bat", id, line);
    expect((await ctxOf("bat", id)).state).toBe("CONFIRM");
    const events = await playTurn("bat", id, "үгүй, пульс 140");
    expect(eventsOf(events, "measurement").map((e) => [e.key, e.value])).toEqual([["heart_rate", 140]]);
    expect(assistantText(events)).toMatch(/Заслаа: пульс 140 удаа\/мин\. Насанд хүрэгчийн ерөнхий лавлагаагаар Пульс минутад 140 удаа нь яаралтай босгоос/u);
  });
});
