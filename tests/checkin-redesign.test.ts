import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KpiKey, Lang } from "@/lib/types";
import { KPI_DEFS, SENSOR_KEYS, SPOKEN_QUESTIONS, getQuestion } from "@/lib/kpi/registry";
import { DEMO_SENSOR_DAY, FOLLOW_UP_KEYS, simulateSensorDay, unusualReadings } from "@/lib/sensors/feed";
import { interpretAnswer, interpretOpportunistic } from "@/server/agent/interpret";
import { isLowWellbeing, sensorIntro, wellbeingNote } from "@/server/agent/templates";
import { setClockForTests } from "@/server/clock";
import { setSensorFeedForTests } from "@/server/checkin/sensors";
import { listAlerts } from "@/server/db/repos/alert";
import { listMeasurements } from "@/server/db/repos/measurement";
import { getCheckIn } from "@/server/db/repos/checkin";
import { loadHistory } from "@/server/checkin/service";
import { computeBaselines } from "@/lib/health";
import { cursorQuestion } from "@/server/agent/machine";
import { assistantText, ctxOf, eventsOf, playTurn, startCheckIn } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";
import { historyFromSeries } from "./helpers/health";

/**
 * The redesigned check-in (docs/research/checkin-nasa.md): a simulated sensor feed fills what a wearable records, Cosmo
 * reads back only what looks unusual and asks about it, and asks just six things no sensor can know, including a short
 * wellbeing check. The crisis path is unchanged and always wins.
 */

const DRUG_OR_DIAGNOSIS = /diagnos|prescri|medicat|dosage|treatment|depress|anxiety disorder|insomnia|онош|эм\s/iu;

describe("the simulated sensor feed (pure)", () => {
  const history = historyFromSeries({
    sleep_hours: [7.0, 7.4, 7.2, 6.9, 7.5, 7.3, 7.1, 7.6, 7.0, 7.2, 7.4, 6.8, 7.3, 7.2],
    heart_rate: [64, 66, 68, 65, 67, 66, 66, 65, 67, 68, 64, 66, 66, 67],
    bp_systolic: [117, 123, 120, 125, 116, 121, 122, 118, 120, 124, 118, 121, 119, 121],
    bp_diastolic: [76, 80, 78, 82, 75, 79, 81, 77, 78, 80, 76, 79, 78, 77],
    water_ml: [2300, 2450, 2200, 2350, 2250, 2400, 2300, 2150, 2350, 2300, 2450, 2200, 2300, 2300],
  });

  it("fills every sensor key, deterministically, inside the hard ranges", () => {
    const a = simulateSensorDay("bat", "2026-11-15", history);
    expect(a.map((r) => r.key).sort()).toEqual([...SENSOR_KEYS].sort());
    expect(simulateSensorDay("bat", "2026-11-15", history)).toEqual(a);
    for (const r of a) {
      const def = KPI_DEFS[r.key];
      expect(r.value, r.key).toBeGreaterThanOrEqual(def.min ?? -Infinity);
      expect(r.value, r.key).toBeLessThanOrEqual(def.max ?? Infinity);
    }
    const sys = a.find((r) => r.key === "bp_systolic")!.value;
    const dia = a.find((r) => r.key === "bp_diastolic")!.value;
    expect(dia).toBeLessThan(sys);
    // another day gives other (but still plausible) readings
    expect(simulateSensorDay("bat", "2026-11-16", history)).not.toEqual(a);
  });

  it("stays near the person's own usual values, so an ordinary day shows nothing unusual", () => {
    for (const day of ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]) {
      const readings = simulateSensorDay("bat", day, history);
      const hr = readings.find((r) => r.key === "heart_rate")!.value;
      expect(Math.abs(hr - 66)).toBeLessThanOrEqual(3);
      expect(unusualReadings(readings, history).filter((u) => u.key === "heart_rate" || u.key === "bp_systolic")).toEqual([]);
    }
  });

  it("the scripted demo day raises Bat's resting heart rate, and it is flagged for a follow-up question", () => {
    const readings = simulateSensorDay("bat", DEMO_SENSOR_DAY, history);
    const unusual = unusualReadings(readings, history);
    expect(unusual[0]).toMatchObject({ key: "heart_rate", direction: "high" });
    expect(unusual[0].usual).toBeCloseTo(66, 0);
    expect(FOLLOW_UP_KEYS.has(unusual[0].key)).toBe(true);
  });

  it("uses typical crew values without history", () => {
    const readings = simulateSensorDay("new", "2026-11-15", []);
    expect(readings).toHaveLength(SENSOR_KEYS.length);
    expect(readings.find((r) => r.key === "temperature_c")!.value).toBeGreaterThan(36);
  });

  it("the intro says what was logged and reads back an unusual value with the person's usual, in both languages", () => {
    const sensor = { keys: [...SENSOR_KEYS], flagged: [{ key: "heart_rate" as KpiKey, value: 82, usual: 66.2, direction: "high" as const }] };
    expect(sensorIntro(sensor, { heart_rate: 82 }, "en")).toBe(
      "Your sensors already logged your sleep, heart rate, blood pressure, temperature, exercise and water, so I only have a few questions. Your resting heart rate was 82 beats per minute, higher than your usual 66.",
    );
    expect(sensorIntro(sensor, { heart_rate: 82 }, "mn")).toMatch(/Тайван үеийн пульс минутад 82 удаа байна, ердийнхөөсөө их байна \(таны дундаж 66\)\.$/u);
    expect(sensorIntro({ keys: [...SENSOR_KEYS], flagged: [] }, {}, "en")).toMatch(/Everything looks within your usual range\.$/u);
    expect(sensorIntro({ keys: [], flagged: [] }, {}, "en")).toBe("");
  });
});

