import { describe, expect, it } from "vitest";
import { ensureAudioGraph, getAudioGraph, type AudioContextCtor } from "@/components/cosmo/audio-graph";
import {
  MOUTH_DEADZONE,
  SIM_MAX,
  SIM_MIN,
  clampAmplitude,
  mouthOpenFromAmplitude,
  rmsToAmplitude,
  simulatedSpeechEnvelope,
  smoothAmplitude,
} from "@/components/cosmo/amplitude";
import {
  BLINK_DURATION_MS,
  BLINK_MAX_MS,
  BLINK_MIN_MS,
  blinkClosure,
  nextBlinkDelay,
} from "@/components/cosmo/blink";
import { emotionLook, mouthPath, describeCosmo } from "@/components/cosmo/face";
import {
  applyRiveValues,
  riveValues,
  type RiveInputLike,
} from "@/components/cosmo/rive-inputs";
import { COSMO_EMOTIONS, COSMO_STATES } from "@/components/cosmo/types";
import { VARIANTS, VARIANT_COUNT, variantFor } from "@/components/cosmo/variants";

describe("clampAmplitude", () => {
  it("keeps values inside 0..1 and clamps the rest", () => {
    expect(clampAmplitude(0.42)).toBe(0.42);
    expect(clampAmplitude(0)).toBe(0);
    expect(clampAmplitude(1)).toBe(1);
    expect(clampAmplitude(-0.3)).toBe(0);
    expect(clampAmplitude(7)).toBe(1);
    expect(clampAmplitude(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampAmplitude(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("treats NaN as silence", () => {
    expect(clampAmplitude(Number.NaN)).toBe(0);
  });
});

describe("rmsToAmplitude", () => {
  it("is 0 for silence in both buffer layouts and for an empty buffer", () => {
    expect(rmsToAmplitude(new Uint8Array(256).fill(128))).toBe(0);
    expect(rmsToAmplitude(new Float32Array(256))).toBe(0);
    expect(rmsToAmplitude(new Uint8Array(0))).toBe(0);
  });

  it("is 1 for a full-scale square wave", () => {
    const bytes = new Uint8Array(256).map((_, i) => (i % 2 === 0 ? 0 : 255));
    // byte 255 is 127/128 of full scale, byte 0 is exactly -1
    expect(rmsToAmplitude(bytes)).toBeGreaterThan(0.99);
    const floats = new Float32Array(256).map((_, i) => (i % 2 === 0 ? -1 : 1));
    expect(rmsToAmplitude(floats)).toBeCloseTo(1, 6);
  });

  it("returns the plain RMS for a mid-level signal", () => {
    // +-0.5 square wave has RMS 0.5
    const floats = new Float32Array(128).map((_, i) => (i % 2 === 0 ? -0.5 : 0.5));
    expect(rmsToAmplitude(floats)).toBeCloseTo(0.5, 6);
    // bytes 64 / 192 are -0.5 / +0.5
    const bytes = new Uint8Array(128).map((_, i) => (i % 2 === 0 ? 64 : 192));
    expect(rmsToAmplitude(bytes)).toBeCloseTo(0.5, 6);
  });

  it("is amplitude-monotone and sine RMS is peak / sqrt(2)", () => {
    const sine = (peak: number) =>
      new Float32Array(1024).map((_, i) => peak * Math.sin((2 * Math.PI * 8 * i) / 1024));
    const quiet = rmsToAmplitude(sine(0.1));
    const loud = rmsToAmplitude(sine(0.6));
    expect(quiet).toBeLessThan(loud);
    expect(loud).toBeCloseTo(0.6 / Math.SQRT2, 3);
  });

  it("applies gain and never exceeds 1", () => {
    const floats = new Float32Array(64).map((_, i) => (i % 2 === 0 ? -0.2 : 0.2));
    expect(rmsToAmplitude(floats, 3)).toBeCloseTo(0.6, 6);
    expect(rmsToAmplitude(floats, 100)).toBe(1);
  });
});

describe("mouthOpenFromAmplitude", () => {
  it("keeps the mouth shut inside the deadzone and opens linearly beyond it", () => {
    expect(mouthOpenFromAmplitude(0)).toBe(0);
    expect(mouthOpenFromAmplitude(MOUTH_DEADZONE)).toBe(0);
    expect(mouthOpenFromAmplitude(MOUTH_DEADZONE / 2)).toBe(0);
    expect(mouthOpenFromAmplitude(1)).toBe(1);
    const mid = mouthOpenFromAmplitude(0.5);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.5);
  });

  it("is clamped for out-of-range and NaN input", () => {
    expect(mouthOpenFromAmplitude(5)).toBe(1);
    expect(mouthOpenFromAmplitude(-5)).toBe(0);
    expect(mouthOpenFromAmplitude(Number.NaN)).toBe(0);
  });
});

describe("smoothAmplitude", () => {
  it("moves toward the target without overshooting", () => {
    let value = 0;
    for (let i = 0; i < 200; i++) {
      value = smoothAmplitude(value, 0.8, 16);
      expect(value).toBeLessThanOrEqual(0.8);
    }
    expect(value).toBeCloseTo(0.8, 3);
    for (let i = 0; i < 200; i++) {
      value = smoothAmplitude(value, 0, 16);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(value).toBeLessThan(0.001);
  });

  it("opens faster than it closes and ignores a zero step", () => {
    const opened = smoothAmplitude(0, 1, 30);
    const closed = 1 - smoothAmplitude(1, 0, 30);
    expect(opened).toBeGreaterThan(closed);
    expect(smoothAmplitude(0.3, 1, 0)).toBe(0.3);
  });
});

describe("simulatedSpeechEnvelope", () => {
  it("stays within the speech-like band for any time and noise", () => {
    let min = 1;
    let max = 0;
    for (let t = 0; t < 30; t += 0.013) {
      for (const noise of [0, 0.25, 0.5, 0.75, 1]) {
        const v = simulatedSpeechEnvelope(t, noise);
        min = Math.min(min, v);
        max = Math.max(max, v);
        expect(v).toBeGreaterThanOrEqual(SIM_MIN);
        expect(v).toBeLessThanOrEqual(SIM_MAX);
      }
    }
    // it genuinely moves: both quiet and loud moments occur
    expect(min).toBeLessThan(0.3);
    expect(max).toBeGreaterThan(0.75);
  });

  it("survives bad input", () => {
    expect(simulatedSpeechEnvelope(Number.NaN, Number.NaN)).toBeGreaterThanOrEqual(SIM_MIN);
    expect(simulatedSpeechEnvelope(Number.POSITIVE_INFINITY, 2)).toBeLessThanOrEqual(SIM_MAX);
  });
});

describe("variantFor", () => {
  it("maps 0..3 to four distinct accents and face details", () => {
    expect(VARIANT_COUNT).toBe(4);
    expect(new Set(VARIANTS.map((v) => v.accent)).size).toBe(4);
    expect(new Set(VARIANTS.map((v) => v.detail)).size).toBe(4);
    for (let i = 0; i < 4; i++) expect(variantFor(i).index).toBe(i);
    // ImageCosmo: four distinct neon hues, variant 0 keeps the render's own colours
    expect(new Set(VARIANTS.map((v) => v.hueDeg)).size).toBe(4);
    expect(VARIANTS[0].hueDeg).toBe(0);
    for (const v of VARIANTS) expect(Math.abs(v.hueDeg)).toBeLessThan(180);
  });

  it("wraps past the end", () => {
    expect(variantFor(4).index).toBe(0);
    expect(variantFor(5).index).toBe(1);
    expect(variantFor(103).index).toBe(3);
  });

  it("handles negatives", () => {
    expect(variantFor(-1).index).toBe(3);
    expect(variantFor(-4).index).toBe(0);
    expect(variantFor(-5).index).toBe(3);
    expect(variantFor(-1_000_001).index).toBe(3);
  });

  it("is safe for non-integers and non-finite input", () => {
    expect(variantFor(1.9).index).toBe(1);
    expect(variantFor(-0.5).index).toBe(3);
    expect(variantFor(Number.NaN).index).toBe(0);
    expect(variantFor(Number.POSITIVE_INFINITY).index).toBe(0);
    expect(variantFor(Number.MAX_SAFE_INTEGER).index).toBeGreaterThanOrEqual(0);
  });
});

describe("blink timing", () => {
  it("nextBlinkDelay is 2.5 to 6 s at the extremes", () => {
    expect(nextBlinkDelay(() => 0)).toBe(BLINK_MIN_MS);
    expect(nextBlinkDelay(() => 1)).toBe(BLINK_MAX_MS);
    expect(nextBlinkDelay(() => 0.5)).toBe((BLINK_MIN_MS + BLINK_MAX_MS) / 2);
    expect(BLINK_MIN_MS).toBe(2500);
    expect(BLINK_MAX_MS).toBe(6000);
    expect(BLINK_DURATION_MS).toBe(140);
  });

  it("stays within bounds for 10 000 random draws and for a broken random source", () => {
    for (let i = 0; i < 10_000; i++) {
      const d = nextBlinkDelay();
      expect(d).toBeGreaterThanOrEqual(BLINK_MIN_MS);
      expect(d).toBeLessThanOrEqual(BLINK_MAX_MS);
    }
    for (const bad of [Number.NaN, -3, 9, Number.POSITIVE_INFINITY]) {
      const d = nextBlinkDelay(() => bad);
      expect(d).toBeGreaterThanOrEqual(BLINK_MIN_MS);
      expect(d).toBeLessThanOrEqual(BLINK_MAX_MS);
    }
  });

  it("is not a constant interval", () => {
    const delays = new Set(Array.from({ length: 50 }, () => nextBlinkDelay()));
    expect(delays.size).toBeGreaterThan(10);
  });

  it("blinkClosure closes and reopens within 140 ms", () => {
    expect(blinkClosure(0)).toBe(0);
    expect(blinkClosure(BLINK_DURATION_MS / 2)).toBeCloseTo(1, 6);
    expect(blinkClosure(BLINK_DURATION_MS)).toBe(0);
    expect(blinkClosure(-10)).toBe(0);
    expect(blinkClosure(5000)).toBe(0);
    expect(blinkClosure(Number.NaN)).toBe(0);
    expect(blinkClosure(35)).toBeCloseTo(blinkClosure(105), 6);
  });
});

describe("emotion look and mouth geometry", () => {
  it("every emotion has a look; happy smiles wider, concerned raises inner brows and is flatter", () => {
    const neutral = emotionLook("neutral");
    const happy = emotionLook("happy");
    const concerned = emotionLook("concerned");
    expect(happy.eye).toBe("arc");
    expect(happy.smile).toBeGreaterThan(neutral.smile);
    expect(happy.mouthWidth).toBeGreaterThan(neutral.mouthWidth);
    expect(concerned.browInnerRaiseDeg).toBeGreaterThan(0);
    expect(neutral.browInnerRaiseDeg).toBe(0);
    expect(concerned.smile).toBeLessThan(neutral.smile);
    expect(concerned.cheekTone).toBe("cool");
    for (const emotion of COSMO_EMOTIONS) expect(emotionLook(emotion)).toBeDefined();
  });

  it("mouthPath is a valid, finite path that grows with openness", () => {
    for (const emotion of COSMO_EMOTIONS) {
      const look = emotionLook(emotion);
      for (const open of [0, 0.3, 1, 5, -2, Number.NaN]) {
        const d = mouthPath(look, open);
        expect(d).toMatch(/^M[\d. -]+Q[\d. -]+Q[\d. -]+Z$/);
        expect(d).not.toContain("NaN");
      }
      expect(mouthPath(look, 0)).not.toBe(mouthPath(look, 1));
      expect(mouthPath(look, 5)).toBe(mouthPath(look, 1));
    }
  });

  it("describes state and emotion for the accessible name", () => {
    for (const state of COSMO_STATES) {
      for (const emotion of COSMO_EMOTIONS) {
        const text = describeCosmo(state, emotion);
        expect(text.startsWith("Cosmo")).toBe(true);
      }
    }
    expect(describeCosmo("listening", "concerned")).toBe("Cosmo, listening, looking concerned");
  });
});

/** Minimal Web Audio fake: counts constructed and closed contexts; sources can be made to fail. */
function fakeWebAudio(opts: { failSource?: boolean; closeThrows?: boolean; closeRejects?: boolean } = {}) {
  const stats = { created: 0, closed: 0, sources: 0 };
  class FakeContext {
    destination = {};
    constructor() {
      stats.created++;
    }
    createMediaElementSource() {
      if (opts.failSource) throw new Error("InvalidStateError: element already connected");
      stats.sources++;
      return { connect() {} };
    }
    createAnalyser() {
      return { fftSize: 0, smoothingTimeConstant: 0, connect() {} };
    }
    close() {
      stats.closed++;
      if (opts.closeThrows) throw new Error("close failed");
      return opts.closeRejects ? Promise.reject(new Error("close rejected")) : Promise.resolve();
    }
  }
  return { stats, Ctor: FakeContext as unknown as AudioContextCtor };
}

const fakeElement = () => ({}) as HTMLMediaElement;

describe("audio graph cache", () => {
  it("builds once per element and reuses the graph", () => {
    const { stats, Ctor } = fakeWebAudio();
    const el = fakeElement();
    const first = ensureAudioGraph(el, Ctor);
    expect(first).not.toBeNull();
    expect(first?.analyser.fftSize).toBe(256);
    expect(first?.analyser.smoothingTimeConstant).toBe(0.6);
    for (let i = 0; i < 5; i++) expect(ensureAudioGraph(el, Ctor)).toBe(first);
    expect(getAudioGraph(el)).toBe(first);
    expect(stats.created).toBe(1);
    expect(stats.closed).toBe(0);
  });

  it("a failed build closes its context and is cached: repeated play events never leak contexts", () => {
    const { stats, Ctor } = fakeWebAudio({ failSource: true });
    const el = fakeElement();
    // 'play' and 'playing' both call ensureAudioGraph, on every utterance
    for (let i = 0; i < 20; i++) expect(ensureAudioGraph(el, Ctor)).toBeNull();
    expect(stats.created).toBe(1);
    expect(stats.closed).toBe(1);
    expect(getAudioGraph(el)).toBeNull();
  });

  it("caches failure per element, other elements are unaffected", () => {
    const failing = fakeWebAudio({ failSource: true });
    const a = fakeElement();
    ensureAudioGraph(a, failing.Ctor);
    const working = fakeWebAudio();
    const b = fakeElement();
    expect(ensureAudioGraph(b, working.Ctor)).not.toBeNull();
    // a working constructor later does not retry the element that already failed
    expect(ensureAudioGraph(a, working.Ctor)).toBeNull();
    expect(working.stats.created).toBe(1);
  });

  it("survives a context whose close() throws or rejects", async () => {
    for (const opts of [{ closeThrows: true }, { closeRejects: true }]) {
      const { stats, Ctor } = fakeWebAudio({ failSource: true, ...opts });
      const el = fakeElement();
      expect(() => ensureAudioGraph(el, Ctor)).not.toThrow();
      expect(ensureAudioGraph(el, Ctor)).toBeNull();
      await Promise.resolve();
      expect(stats.created).toBe(1);
      expect(stats.closed).toBe(1);
    }
  });

  it("does not cache the absence of Web Audio and never constructs anything without it", () => {
    const el = fakeElement();
    expect(ensureAudioGraph(el, null)).toBeNull();
    const { stats, Ctor } = fakeWebAudio();
    expect(ensureAudioGraph(el, Ctor)).not.toBeNull();
    expect(stats.created).toBe(1);
  });
});

describe("Rive input mapping", () => {
  it("maps props to the Cosmo state machine inputs", () => {
    expect(riveValues({ state: "talking", emotion: "happy", amplitude: 0.5, variant: 2 })).toEqual({
      isTalking: true,
      isListening: false,
      isThinking: false,
      emotion: 1,
      mouthOpen: 50,
      variant: 2,
    });
    const v = riveValues({ state: "thinking", emotion: "concerned", amplitude: 9, variant: -1 });
    expect(v.isThinking).toBe(true);
    expect(v.emotion).toBe(2);
    expect(v.mouthOpen).toBe(100);
    expect(v.variant).toBe(3);
    expect(riveValues({ state: "idle", emotion: "neutral", amplitude: 0, variant: 0 }).emotion).toBe(0);
  });

  it("writes matching inputs, skips missing ones and mismatched types, never throws", () => {
    const inputs: RiveInputLike[] = [
      { name: "isTalking", value: false },
      { name: "mouthOpen", value: 0 },
      { name: "emotion", value: false }, // wrong type in the designer file: skipped
    ];
    const written = applyRiveValues(
      inputs,
      riveValues({ state: "talking", emotion: "happy", amplitude: 0.25, variant: 1 }),
    );
    expect(written.sort()).toEqual(["isTalking", "mouthOpen"]);
    expect(inputs[0].value).toBe(true);
    expect(inputs[1].value).toBe(25);
    expect(inputs[2].value).toBe(false);

    expect(applyRiveValues(null, riveValues({ state: "idle", emotion: "neutral", amplitude: 0, variant: 0 }))).toEqual([]);
    expect(applyRiveValues([], riveValues({ state: "idle", emotion: "neutral", amplitude: 0, variant: 0 }))).toEqual([]);

    const throwing: RiveInputLike = {
      name: "isTalking",
      get value(): boolean {
        throw new Error("boom");
      },
      set value(_v: boolean | number) {
        throw new Error("boom");
      },
    };
    expect(() =>
      applyRiveValues([throwing], riveValues({ state: "talking", emotion: "neutral", amplitude: 0, variant: 0 })),
    ).not.toThrow();
  });
});
