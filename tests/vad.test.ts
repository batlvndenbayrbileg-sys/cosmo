import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAD_CONFIG,
  createVadState,
  effectiveThreshold,
  rmsFromSamples,
  stepVad,
  type VadConfig,
  type VadSignal,
  type VadState,
} from "@/components/checkin/vad";

const FRAME_MS = 50;
const LOUD = 0.2;
const QUIET = 0.002;

/** Feed `ms` worth of identical frames; returns the final state and every non-"none" signal. */
function run(
  start: VadState,
  rms: number,
  ms: number,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): { state: VadState; signals: VadSignal[] } {
  let state = start;
  const signals: VadSignal[] = [];
  for (let t = 0; t < ms; t += FRAME_MS) {
    const step = stepVad(state, { rms, dtMs: FRAME_MS }, config);
    state = step.state;
    if (step.signal !== "none") signals.push(step.signal);
  }
  return { state, signals };
}

describe("rmsFromSamples", () => {
  it("is 0 for silence (bytes centred on 128) and for an empty buffer", () => {
    expect(rmsFromSamples(new Uint8Array(256).fill(128))).toBe(0);
    expect(rmsFromSamples(new Uint8Array(0))).toBe(0);
  });

  it("measures a full-scale square wave as 1 and a half-scale one as 0.5", () => {
    const full = new Uint8Array(100).map((_, i) => (i % 2 === 0 ? 255 : 1));
    expect(rmsFromSamples(full)).toBeGreaterThan(0.99);
    const half = new Float32Array(100).map((_, i) => (i % 2 === 0 ? 0.5 : -0.5));
    expect(rmsFromSamples(half)).toBeCloseTo(0.5, 6);
  });
});

describe("stepVad: utterance boundaries", () => {
  it("starts in waiting and ignores quiet frames", () => {
    const { state, signals } = run(createVadState(), QUIET, 1000);
    expect(state.phase).toBe("waiting");
    expect(signals).toEqual([]);
  });

  it("signals speech_start on the first loud frame", () => {
    const step = stepVad(createVadState(), { rms: LOUD, dtMs: FRAME_MS });
    expect(step.signal).toBe("speech_start");
    expect(step.state.phase).toBe("speaking");
  });

  it("ends the utterance after 900 ms below the threshold, not before", () => {
    const speaking = run(createVadState(), LOUD, 1000).state;
    const almost = run(speaking, QUIET, 850);
    expect(almost.signals).toEqual([]);
    expect(almost.state.phase).toBe("speaking");
    const done = run(almost.state, QUIET, 50);
    expect(done.signals).toEqual(["utterance_end"]);
    expect(done.state.phase).toBe("ended");
  });

  it("a short pause inside a sentence does not end it, the silence counter restarts", () => {
    let state = run(createVadState(), LOUD, 500).state;
    state = run(state, QUIET, 600).state; // pause shorter than 900 ms
    expect(state.phase).toBe("speaking");
    const resumed = run(state, LOUD, 200);
    expect(resumed.state.silenceMs).toBe(0);
    const end = run(resumed.state, QUIET, 900);
    expect(end.signals).toEqual(["utterance_end"]);
  });

  it("discards an utterance with less than 300 ms of speech and goes back to waiting", () => {
    const blip = run(createVadState(), LOUD, 200).state; // 200 ms of speech
    const after = run(blip, QUIET, 900);
    expect(after.signals).toEqual(["too_short"]);
    expect(after.state.phase).toBe("waiting");
    expect(after.state.speechMs).toBe(0);
  });

  it("keeps an utterance with exactly the minimum of speech", () => {
    const start = run(createVadState(), LOUD, 300).state;
    expect(start.speechMs).toBe(300);
    expect(run(start, QUIET, 900).signals).toEqual(["utterance_end"]);
  });

  it("can capture a real utterance after a discarded blip", () => {
    let state = run(createVadState(), LOUD, 100).state;
    state = run(state, QUIET, 900).state; // too_short
    const second = run(state, LOUD, 1500);
    expect(second.signals).toEqual(["speech_start"]);
    expect(second.state.phase).toBe("speaking");
    expect(run(second.state, QUIET, 900).signals).toEqual(["utterance_end"]);
  });

  it("cuts an utterance at 30 s even when the person never stops talking", () => {
    const { state, signals } = run(createVadState(), LOUD, 31_000);
    expect(signals).toEqual(["speech_start", "max_length"]);
    expect(state.phase).toBe("ended");
    expect(state.utteranceMs).toBeGreaterThanOrEqual(30_000);
    expect(state.utteranceMs).toBeLessThan(30_000 + FRAME_MS);
  });

  it("gives up with no_speech when nothing is said for the timeout", () => {
    const { state, signals } = run(createVadState(), QUIET, 21_000);
    expect(signals).toEqual(["no_speech"]);
    expect(state.phase).toBe("ended");
  });

  it("counts a discarded blip towards the no-speech timeout", () => {
    const config = { ...DEFAULT_VAD_CONFIG, noSpeechTimeoutMs: 3000 };
    let state = run(createVadState(), QUIET, 1500, config).state;
    state = run(state, LOUD, 100, config).state;
    const after = run(state, QUIET, 3000, config);
    expect(after.signals).toEqual(["too_short", "no_speech"]);
  });

  it("does nothing once ended", () => {
    const ended = run(createVadState(), LOUD, 31_000).state;
    const step = stepVad(ended, { rms: LOUD, dtMs: FRAME_MS });
    expect(step.signal).toBe("none");
    expect(step.state).toBe(ended);
  });

  it("ignores negative time and negative levels", () => {
    const step = stepVad(createVadState(), { rms: -1, dtMs: -50 });
    expect(step.signal).toBe("none");
    expect(step.state.waitedMs).toBe(0);
  });
});

