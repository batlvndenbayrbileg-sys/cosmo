import { describe, expect, it } from "vitest";
import {
  crewForLanguage,
  crewForVoice,
  detectIdentityClaim,
  displayName,
  identifyCrew,
  languageOfText,
} from "@/lib/identity";
import {
  HIGH_VOICE_HZ,
  LOW_VOICE_HZ,
  classifyVoice,
  estimateFrameF0,
  estimatePitch,
  voiceClearlyChanged,
} from "@/lib/voice/pitch";

/**
 * Who is speaking on the assistant screen: language x on-device voice guess -> crew member, a name said outright wins,
 * corrections in both languages, and the pitch estimator itself on synthetic signals.
 */

describe("identity: language x voice -> crew", () => {
  it.each([
    ["mn", "male", "bat"],
    ["mn", "female", "saraa"],
    ["en", "male", "alex"],
    ["en", "female", "mira"],
  ] as const)("%s + %s -> %s", (lang, voice, crewId) => {
    expect(crewForVoice(lang, voice)).toBe(crewId);
    expect(identifyCrew({ lang, voice })).toEqual({ crewId, reason: "voice", candidates: crewForLanguage(lang) });
  });

  it("an unknown voice keeps the previous person of the same language, otherwise asks", () => {
    expect(crewForVoice("mn", "unknown")).toBeNull();
    expect(identifyCrew({ lang: "mn", voice: "unknown" })).toEqual({ crewId: null, reason: "ask", candidates: ["bat", "saraa"] });
    expect(identifyCrew({ lang: "en", voice: "unknown" })).toEqual({ crewId: null, reason: "ask", candidates: ["alex", "mira"] });
    expect(identifyCrew({ lang: "mn", voice: "unknown", previous: "saraa" })).toMatchObject({ crewId: "saraa", reason: "previous" });
    // the previous person speaks the other language: ask
    expect(identifyCrew({ lang: "en", voice: "unknown", previous: "saraa" })).toMatchObject({ crewId: null, reason: "ask" });
  });

  it("a name said outright wins over the voice", () => {
    const claim = detectIdentityClaim("Hi, I'm Mira", { strict: true });
    expect(identifyCrew({ lang: "en", voice: "male", claim })).toMatchObject({ crewId: "mira", reason: "claim" });
  });

  it("typed text: Cyrillic is Mongolian, Latin is English", () => {
    expect(languageOfText("Сайн байна уу")).toBe("mn");
    expect(languageOfText("Hello Cosmo")).toBe("en");
    expect(languageOfText("120 / 80", "mn")).toBe("mn");
  });

  it("shows the Cyrillic name on the Mongolian screen", () => {
    expect(displayName({ id: "saraa", name: "Saraa" }, "mn")).toBe("Сараа");
    expect(displayName({ id: "saraa", name: "Saraa" }, "en")).toBe("Saraa");
    expect(displayName({ id: "zed", name: "Zed" }, "mn")).toBe("Zed");
  });
});

describe("identity: corrections by voice", () => {
  it.each([
    ["би Бат", "bat"],
    ["Би Сараа байна", "saraa"],
    ["биш, Сараа", "saraa"],
    ["үгүй ээ, би Бат", "bat"],
    ["намайг Сараа гэдэг", "saraa"],
    ["I'm Mira", "mira"],
    ["no, I am Alex", "alex"],
    ["this is Alex speaking", "alex"],
    ["my name is Mira", "mira"],
    ["not Bat, I'm Saraa", "saraa"],
  ])("%s -> %s", (text, crewId) => {
    expect(detectIdentityClaim(text, { strict: true }).crewId).toBe(crewId);
  });

  it("a negation rules a person out and never claims them", () => {
    const c = detectIdentityClaim("би Бат биш", { strict: true });
    expect(c).toEqual({ crewId: null, notCrew: ["bat"] });
    // the only other Mongolian speaker is then the one
    expect(identifyCrew({ lang: "mn", voice: "unknown", claim: c })).toMatchObject({ crewId: "saraa", reason: "claim" });
    expect(detectIdentityClaim("I'm not Mira", { strict: true })).toEqual({ crewId: null, notCrew: ["mira"] });
    expect(detectIdentityClaim("би Бат биш, Сараа", { strict: true }).crewId).toBe("saraa");
  });

  it("strict mode needs a cue; the bare name counts only when Cosmo just asked", () => {
    expect(detectIdentityClaim("Сараа", { strict: true }).crewId).toBeNull();
    expect(detectIdentityClaim("Сараа", { strict: false }).crewId).toBe("saraa");
    expect(detectIdentityClaim("Mira.", { strict: false }).crewId).toBe("mira");
    // a name in a sentence is not a claim
    expect(detectIdentityClaim("tell Alex the results look fine", { strict: true }).crewId).toBeNull();
    expect(detectIdentityClaim("tell Alex the results look fine", { strict: false }).crewId).toBeNull();
    // "бат бөх" (sturdy) is not the name
    expect(detectIdentityClaim("би бат бөх байна", { strict: true }).crewId).toBeNull();
    expect(detectIdentityClaim("I slept 7 hours", { strict: true })).toEqual({ crewId: null, notCrew: [] });
  });
});

