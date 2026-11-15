/**
 * Background noise must never make Cosmo say "Уучлаарай, сайн сонссонгүй / Sorry, I didn't catch that" (user feedback
 * 2026-11-15):
 *  - a transcript of noise has no words (hasWords false): the speech route answers with the quiet 422 and the client
 *    listens again without a reply;
 *  - the "didn't catch" line comes only after the SECOND unclear answer to the same question.
 */
import { describe, expect, it } from "vitest";
import { hasWords } from "@/server/speech/stt";
import { reaskAfterFailedAnswer } from "@/server/agent/reask";
import { clarify } from "@/server/agent/templates";
import { getQuestion } from "@/lib/kpi/registry";

const DIDNT_CATCH = /didn't catch|сонссонгүй|сонсогдсонгүй|уучлаарай|sorry/iu;

describe("hasWords: noise transcripts are not an answer", () => {
  it.each([
    "(шуугиан)",
    "(Шуугиан.)",
    "[music]",
    "[Music] [Applause]",
    "*noise*",
    "♪ ♪",
    "♪ music ♪",
    "<noise>",
    "{laughter}",
    "noise",
    "Background noise.",
    "Шуугиан",
    "хөгжим",
    "чимээ",
    "а",
    "О.",
    "I",
    "s",
    "ааааа",
    "Ммммм...",
    "ssss",
    "хаха",
    "hahaha",
    "the",
    "нь",
    "uh, the",
    "erm",
    "a a a",
  ])("no words: %j", (text) => {
    expect(hasWords(text)).toBe(false);
  });

  it.each([
    "68",
    "5",
    "Тийм",
    "Үгүй",
    "Алга",
    "no",
    "yes",
    "ok",
    "so-so",
    "cough",
    "Ханиалга байна",
    "breathing is fine",
    "sound",
    "1.5 литр",
    "найм",
    "Тод байна",
    "noise kept me awake",
    "Хөгжим сонсоод унтсан",
    "I slept well",
  ])("words: %j", (text) => {
    expect(hasWords(text)).toBe(true);
  });
});

describe("reaskAfterFailedAnswer: 'didn't catch' only after two unclear answers", () => {
  const q = getQuestion("sleep");

  it.each(["en", "mn"] as const)("first unclear answer (%s): asks again gently, no apology", (lang) => {
    const text = reaskAfterFailedAnswer(q, lang, "unclear", 0);
    expect(text).toContain(q.prompts[lang]);
    expect(text).not.toMatch(DIDNT_CATCH);
  });

  it.each(["en", "mn"] as const)("first answer without a number (%s): asks again, no 'didn't catch'", (lang) => {
    const text = reaskAfterFailedAnswer(q, lang, "type", 0);
    expect(text).toContain(q.prompts[lang]);
    expect(text).not.toMatch(DIDNT_CATCH);
  });

  it.each(["en", "mn"] as const)("second unclear answer (%s): the didn't-catch line with the skip hint", (lang) => {
    const text = reaskAfterFailedAnswer(q, lang, "unclear", 1);
    expect(text).toBe(clarify(q, lang, "unclear", 1));
    expect(text).toMatch(DIDNT_CATCH);
  });

  it.each(["en", "mn"] as const)("third (%s): moves on as before", (lang) => {
    expect(reaskAfterFailedAnswer(q, lang, "unclear", 2)).toBe(clarify(q, lang, "unclear", 2));
  });

  it.each(["en", "mn"] as const)("out of range (%s) still says why, the first time too", (lang) => {
    expect(reaskAfterFailedAnswer(q, lang, "range", 0)).toBe(clarify(q, lang, "range", 0));
  });
});
