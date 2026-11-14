import { describe, expect, it } from "vitest";
import { KPI_DEFS, QUESTIONS, formatValue } from "@/lib/kpi/registry";
import { evaluateDay, DISCLAIMER } from "@/lib/health";
import type {
  CrewPublic,
  Finding,
  KpiKey,
  Lang,
  MeasurementValue,
  RedFlag,
  SummaryFindings,
  Task,
} from "@/lib/types";
import { KPI_KEYS } from "@/lib/types";
import type { InterpretedRecord } from "@/server/agent/interpret";
import {
  askQuestion,
  askWhatToChange,
  clarify,
  closing,
  correctionAck,
  emotionFor,
  greeting,
  greetingName,
  proposeMeasurements,
  readBack,
  redFlagNotice,
  smallTalkReply,
  summarySpeech,
  type ClarifyReason,
} from "@/server/agent/templates";
import { batDemoToday, batHistory } from "./helpers/health";

const LANGS: Lang[] = ["en", "mn"];
const REASONS: ClarifyReason[] = ["range", "type", "unclear"];

function crew(id: string, name: string, preferredLanguage: Lang = "en"): CrewPublic {
  return { id, name, role: "Flight engineer", preferredLanguage, mascotVariant: 0, avatarSeed: `${id}-0` };
}

const BAT = crew("bat", "Bat", "mn");

function rec(key: KpiKey, value: MeasurementValue): InterpretedRecord {
  return { key, value, unit: KPI_DEFS[key].unit, sourceText: String(value), confidence: 0.9 };
}

/** emoji and pictographs must never reach the product text */
const EMOJI = /\p{Extended_Pictographic}|[\u{1F000}-\u{1FFFF}]/u;
const FORBIDDEN = ["diagnos", "prescri", "medicat", "dose"];

function expectClean(text: string): void {
  expect(text.trim().length).toBeGreaterThan(0);
  expect(text).not.toMatch(EMOJI);
  const lower = text.toLowerCase();
  for (const word of FORBIDDEN) expect(lower).not.toContain(word);
}

/* ───────────── greeting ───────────── */

describe("greetingName", () => {
  it("writes the four crew names in Mongolian Cyrillic", () => {
    expect(greetingName(crew("bat", "Bat"), "mn")).toBe("Бат");
    expect(greetingName(crew("saraa", "Saraa"), "mn")).toBe("Сараа");
    expect(greetingName(crew("alex", "Alex"), "mn")).toBe("Алекс");
    expect(greetingName(crew("mira", "Mira"), "mn")).toBe("Мира");
  });

  it("keeps the name as is in English and for unknown crew", () => {
    expect(greetingName(crew("bat", "Bat"), "en")).toBe("Bat");
    expect(greetingName(crew("zed", "Zed"), "mn")).toBe("Zed");
    expect(greetingName(crew("zed", "Zed"), "en")).toBe("Zed");
  });
});

describe("greeting", () => {
  it("uses the exact wording from the brief", () => {
    expect(greeting(BAT, "en")).toBe("Hi Bat, I'm Cosmo. How are you feeling today?");
    expect(greeting(BAT, "mn")).toBe("Сайн уу, Бат! Би Cosmo байна. Өнөөдөр ямар байна даа?");
  });

  it("greets the other crew by their own name", () => {
    expect(greeting(crew("saraa", "Saraa"), "mn")).toBe("Сайн уу, Сараа! Би Cosmo байна. Өнөөдөр ямар байна даа?");
    expect(greeting(crew("alex", "Alex"), "en")).toBe("Hi Alex, I'm Cosmo. How are you feeling today?");
  });
});

/* ───────────── small talk ───────────── */

describe("smallTalkReply", () => {
  it.each(LANGS)("answers in one clean sentence (%s)", (lang) => {
    for (const text of ["good", "I'm tired", "stressed", "not great", "okay", "", "bla bla"]) {
      for (let turn = 0; turn < 4; turn++) {
        const reply = smallTalkReply(lang, turn, text);
        expectClean(reply);
        expect(reply.length).toBeLessThan(120);
      }
    }
  });

  it("varies with the sentiment words", () => {
    expect(smallTalkReply("en", 0, "I feel great")).not.toBe(smallTalkReply("en", 0, "I'm exhausted"));
    expect(smallTalkReply("en", 0, "very stressed")).not.toBe(smallTalkReply("en", 0, "good"));
    expect(smallTalkReply("mn", 0, "сайн байна")).not.toBe(smallTalkReply("mn", 0, "ядарсан байна"));
    expect(smallTalkReply("mn", 0, "стресстэй байна")).not.toBe(smallTalkReply("mn", 0, "сайн"));
  });

  it("varies with the turn number and never fails on odd indexes", () => {
    expect(smallTalkReply("en", 0, "good")).not.toBe(smallTalkReply("en", 1, "good"));
    expect(() => smallTalkReply("en", -3, "good")).not.toThrow();
    expect(() => smallTalkReply("mn", 1.5, "x")).not.toThrow();
  });

  it("reads 'not good' as low, not positive", () => {
    expect(smallTalkReply("en", 0, "not good")).not.toBe(smallTalkReply("en", 0, "good"));
  });
});