/* ───────────── the pitch estimator ───────────── */

const RATE = 48_000;

function tone(hz: number, seconds: number, harmonics: number[] = [1], noise = 0, seed = 7): Float32Array {
  const out = new Float32Array(Math.round(RATE * seconds));
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    harmonics.forEach((amp, k) => {
      v += amp * Math.sin((2 * Math.PI * hz * (k + 1) * i) / RATE);
    });
    out[i] = 0.3 * v + noise * rand();
  }
  return out;
}

/** a voice-like signal: a glottal-ish harmonic series with a slow vibrato, syllables separated by pauses, some noise */
function voiceLike(hz: number): Float32Array {
  const seconds = 1.6;
  const out = new Float32Array(Math.round(RATE * seconds));
  let phase = 0;
  let s = 3;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const f = hz * (1 + 0.02 * Math.sin(2 * Math.PI * 5 * t));
    phase += (2 * Math.PI * f) / RATE;
    const syllable = Math.sin(Math.PI * ((t % 0.4) / 0.4)) > 0.25 ? 1 : 0; // 0.4 s syllables with short gaps
    let v = 0;
    for (let k = 1; k <= 6; k++) v += Math.sin(k * phase) / k;
    s = (s * 1103515245 + 12345) % 2147483648;
    out[i] = syllable * 0.25 * v + 0.01 * (s / 2147483648 - 0.5);
  }
  return out;
}

describe("pitch: autocorrelation F0, median over voiced frames", () => {
  it.each([120, 210])("a %i Hz sine", (hz) => {
    const est = estimatePitch(tone(hz, 1), RATE);
    expect(est.medianHz).not.toBeNull();
    expect(Math.abs((est.medianHz as number) - hz)).toBeLessThan(hz * 0.03);
  });

  it.each([120, 210])("a voice-like %i Hz signal with harmonics, vibrato, pauses and noise", (hz) => {
    const est = estimatePitch(voiceLike(hz), RATE);
    expect(est.voicedFrames).toBeGreaterThan(20);
    expect(Math.abs((est.medianHz as number) - hz)).toBeLessThan(hz * 0.05);
  });

  it("does not jump an octave on a strong second harmonic", () => {
    const est = estimatePitch(tone(120, 1, [0.6, 1, 0.4]), RATE);
    expect(Math.abs((est.medianHz as number) - 120)).toBeLessThan(6);
  });

  it("silence and noise give no estimate", () => {
    expect(estimatePitch(new Float32Array(RATE), RATE)).toEqual({ medianHz: null, voicedFrames: 0 });
    expect(estimatePitch(tone(0, 1, [0], 0.4), RATE).medianHz).toBeNull();
    expect(estimatePitch(new Float32Array(0), RATE).medianHz).toBeNull();
    expect(estimateFrameF0(new Float32Array(640), 16_000)).toBeNull();
  });

  it("classifies with a wide unknown band, and only a confident change counts as a new speaker", () => {
    expect(classifyVoice(120)).toBe("male");
    expect(classifyVoice(LOW_VOICE_HZ)).toBe("male");
    expect(classifyVoice(155)).toBe("unknown");
    expect(classifyVoice(HIGH_VOICE_HZ)).toBe("female");
    expect(classifyVoice(210)).toBe("female");
    expect(classifyVoice(null)).toBe("unknown");
    expect(classifyVoice(estimatePitch(voiceLike(120), RATE).medianHz)).toBe("male");
    expect(classifyVoice(estimatePitch(voiceLike(210), RATE).medianHz)).toBe("female");
    expect(voiceClearlyChanged("female", "male")).toBe(true);
    expect(voiceClearlyChanged("female", "unknown")).toBe(false);
    expect(voiceClearlyChanged("unknown", "male")).toBe(false);
    expect(voiceClearlyChanged(null, "male")).toBe(false);
    expect(voiceClearlyChanged("male", "male")).toBe(false);
  });
});
