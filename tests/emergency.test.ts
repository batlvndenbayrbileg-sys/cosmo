import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILTIN_CALL_FOR_HELP, BUILTIN_GUIDES, isReviewed, matchEmergency, scenarioSchema } from "@/lib/emergency";
import { emergencyImagePath, loadEmergencyLibrary } from "@/server/emergency/load";

const valid = {
  id: "fainting-unconscious",
  title: { en: "Crewmate fainted", mn: "Багийн гишүүн ухаан алдсан" },
  triggers: { en: ["fainted", "passed out"], mn: ["ухаан алдсан"] },
  steps: [
    { text: { en: "Tell your crew medical officer and ground now.", mn: "Багийн эмч болон Дэлхийд одоо мэдэгд." }, image: "step-1.png" },
    { text: { en: "Second step.", mn: "Хоёр дахь алхам." } },
  ],
  sources: [{ title: "Example first-aid source", url: "https://example.org/first-aid" }],
  reviewedBy: "PENDING",
};

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cosmo-emergency-"));
  fs.mkdirSync(path.join(dir, "fainting-unconscious"));
  fs.writeFileSync(path.join(dir, "fainting-unconscious", "scenario.json"), JSON.stringify(valid));
  fs.writeFileSync(path.join(dir, "fainting-unconscious", "step-1.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.mkdirSync(path.join(dir, "broken"));
  fs.writeFileSync(path.join(dir, "broken", "scenario.json"), "{ not json");
  fs.mkdirSync(path.join(dir, "wrong-id"));
  fs.writeFileSync(path.join(dir, "wrong-id", "scenario.json"), JSON.stringify({ ...valid, id: "other" }));
  fs.mkdirSync(path.join(dir, "_drafts"));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("scenario format", () => {
  it("accepts a well-formed scenario and defaults reviewedBy to PENDING", () => {
    const { reviewedBy, ...rest } = valid;
    void reviewedBy;
    const parsed = scenarioSchema.parse(rest);
    expect(parsed.reviewedBy).toBe("PENDING");
    expect(isReviewed(parsed)).toBe(false);
    expect(isReviewed({ reviewedBy: "Dr. A. Example, flight surgeon, 2026-11-15" })).toBe(true);
  });

  it("rejects unsafe image names, empty steps and missing Mongolian text", () => {
    expect(scenarioSchema.safeParse({ ...valid, steps: [{ text: valid.steps[0].text, image: "../../secret.png" }] }).success).toBe(false);
    expect(scenarioSchema.safeParse({ ...valid, steps: [] }).success).toBe(false);
    expect(scenarioSchema.safeParse({ ...valid, title: { en: "x" } }).success).toBe(false);
  });
});

describe("loadEmergencyLibrary", () => {
  it("loads valid folders, skips broken ones with a reason, ignores _drafts, then the built-in guides", () => {
    const lib = loadEmergencyLibrary(dir);
    expect(lib.scenarios.map((s) => s.id)).toEqual(["fainting-unconscious", ...BUILTIN_GUIDES.map((g) => g.id)]);
    expect(lib.scenarios.at(-1)?.id).toBe(BUILTIN_CALL_FOR_HELP.id);
    expect(lib.problems.some((p) => p.startsWith("broken:"))).toBe(true);
    expect(lib.problems.some((p) => p.startsWith("wrong-id:"))).toBe(true);
    // the team folder "fainting-unconscious" is an extra; a folder named "fainting" would replace the built-in one
    expect(lib.scenarios.filter((s) => s.id === "fainting")).toHaveLength(1);
    const s = lib.scenarios[0];
    expect(s.steps[0].imageUrl).toBe("/api/emergency/fainting-unconscious/image/step-1.png");
    expect(s.steps[1].imageUrl).toBeNull();
  });

  it("works with no folder at all (the built-in guides only, as on Vercel)", () => {
    const lib = loadEmergencyLibrary(path.join(dir, "does-not-exist"));
    expect(lib.scenarios).toHaveLength(BUILTIN_GUIDES.length);
    expect(lib.scenarios.every((s) => s.builtIn)).toBe(true);
  });
});

describe("emergencyImagePath", () => {
  it("serves only existing step images inside the folder", () => {
    expect(emergencyImagePath("fainting-unconscious", "step-1.png", dir)).toBe(path.resolve(dir, "fainting-unconscious", "step-1.png"));
    expect(emergencyImagePath("fainting-unconscious", "step-2.png", dir)).toBeNull();
    expect(emergencyImagePath("..", "step-1.png", dir)).toBeNull();
    expect(emergencyImagePath("fainting-unconscious", "..\\..\\x.png", dir)).toBeNull();
    expect(emergencyImagePath("fainting-unconscious", "scenario.json", dir)).toBeNull();
  });
});

describe("matchEmergency", () => {
  // loaded inside each test: the folders exist only after beforeAll has run
  const lib = () => loadEmergencyLibrary(dir).scenarios;

  it("matches the team's trigger words in either language, case-insensitively", () => {
    expect(matchEmergency("I think Alex just PASSED OUT", lib())).toEqual({ scenarioId: "fainting-unconscious", matched: "passed out" });
    expect(matchEmergency("Бат ухаан алдсан байна", lib())?.scenarioId).toBe("fainting-unconscious");
  });

  it("routes to the built-in guides, and falls back to the get-help card for other serious-symptom words", () => {
    expect(matchEmergency("I have chest pain", lib())?.scenarioId).toBe("chest-pain");
    expect(matchEmergency("I am in severe pain", lib())?.scenarioId).toBe(BUILTIN_CALL_FOR_HELP.id);
  });

  it("stays closed for ordinary answers", () => {
    expect(matchEmergency("I slept about six hours", lib())).toBeNull();
    expect(matchEmergency("", lib())).toBeNull();
  });
});