describe("proposeMeasurements", () => {
  it("uses the exact wording from the brief", () => {
    expect(proposeMeasurements("en")).toBe("Shall we log today's measurements together?");
    expect(proposeMeasurements("mn")).toBe("Хоёулаа өнөөдрийн хэмжилтүүдээ хийх үү?");
  });
});

/* ───────────── questions ───────────── */

describe("askQuestion", () => {
  it.each(LANGS)("without an acknowledgement it is exactly the registry prompt (%s)", (lang) => {
    for (const q of QUESTIONS) {
      expect(askQuestion(q, lang)).toBe(q.prompts[lang]);
      expect(askQuestion(q, lang, [])).toBe(q.prompts[lang]);
    }
  });

  it("acknowledges a recorded value and then asks the next question", () => {
    const mood = QUESTIONS[1];
    expect(askQuestion(mood, "en", [rec("sleep_hours", 7)])).toBe(`Got it, 7 hours. ${mood.prompts.en}`);
    expect(askQuestion(mood, "mn", [rec("sleep_hours", 7)])).toBe(`Ойлголоо, 7 цаг. ${mood.prompts.mn}`);
  });

  it("acknowledges blood pressure as one phrase", () => {
    const hr = QUESTIONS[4];
    const text = askQuestion(hr, "en", [rec("bp_systolic", 124), rec("bp_diastolic", 82)]);
    expect(text).toBe(`Got it, 124 over 82. ${hr.prompts.en}`);
    expect(askQuestion(hr, "mn", [rec("bp_systolic", 124), rec("bp_diastolic", 82)])).toContain("124 дээр 82");
  });

  it("acknowledges symptoms in a calm way", () => {
    const bp = QUESTIONS[3];
    const none = [rec("symptom_headache", 0), rec("symptom_dizziness", 0), rec("symptom_nausea", 0)];
    expect(askQuestion(bp, "en", none)).toBe(`No symptoms, noted. ${bp.prompts.en}`);
    const some = [rec("symptom_headache", 1), rec("symptom_dizziness", 0), rec("symptom_nausea", 1)];
    expect(askQuestion(bp, "en", some)).toBe(`Noted: a headache and nausea. ${bp.prompts.en}`);
    expect(askQuestion(bp, "mn", none)).toContain("Шинж тэмдэг алга");
  });

  it("speaks scales and categories as words", () => {
    const next = QUESTIONS[2];
    expect(askQuestion(next, "en", [rec("mood", 4)])).toContain("4 out of 5");
    expect(askQuestion(next, "mn", [rec("mood", 4)])).toContain("5-аас 4");
    // lower case inside the sentence: "Got it, slightly blurred."
    expect(askQuestion(QUESTIONS[11], "en", [rec("vision_check", 1)])).toContain("Got it, slightly blurred.");
  });

  it("every acknowledgement and question is clean text in both languages", () => {
    for (const lang of LANGS) {
      for (const q of QUESTIONS) {
        const keyed = q.keys.filter((k) => KPI_DEFS[k].type !== "text").map((k) => rec(k, KPI_DEFS[k].min ?? 1));
        expectClean(askQuestion(q, lang, keyed));
      }
    }
  });
});