/** State after the calibration window, with a given room floor (what listening looks like after 300 ms). */
function calibrated(noiseFloor: number): VadState {
  return { ...createVadState(), noiseFloor, calibratedMs: DEFAULT_VAD_CONFIG.calibrationMs };
}

/** Every signal produced by `frames` (rms per 50 ms frame), with its time stamp. */
function trace(frames: (t: number) => number, totalMs: number, config: VadConfig = DEFAULT_VAD_CONFIG) {
  let state = createVadState();
  const out: { signal: VadSignal; at: number }[] = [];
  for (let t = 0; t < totalMs; t += FRAME_MS) {
    const step = stepVad(state, { rms: frames(t), dtMs: FRAME_MS }, config);
    state = step.state;
    if (step.signal !== "none") out.push({ signal: step.signal, at: t + FRAME_MS });
  }
  return { state, out };
}

describe("stepVad: adaptive threshold", () => {
  it("raises the threshold in a noisy room so steady noise is not speech", () => {
    const room = calibrated(0.05);
    expect(effectiveThreshold(room)).toBeCloseTo(0.15, 6);
    const quietRoom = run(room, 0.06, 2000);
    expect(quietRoom.signals).toEqual([]);
    expect(quietRoom.state.phase).toBe("waiting");
    const speech = run(room, 0.3, 100);
    expect(speech.signals).toEqual(["speech_start"]);
  });

  it("never drops below the base threshold", () => {
    expect(effectiveThreshold(createVadState())).toBe(DEFAULT_VAD_CONFIG.threshold);
  });

  it("learns the noise floor from quiet frames only", () => {
    const quiet = run(createVadState(), 0.01, 1000).state;
    expect(quiet.noiseFloor).toBeCloseTo(0.01, 4);
    const speaking = run(quiet, LOUD, 500).state;
    expect(speaking.noiseFloor).toBeCloseTo(quiet.noiseFloor, 10); // speech does not raise it
  });

  it("keeps refining the floor with the quiet frames of a pause inside an utterance", () => {
    const speaking = run(calibrated(0.005), LOUD, 500).state;
    const pause = run(speaking, 0.015, 300).state; // a noisier pause, still under the threshold
    expect(pause.phase).toBe("speaking");
    expect(pause.noiseFloor).toBeGreaterThan(0.005);
  });
});

