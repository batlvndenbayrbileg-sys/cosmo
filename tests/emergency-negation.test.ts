import { describe, expect, it } from "vitest";
import { matchEmergency } from "@/lib/emergency/match";
import { BUILTIN_GUIDES as BUILTIN_SCENARIOS } from "@/lib/emergency/guides";

/** Reviewer note (wave 2, 2026-11-15): "I don't have chest pain" opened the chest-pain guide. */
describe("matchEmergency: clear denials do not open a guide; anything else still does", () => {
  const match = (t: string) => matchEmergency(t, BUILTIN_SCENARIOS)?.scenarioId ?? null;

  it.each([
    "I don't have chest pain",
    "no chest pain, no headache",
    "I do not have chest pain today",
    "never had chest pain",
    "цээж өвдөхгүй байна",
    "цээж өвдөх юм алга",
    "зүрх өвдөхгүй",
  ])("denied: %s", (t) => {
    expect(match(t)).toBeNull();
  });

  it.each([
    ["I have chest pain", "chest-pain"],
    ["my chest hurts", "chest-pain"],
    ["цээж өвдөж байна", "chest-pain"],
    ["зүрх өвдөөд байна", "chest-pain"],
    // a denial of one thing does not hide another that is affirmed
    ["no headache, but chest pain since the morning", "chest-pain"],
    ["толгой өвдөхгүй, харин цээж өвдөж байна", "chest-pain"],
    // unsure wording still opens the guide (safer)
    ["maybe chest pain?", "chest-pain"],
  ])("affirmed: %s", (t, id) => {
    expect(match(t)).toBe(id);
  });
});