describe("clarify", () => {
  it.each(LANGS)("is non-empty and clean for every question, reason and attempt (%s)", (lang) => {
    for (const q of QUESTIONS) {
      for (const reason of REASONS) {
        for (const attempt of [0, 1, 2, 3]) {
          expectClean(clarify(q, lang, reason, attempt));
        }
      }
    }
  });

  it("re-asks the registry question on the first attempts", () => {
    const sleep = QUESTIONS[0];
    expect(clarify(sleep, "en", "unclear", 0)).toContain(sleep.prompts.en);
    expect(clarify(sleep, "mn", "type", 0)).toContain(sleep.prompts.mn);
    expect(clarify(sleep, "en", "unclear", 1)).toContain(sleep.prompts.en);
  });

  it("names the allowed range for a range problem", () => {
    const sleep = QUESTIONS[0];
    expect(clarify(sleep, "en", "range", 0)).toContain("between 0 and 14 hours");
    expect(clarify(sleep, "mn", "range", 0)).toContain("0-14");
  });

  it("offers to skip on the second attempt and moves on after that", () => {
    const sleep = QUESTIONS[0];
    expect(clarify(sleep, "en", "unclear", 1).toLowerCase()).toContain("skip");
    const moveOn = clarify(sleep, "en", "unclear", 2);
    expect(moveOn).toContain("when we confirm");
    expect(moveOn).not.toContain(sleep.prompts.en);
    expect(clarify(sleep, "mn", "range", 2)).toContain("баталгаажуулах");
  });

  it("different attempts say different things", () => {
    const q = QUESTIONS[4];
    expect(clarify(q, "en", "unclear", 0)).not.toBe(clarify(q, "en", "unclear", 1));
  });
});

/* ───────────── read-back and correction ───────────── */

describe("readBack", () => {
  const values = batDemoToday();

  it.each(LANGS)("contains every stored value, formatted by the registry (%s)", (lang) => {
    const text = readBack(values, lang);
    for (const key of KPI_KEYS) {
      const v = values[key];
      if (v === undefined) continue;
      expect(text).toContain(formatValue(key, v, lang));
    }
  });

  it("ends with the confirmation question", () => {
    expect(readBack(values, "en").endsWith("Is everything correct?")).toBe(true);
    expect(readBack(values, "mn").endsWith("Бүгд зөв үү?")).toBe(true);
  });

  it("reads blood pressure as one phrase and keeps the question order", () => {
    const text = readBack(values, "en");
    expect(text).toContain("blood pressure 124 mmHg over 82 mmHg");
    expect(text.indexOf("sleep")).toBeLessThan(text.indexOf("mood"));
    expect(text.indexOf("heart rate")).toBeLessThan(text.indexOf("body temperature"));
    expect(readBack(values, "mn")).toContain("цусны даралт 124 mmHg дээр 82 mmHg");
  });

  it("includes the notes and shortens very long ones", () => {
    const text = readBack({ ...values, symptom_note: "my back hurts", day_note: "x ".repeat(200) }, "en");
    expect(text).toContain("my back hurts");
    expect(text.length).toBeLessThan(900);
  });

  it("only mentions what is stored", () => {
    const text = readBack({ sleep_hours: 6 }, "en");
    expect(text).toContain("6 h");
    expect(text).not.toContain("mood");
    expect(readBack({}, "en")).toBe("Is everything correct?");
    expect(readBack({}, "mn")).toBe("Бүгд зөв үү?");
  });

  it("is clean text", () => {
    for (const lang of LANGS) expectClean(readBack(values, lang));
  });
});

describe("correctionAck", () => {
  it("confirms the new value and asks again", () => {
    expect(correctionAck("sleep_hours", 6, "en")).toBe("Updated: sleep 6 h. Is everything correct now?");
    expect(correctionAck("sleep_hours", 6, "mn")).toBe("Заслаа: унтсан цаг 6 цаг. Одоо бүгд зөв үү?");
  });

  it("works for every key", () => {
    for (const key of KPI_KEYS) {
      const value: MeasurementValue = KPI_DEFS[key].type === "text" ? "note" : (KPI_DEFS[key].min ?? 1);
      for (const lang of LANGS) {
        const text = correctionAck(key, value, lang);
        expectClean(text);
        expect(text).toContain(formatValue(key, value, lang));
      }
    }
  });
});

describe("askWhatToChange", () => {
  it("is a short question in both languages", () => {
    expect(askWhatToChange("en")).toBe("Of course. What would you like to change?");
    expect(askWhatToChange("mn")).toBe("За, юуг засах вэ?");
  });
});

/* ───────────── summary ───────────── */

function finding(key: KpiKey, n: number): Finding {
  return {
    key,
    status: "yellow",
    reason: "fixed_range",
    value: n,
    unit: KPI_DEFS[key].unit,
    baselineMean: null,
    z: null,
    direction: "low",
    text: { en: `Finding number ${n} for ${key}.`, mn: `${n}-р дүгнэлт ${key}.` },
  };
}

function task(n: number): Task {
  return {
    id: `t${n}`,
    hazard: null,
    relatedKeys: [],
    title: { en: `Suggestion number ${n}`, mn: `${n}-р санал` },
    why: { en: "Because.", mn: "Учир нь." },
  };
}

function redFlag(): RedFlag {
  return {
    rule: "HEADACHE_PLUS_VISION",
    keys: ["symptom_headache", "vision_check"],
    text: { en: "Alert text.", mn: "Анхааруулга." },
  };
}