describe("stepVad: calibration (steady room noise above the base threshold)", () => {
  const NOISE = 0.03; // above the 0.02 base threshold, below the 0.08 speech override

  it("does not start speech during the calibration window", () => {
    const { out } = trace(() => NOISE, DEFAULT_VAD_CONFIG.calibrationMs);
    expect(out).toEqual([]);
  });

  it("treats constant noise as the room, never as speech (was: speech_start then max_length at 30 s)", () => {
    const { out, state } = trace(() => NOISE, 15_000);
    expect(out).toEqual([]); // no speech_start; the no-speech timeout (20 s) has not elapsed yet
    expect(state.noiseFloor).toBeCloseTo(NOISE, 3);
  });

  it("the same holds when the noise starts after a short quiet moment", () => {
    const { out } = trace((t) => (t < 200 ? 0.005 : NOISE), 15_000);
    expect(out).toEqual([]);
  });

  it("ends a speech utterance by silence, not by the 30 s cap, in a noisy room", () => {
    // 0.5 s of room noise, 1.5 s of speech, then the noise alone for 5 s
    const { out } = trace((t) => (t >= 500 && t < 2000 ? 0.25 : NOISE), 8000);
    expect(out.map((o) => o.signal)).toEqual(["speech_start", "utterance_end"]);
    const end = out[1].at;
    expect(end).toBeGreaterThanOrEqual(2000 + DEFAULT_VAD_CONFIG.silenceMs);
    expect(end).toBeLessThan(2000 + DEFAULT_VAD_CONFIG.silenceMs + 4 * FRAME_MS);
    expect(end).toBeLessThan(DEFAULT_VAD_CONFIG.maxUtteranceMs);
  });

  it("gives up with no_speech after the timeout when the room is only noise", () => {
    const { out } = trace(() => NOISE, 21_000);
    expect(out.map((o) => o.signal)).toEqual(["no_speech"]);
  });

  it("still catches someone who starts talking the moment the mic opens", () => {
    const first = stepVad(createVadState(), { rms: 0.25, dtMs: FRAME_MS });
    expect(first.signal).toBe("speech_start");
    const { out } = trace((t) => (t < 1500 ? 0.25 : 0.003), 4000);
    expect(out.map((o) => o.signal)).toEqual(["speech_start", "utterance_end"]);
  });

  it("an over-estimated floor (speech right at the start, below the override level) recovers on the first pause", () => {
    const poisoned = trace((t) => (t < DEFAULT_VAD_CONFIG.calibrationMs ? 0.06 : 0.004), 1500).state;
    expect(poisoned.noiseFloor).toBeLessThan(0.02);
    expect(effectiveThreshold(poisoned)).toBeLessThan(0.06);
  });

  it("calibrationMs 0 turns calibration off (the first loud frame starts speech)", () => {
    const config = { ...DEFAULT_VAD_CONFIG, calibrationMs: 0 };
    const step = stepVad(createVadState(), { rms: 0.05, dtMs: FRAME_MS }, config);
    expect(step.signal).toBe("speech_start");
  });

  it("does not calibrate again after a discarded blip", () => {
    let state = run(createVadState(), 0.004, 400).state; // calibrated, quiet room
    state = run(state, LOUD, 100).state;
    const after = run(state, 0.004, 900);
    expect(after.signals).toEqual(["too_short"]);
    expect(after.state.calibratedMs).toBeGreaterThanOrEqual(DEFAULT_VAD_CONFIG.calibrationMs);
    expect(stepVad(after.state, { rms: LOUD, dtMs: FRAME_MS }).signal).toBe("speech_start");
  });
});

describe("DEFAULT_VAD_CONFIG", () => {
  it("matches the brief: 900 ms silence, 300 ms minimum speech, 30 s maximum", () => {
    expect(DEFAULT_VAD_CONFIG.silenceMs).toBe(900);
    expect(DEFAULT_VAD_CONFIG.minSpeechMs).toBe(300);
    expect(DEFAULT_VAD_CONFIG.maxUtteranceMs).toBe(30_000);
  });
});