describe("the six spoken questions and the wellbeing check (pure)", () => {
  it("are at most six (plus the sensor follow-up), in plain words, both languages", () => {
    const ids = SPOKEN_QUESTIONS.map((q) => q.id).filter((id) => id !== "sensor_check");
    expect(ids).toEqual(["mood", "symptoms", "sleep_quality", "energy", "stress", "connection"]);
    for (const q of SPOKEN_QUESTIONS) {
      // nothing to look up on a device: no units, no measurement words
      expect(q.prompts.en).not.toMatch(/mg\/dL|millilitre|hours did you|blood pressure|pulse|temperature/iu);
      expect(q.prompts.mn.length).toBeGreaterThan(10);
    }
  });

  it.each<[string, Lang, KpiKey, number]>([
    ["Not great, I kept waking up.", "en", "sleep_quality", 2],
    ["like a log", "en", "sleep_quality", 5],
    ["Тийм ч сайн биш, байн байн сэрсэн.", "mn", "sleep_quality", 2],
    ["маш сайн", "mn", "sleep_quality", 5],
    ["I'm exhausted", "en", "energy", 1],
    ["pretty good", "en", "energy", 4],
    ["ядарсан байна", "mn", "energy", 2],
    ["туйлдсан", "mn", "energy", 1],
    ["not stressed at all", "en", "stress", 1],
    ["very stressed", "en", "stress", 5],
    ["a little", "en", "stress", 2],
    ["стрессгүй", "mn", "stress", 1],
    ["маш их стресстэй", "mn", "stress", 5],
    ["pretty lonely", "en", "connection", 2],
    ["very close to everyone", "en", "connection", 5],
    ["ганцаардаж байна", "mn", "connection", 2],
    ["ойр байна, дөрөв", "mn", "connection", 4],
    ["3", "en", "stress", 3],
    ["тав", "mn", "energy", 5],
  ])("%j (%s) -> %s %s", (text, lang, key, value) => {
    const res = interpretAnswer(getQuestion(KPI_DEFS[key].question), text, lang);
    expect(res.records.map((r) => [r.key, r.value])).toEqual([[key, value]]);
  });

  it("'blurry vision' in the symptom answer is the vision check; a plain no means clear", () => {
    const blurred = interpretAnswer(getQuestion("symptoms"), "a headache and blurry vision", "en");
    expect(blurred.records.find((r) => r.key === "vision_check")?.value).toBe(1);
    expect(blurred.records.find((r) => r.key === "symptom_headache")?.value).toBe(1);
    expect(interpretAnswer(getQuestion("symptoms"), "no", "en").records.find((r) => r.key === "vision_check")?.value).toBe(0);
    expect(interpretAnswer(getQuestion("symptoms"), "хараа бүдэг байна", "mn").records.find((r) => r.key === "vision_check")?.value).toBe(1);
    expect(interpretAnswer(getQuestion("symptoms"), "no headache, nausea or blurry vision", "en").records.find((r) => r.key === "vision_check")?.value).toBe(0);
  });

  it("a low answer gets one warm sentence and one suggestion (rest, a crewmate or home, the flight surgeon), never a diagnosis", () => {
    for (const lang of ["en", "mn"] as const) {
      for (const [key, value] of [["mood", 2], ["sleep_quality", 1], ["energy", 2], ["stress", 5], ["connection", 1]] as Array<[KpiKey, number]>) {
        expect(isLowWellbeing(key, value)).toBe(true);
        const note = wellbeingNote([{ key, value }], lang);
        expect(note.length, `${key} ${lang}`).toBeGreaterThan(30);
        expect(note).not.toMatch(DRUG_OR_DIAGNOSIS);
      }
      expect(wellbeingNote([{ key: "stress", value: 5 }], lang)).toMatch(lang === "en" ? /flight surgeon|support team/u : /нислэгийн эмч|дэмжлэгийн баг/u);
      expect(wellbeingNote([{ key: "connection", value: 1 }], lang)).toMatch(lang === "en" ? /crewmate|call home/u : /багийн гишүүн|гэр лүүгээ/u);
      // nothing to say when the answer is fine
      expect(wellbeingNote([{ key: "stress", value: 2 }, { key: "mood", value: 4 }], lang)).toBe("");
    }
  });

  it("a volunteered wellbeing number is taken from anywhere ('my stress is 4')", () => {
    expect(interpretOpportunistic("my stress is 4", "en").map((r) => [r.key, r.value])).toEqual([["stress", 4]]);
  });
});