function summaryWith(overrides: Partial<SummaryFindings> = {}): SummaryFindings {
  return {
    overall: "yellow",
    readiness: 72,
    headline: { en: "A few things to keep an eye on today.", mn: "Өнөөдөр анхаарах хэдэн зүйл байна." },
    findings: [],
    recommendations: [],
    redFlags: [],
    disclaimer: DISCLAIMER,
    ...overrides,
  };
}

describe("summarySpeech", () => {
  it.each(LANGS)("speaks the real Bat summary: headline, findings, suggestions, disclaimer (%s)", (lang) => {
    const { summary } = evaluateDay(batDemoToday(), batHistory());
    const text = summarySpeech(summary, lang);
    expect(text).toContain(summary.headline[lang]);
    expect(text).toContain(DISCLAIMER[lang]);
    for (const f of summary.findings) expect(text).toContain(f.text[lang]);
    for (const t of summary.recommendations) expect(text).toContain(t.title[lang]);
    expect(text.length).toBeLessThan(900);
    expect(text).not.toMatch(EMOJI);
  });

  it("speaks at most two findings and two suggestions", () => {
    const summary = summaryWith({
      findings: [1, 2, 3, 4].map((n) => finding("sleep_hours", n)),
      recommendations: [1, 2, 3, 4].map(task),
    });
    const text = summarySpeech(summary, "en");
    expect(text).toContain("Finding number 1");
    expect(text).toContain("Finding number 2");
    expect(text).not.toContain("Finding number 3");
    expect(text).toContain("Suggestion number 1");
    expect(text).toContain("Suggestion number 2");
    expect(text).not.toContain("Suggestion number 3");
    const mn = summarySpeech(summary, "mn");
    expect(mn).not.toContain("3-р дүгнэлт");
    expect(mn).not.toContain("3-р санал");
  });

  it("keeps the order: headline, findings, suggestions, disclaimer", () => {
    const text = summarySpeech(summaryWith({ findings: [finding("sleep_hours", 1)], recommendations: [task(1)] }), "en");
    const order = ["A few things", "Finding number 1", "Suggestion number 1", "Decision support"].map((s) => text.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it("adds the red-flag notice only when there is a red flag", () => {
    const calm = summarySpeech(summaryWith(), "en");
    expect(calm).not.toContain("medical officer");
    const flagged = summarySpeech(summaryWith({ overall: "red", redFlags: [redFlag()] }), "en");
    expect(flagged).toContain("crew medical officer");
    expect(flagged).toContain("ground");
    const flaggedMn = summarySpeech(summaryWith({ overall: "red", redFlags: [redFlag()] }), "mn");
    expect(flaggedMn).toContain("эмнэлгийн офицер");
    expect(flaggedMn).toContain("газрын");
  });

  it("is clean apart from the fixed disclaimer", () => {
    for (const lang of LANGS) {
      const text = summarySpeech(
        summaryWith({ findings: [finding("sleep_hours", 1)], recommendations: [task(1)], redFlags: [redFlag()] }),
        lang,
      ).replace(DISCLAIMER[lang], "");
      expectClean(text);
    }
  });
});

describe("redFlagNotice", () => {
  it("is empty without flags", () => {
    expect(redFlagNotice([], "en")).toBe("");
    expect(redFlagNotice([], "mn")).toBe("");
  });

  it("tells the person calmly that the medical officer and ground are informed", () => {
    const en = redFlagNotice([redFlag()], "en");
    expect(en).toContain("crew medical officer");
    expect(en).toContain("ground");
    expect(en).toContain("alert");
    expectClean(en);
    const mn = redFlagNotice([redFlag()], "mn");
    expect(mn).toContain("эмнэлгийн офицер");
    expect(mn).toContain("газрын");
    expect(mn).toContain("анхааруулга");
    expectClean(mn);
  });

  it("does not repeat itself for several flags", () => {
    expect(redFlagNotice([redFlag(), redFlag()], "en")).toBe(redFlagNotice([redFlag()], "en"));
  });
});

describe("closing and emotionFor", () => {
  it("closing is a short warm line", () => {
    for (const lang of LANGS) {
      expectClean(closing(lang));
      expect(closing(lang).length).toBeLessThan(140);
    }
  });

  it("maps each kind of line to an avatar emotion", () => {
    expect(emotionFor("greeting")).toBe("happy");
    expect(emotionFor("redflag")).toBe("concerned");
    for (const kind of ["question", "clarify", "confirm", "summary"] as const) {
      expect(emotionFor(kind)).toBe("neutral");
    }
  });
});