describe("the redesigned check-in through the pipeline", () => {
  beforeEach(async () => {
    setClockForTests(TEST_TODAY);
    await freshSeededDb();
  });
  afterEach(() => {
    setClockForTests(null);
    setSensorFeedForTests(null);
  });

  async function started(crew: string, lang: Lang): Promise<string> {
    const id = await startCheckIn(crew, lang);
    for (const say of lang === "en" ? ["hello", "fine thanks", "let's start"] : ["Сайн уу", "гайгүй", "эхэлье"]) await playTurn(crew, id, say);
    return id;
  }

  it("fills the sensor readings at the first turn, marks them 'sensor', and never asks them", async () => {
    const id = await startCheckIn("saraa", "en");
    await playTurn("saraa", id, "hello");
    const rows = await listMeasurements("saraa", id);
    expect(rows.map((r) => r.key).sort()).toEqual([...SENSOR_KEYS].sort());
    expect(rows.every((r) => r.source === "sensor")).toBe(true);
    const ctx = await ctxOf("saraa", id);
    expect(ctx.sensorFilled.sort()).toEqual([...SENSOR_KEYS].sort());
    // nothing unusual for Saraa: the follow-up question is skipped, the mood comes first
    expect(ctx.skipped).toContain("sensor_check");
  });

  it("a value said by voice replaces the sensor reading and goes through the same validation", async () => {
    const id = await started("saraa", "en");
    const said = await playTurn("saraa", id, "4, and my pulse is 72");
    expect(eventsOf(said, "measurement").map((m) => [m.key, m.value])).toEqual([
      ["mood", 4],
      ["heart_rate", 72],
    ]);
    const hr = (await listMeasurements("saraa", id)).find((m) => m.key === "heart_rate");
    // the astronaut's own value (typed input reads "simulated" in the scripted demo mode), no longer the sensor's
    expect(hr).toMatchObject({ value: 72, source: "simulated" });
    expect((await ctxOf("saraa", id)).sensorFilled).not.toContain("heart_rate");
    // an impossible value is still refused and the sensor reading stays
    const before = (await listMeasurements("saraa", id)).find((m) => m.key === "bp_systolic")?.value;
    await playTurn("saraa", id, "no symptoms, and my blood pressure is 400 over 80");
    expect((await listMeasurements("saraa", id)).find((m) => m.key === "bp_systolic")?.value).toBe(before);
  });

  it("asks the six spoken questions only, then reads back what was said", async () => {
    const id = await started("saraa", "mn");
    const asked: string[] = [];
    let last: Awaited<ReturnType<typeof playTurn>> = [];
    for (const say of ["дөрөв", "үгүй", "сайн", "дөрөв", "бага зэрэг", "ойр байна"]) {
      asked.push(String(cursorQuestion(await ctxOf("saraa", id))));
      last = await playTurn("saraa", id, say);
    }
    expect(asked).toEqual(["mood", "symptoms", "sleep_quality", "energy", "stress", "connection"]);
    expect((await ctxOf("saraa", id)).state).toBe("CONFIRM");
    expect(assistantText(last)).toMatch(/^Таны хэлснээр: сэтгэл санаа 4\/5, шинж тэмдэг алга, нойрны чанар 4\/5, эрч хүч 4\/5, стресс 2\/5, ойр дотно байдал 4\/5\. Мэдрэгчийн үзүүлэлтүүд ч хадгалагдсан\. Бүгд зөв үү\?$/u);
  });

  it("a low stress answer gets the supportive line before the next question (en)", async () => {
    const id = await started("saraa", "en");
    for (const say of ["4", "no", "well"]) await playTurn("saraa", id, say);
    await playTurn("saraa", id, "3");
    const stressed = await playTurn("saraa", id, "very stressed");
    expect(eventsOf(stressed, "measurement").map((m) => [m.key, m.value])).toEqual([["stress", 5]]);
    const text = assistantText(stressed);
    expect(text).toMatch(/^Got it, 5 out of 5\. That sounds like a lot to carry\./u);
    expect(text).toMatch(/flight surgeon or the support team on Earth/u);
    expect(text).toMatch(/How connected do you feel/u);
    expect(text).not.toMatch(DRUG_OR_DIAGNOSIS);
  });

  it.each<[Lang, string, RegExp]>([
    ["en", "I don't want to live anymore", /crew medical officer or the flight surgeon right now/u],
    ["mn", "үхмээр байна", /эмнэлгийн офицер эсвэл нислэгийн эмчтэйгээ яг одоо холбогдоорой/u],
  ])("crisis words at the wellbeing questions still win (%s): the crisis reply and one red alert, nothing recorded", async (lang, words, template) => {
    const id = await started("saraa", lang);
    for (const say of lang === "en" ? ["2", "no", "badly"] : ["хоёр", "үгүй", "муу"]) await playTurn("saraa", id, say);
    expect((await ctxOf("saraa", id)).state).toBe("KPI_CAPTURE");
    const events = await playTurn("saraa", id, words);
    expect(eventsOf(events, "measurement")).toEqual([]);
    expect(assistantText(events)).toMatch(template);
    const alerts = (await listAlerts("saraa")).filter((a) => a.checkInId === id);
    expect(alerts.map((a) => a.level)).toEqual(["red"]);
  });

  it("without a sensor feed every measurement is asked after the spoken questions, the old way", async () => {
    setSensorFeedForTests(false);
    const id = await started("saraa", "en");
    expect(await listMeasurements("saraa", id)).toEqual([]);
    let last: Awaited<ReturnType<typeof playTurn>> = [];
    for (const say of ["4", "no", "4", "4", "2", "4"]) last = await playTurn("saraa", id, say);
    expect(eventsOf(last, "state")[0].expectedQuestion).toBe("sleep");
    expect(assistantText(last)).toMatch(/How many hours did you sleep\?$/u);
  });

  it("the history baselines of the wellbeing answers are seeded (so 'usual' exists for them)", async () => {
    const id = await started("bat", "en");
    const b = computeBaselines(await loadHistory("bat", (await getCheckIn("bat", id)).localDate));
    for (const key of ["sleep_quality", "energy", "stress", "connection"] as const) expect(b[key]?.mean, key).not.toBeNull();
  });
});
