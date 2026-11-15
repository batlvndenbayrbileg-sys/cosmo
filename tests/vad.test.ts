import { describe, expect, it } from "vitest";
import {
  BARGE_IN_VAD,
  DEFAULT_VAD_CONFIG,
  createVadState,
  effectiveThreshold,
  endSilenceMs,
  handOverVadState,
  rmsFromSamples,
  stepVad,
  voicingFromSpectrum,
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

  it("ends the utterance after 1.5 s below the threshold, not before (0.9 s cut people off mid-sentence)", () => {
    const speaking = run(createVadState(), LOUD, 1000).state;
    const almost = run(speaking, QUIET, 1450);
    expect(almost.signals).toEqual([]);
    expect(almost.state.phase).toBe("speaking");
    const done = run(almost.state, QUIET, 50);
    expect(done.signals).toEqual(["utterance_end"]);
    expect(done.state.phase).toBe("ended");
  });

  it("a short pause inside a sentence does not end it, the silence counter restarts", () => {
    let state = run(createVadState(), LOUD, 500).state;
    state = run(state, QUIET, 1200).state; // a thinking pause, shorter than 1.5 s
    expect(state.phase).toBe("speaking");
    const resumed = run(state, LOUD, 200);
    expect(resumed.state.silenceMs).toBe(0);
    const end = run(resumed.state, QUIET, 1500);
    expect(end.signals).toEqual(["utterance_end"]);
  });

  it("discards an utterance with less than 200 ms of speech and goes back to waiting", () => {
    // was 400 ms; that also dropped one-word answers ("yes", "тийм": 250-350 ms of voice), see the answer tests below
    const blip = run(createVadState(), LOUD, 150).state; // 150 ms of speech
    const after = run(blip, QUIET, 1500);
    expect(after.signals).toEqual(["too_short"]);
    expect(after.state.phase).toBe("waiting");
    expect(after.state.speechMs).toBe(0);
  });

  it("keeps an utterance with exactly the minimum of speech", () => {
    const start = run(createVadState(), LOUD, 400).state;
    expect(start.speechMs).toBe(400);
    expect(run(start, QUIET, 1500).signals).toEqual(["utterance_end"]);
  });

  it("can capture a real utterance after a discarded blip", () => {
    let state = run(createVadState(), LOUD, 100).state;
    state = run(state, QUIET, 1500).state; // too_short
    const second = run(state, LOUD, 1500);
    expect(second.signals).toEqual(["speech_start"]);
    expect(second.state.phase).toBe("speaking");
    expect(run(second.state, QUIET, 1500).signals).toEqual(["utterance_end"]);
  });

  it("cuts an utterance at 30 s even when the person never stops talking", () => {
    const { state, signals } = run(createVadState(), LOUD, 31_000);
    expect(signals).toEqual(["speech_start", "max_length"]);
    expect(state.phase).toBe("ended");
    expect(state.utteranceMs).toBeGreaterThanOrEqual(30_000);
    expect(state.utteranceMs).toBeLessThan(30_000 + FRAME_MS);
  });

  it("gives up with no_speech when nothing is said for the timeout", () => {
    const { state, signals } = run(createVadState(), QUIET, 31_000);
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
    const { out } = trace(() => NOISE, 31_000);
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
    const after = run(state, 0.004, 1500);
    expect(after.signals).toEqual(["too_short"]);
    expect(after.state.calibratedMs).toBeGreaterThanOrEqual(DEFAULT_VAD_CONFIG.calibrationMs);
    expect(stepVad(after.state, { rms: LOUD, dtMs: FRAME_MS }).signal).toBe("speech_start");
  });
});

/** frames with a known voicing flag (what the browser sends once the spectrum is analysed) */
function runV(start: VadState, rms: number, voiced: boolean, ms: number) {
  let state = start;
  const signals: VadSignal[] = [];
  for (let t = 0; t < ms; t += FRAME_MS) {
    const step = stepVad(state, { rms, dtMs: FRAME_MS, voiced });
    state = step.state;
    if (step.signal !== "none") signals.push(step.signal);
  }
  return { state, signals };
}

describe("stepVad: background noise is not speech (voicing)", () => {
  const room = () => calibrated(0.005);

  it("loud noise that does not sound like a voice never starts an utterance, however long it lasts", () => {
    const { signals, state } = runV(room(), 0.3, false, 20_000);
    expect(signals).toEqual([]);
    expect(state.phase).toBe("waiting");
  });

  it("a single voice-like frame of noise does not start speech: it takes 150 ms of continuous voice", () => {
    let s = room();
    for (let i = 0; i < 40; i++) {
      // voiced every other frame: never 150 ms in a row
      s = stepVad(s, { rms: 0.3, dtMs: FRAME_MS, voiced: i % 2 === 0 }).state;
    }
    expect(s.phase).toBe("waiting");
    const start = runV(s, 0.3, true, 150);
    expect(start.signals).toEqual(["speech_start"]);
  });

  it("speech followed by steady noise ends after 2.5 s without voice, instead of running to the 30 s cap", () => {
    let s = runV(room(), 0.3, true, 1500).state;
    const after = runV(s, 0.3, false, 3000);
    expect(after.signals).toEqual(["utterance_end"]);
    s = after.state;
    expect(s.utteranceMs).toBeLessThan(5000);
  });

  it("an utterance that was mostly noise with a little voice in it is dropped, not sent", () => {
    // Was: 450 ms of voice FOLLOWED by 2 s of noise. That is a short answer and a fan, and dropping it left the person
    // waiting for a reply (the noise after the last word no longer counts against the voiced share). Here the
    // voice-like moments are scattered through the noise: voiced share < 35 % up to the last of them.
    let s = runV(room(), 0.3, true, 200).state;
    for (let i = 0; i < 5; i++) {
      s = runV(s, 0.3, false, 350).state;
      s = runV(s, 0.3, true, 50).state;
    }
    const end = runV(s, 0.001, false, 1500);
    expect(end.signals).toEqual(["too_short"]);
    expect(end.state.phase).toBe("waiting");
  });

  it("a real answer followed by a fan is sent, not dropped (the noise after the last word is the room)", () => {
    const s = runV(room(), 0.3, true, 1500).state;
    const after = runV(s, 0.3, false, 3000);
    expect(after.signals).toEqual(["utterance_end"]);
  });

  it("soft speech in a noisy room still gets through: a voice only has to clear the room by 1.4x", () => {
    const noisy = calibrated(0.05); // a fan
    expect(runV(noisy, 0.08, false, 1000).signals).toEqual([]); // the same level as noise: ignored
    expect(runV(noisy, 0.08, true, 200).signals).toEqual(["speech_start"]);
  });

  it("soft voiced sound does not count as room noise (the threshold must not climb over the speaker)", () => {
    const s = runV(calibrated(0.01), 0.012, true, 3000).state; // voiced but below the threshold
    expect(s.noiseFloor).toBeCloseTo(0.01, 6);
  });
});

describe("stepVad: barge-in listening while Cosmo speaks (BARGE_IN_VAD)", () => {
  const config = { ...DEFAULT_VAD_CONFIG, ...BARGE_IN_VAD };
  function runB(start: VadState, rms: number, voiced: boolean, ms: number) {
    let state = start;
    const signals: VadSignal[] = [];
    for (let t = 0; t < ms; t += FRAME_MS) {
      const step = stepVad(state, { rms, dtMs: FRAME_MS, voiced }, config);
      state = step.state;
      if (step.signal !== "none") signals.push(step.signal);
    }
    return { state, signals };
  }

  it("Cosmo's own voice leaking back (steady, voiced) is learned as the room and never interrupts her", () => {
    const { signals, state } = runB(createVadState(), 0.05, true, 15_000);
    expect(signals).toEqual([]);
    expect(state.noiseFloor).toBeGreaterThan(0.03);
  });

  it("a person clearly louder than the echo interrupts after 250 ms", () => {
    const echo = runB(createVadState(), 0.05, true, 3000).state;
    expect(runB(echo, 0.08, true, 1000).signals).toEqual([]); // not clearly louder: ignored
    const loud = runB(echo, 0.3, true, 250);
    expect(loud.signals).toEqual(["speech_start"]);
  });

  it("Cosmo's first loud syllable is not taken for the person (no calibration override)", () => {
    expect(runB(createVadState(), 0.5, true, 100).signals).toEqual([]);
  });
});

describe("voicingFromSpectrum", () => {
  const SR = 48_000;
  const N = 2048;
  /** a spectrum in dB with energy only at the given frequencies (everything else at -140 dB) */
  function tones(freqs: number[], level = -20): Float32Array {
    const db = new Float32Array(N / 2).fill(-140);
    for (const f of freqs) db[Math.round((f * N) / SR)] = level;
    return db;
  }

  it("calls a harmonic sound in the speech band a voice", () => {
    const v = voicingFromSpectrum(tones([200, 400, 600, 800, 1000, 1200, 2400]), SR, N);
    expect(v.voiced).toBe(true);
    expect(v.bandShare).toBeGreaterThan(0.9);
    expect(v.flatness).toBeLessThan(0.05);
  });

  it("rejects flat noise (hiss): every bin equal", () => {
    const v = voicingFromSpectrum(new Float32Array(N / 2).fill(-50), SR, N);
    expect(v.voiced).toBe(false);
    expect(v.flatness).toBeGreaterThan(0.9);
  });

  it("rejects a low hum (fan, air conditioning): the energy is below the speech band", () => {
    const v = voicingFromSpectrum(tones([70, 90, 110]), SR, N);
    expect(v.voiced).toBe(false);
    expect(v.bandShare).toBeLessThan(0.5);
  });

  it("returns not-voiced for silence (-Infinity everywhere)", () => {
    expect(voicingFromSpectrum(new Float32Array(N / 2).fill(-Infinity), SR, N).voiced).toBe(false);
  });
});

describe("DEFAULT_VAD_CONFIG", () => {
  it("1.5 s pause tolerance, 200 ms minimum speech, 30 s maximum (team feedback 2026-11-15: 0.9 s cut people off)", () => {
    expect(DEFAULT_VAD_CONFIG.silenceMs).toBe(1500);
    // 400 ms dropped one-word answers (the person then waited for a reply that never came)
    expect(DEFAULT_VAD_CONFIG.minSpeechMs).toBe(200);
    expect(DEFAULT_VAD_CONFIG.maxUtteranceMs).toBe(30_000);
  });
});

/* ───────────── end of speech: natural pauses vs. finished answers (team feedback 2026-11-15, round 2) ───────────── */

/** a frame list: [rms, voiced, ms] segments, so a test reads like the sound it describes */
type Seg = [rms: number, voiced: boolean, ms: number];
const ROOM = 0.004;
/** speech: 200 ms of voice, a 50 ms consonant (loud, not voiced), a 50 ms gap between syllables */
function talk(ms: number, level = 0.2): Seg[] {
  const out: Seg[] = [];
  let t = 0;
  while (t < ms) {
    out.push([level, true, 200], [level * 0.35, false, 50], [ROOM, false, 50]);
    t += 300;
  }
  return out;
}
const hush = (ms: number): Seg => [ROOM, false, ms];

/** plays the segments from a fresh state (after 600 ms of quiet room); signal times are from the start of `segs` */
function play(segs: Seg[], config: VadConfig = DEFAULT_VAD_CONFIG) {
  let state = createVadState();
  for (let t = 0; t < 600; t += FRAME_MS) state = stepVad(state, { rms: ROOM, dtMs: FRAME_MS, voiced: false }, config).state;
  const out: { signal: VadSignal; at: number }[] = [];
  let t = 0;
  for (const [rms, voiced, ms] of segs) {
    for (let i = 0; i < ms; i += FRAME_MS) {
      const step = stepVad(state, { rms, dtMs: FRAME_MS, voiced }, config);
      state = step.state;
      t += FRAME_MS;
      if (step.signal !== "none") out.push({ signal: step.signal, at: t });
    }
  }
  return { state, out, signals: out.map((o) => o.signal) };
}
const total = (segs: Seg[]) => segs.reduce((sum, s) => sum + s[2], 0);

describe("stepVad: adaptive end of speech", () => {
  it("a 1.2 s pause inside a sentence does not end it", () => {
    const first = talk(1500);
    const { signals, out } = play([...first, hush(1200), ...talk(1500), hush(3000)]);
    expect(signals).toEqual(["speech_start", "utterance_end"]);
    expect(out[1].at).toBeGreaterThan(total(first) + 1200 + 1500); // ended after the second phrase, not in the pause
  });

  it("a 1.2 s pause after 3 s of talking does not end it either", () => {
    const { signals } = play([...talk(3000), hush(1200), ...talk(1500), hush(3000)]);
    expect(signals).toEqual(["speech_start", "utterance_end"]);
  });

  it("1 s of silence after a long utterance ends it (was 1.5 s)", () => {
    const long = talk(8000); // about 5.3 s of voice
    const { signals, out } = play([...long, hush(3000)]);
    expect(signals).toEqual(["speech_start", "utterance_end"]);
    const after = out[1].at - (total(long) - 50); // talk() ends with a 50 ms gap after the last consonant
    expect(after).toBeGreaterThanOrEqual(1000);
    expect(after).toBeLessThanOrEqual(1000 + FRAME_MS);
  });

  it("the end tolerance falls from 1.5 s to 1 s as more voice is heard", () => {
    expect(endSilenceMs(0)).toBe(1500);
    expect(endSilenceMs(2000)).toBe(1500);
    expect(endSilenceMs(3500)).toBe(1250);
    expect(endSilenceMs(5000)).toBe(1000);
    expect(endSilenceMs(60_000)).toBe(1000);
  });

  it("never ends within the first second of speech", () => {
    const config = { ...DEFAULT_VAD_CONFIG, silenceMs: 300, trailSilenceMs: 300 };
    const { out } = play([[0.2, true, 200], hush(2000)], config);
    expect(out.map((o) => o.signal)).toEqual(["speech_start", "utterance_end"]);
    expect(out[1].at).toBeGreaterThanOrEqual(1000); // the voice began at 0
  });

  it("a one-word answer ('yes', 'тийм': 250 ms of voice) is sent, not dropped as a blip (it used to be)", () => {
    const { signals, out } = play([[0.2, true, 250], [0.07, false, 100], hush(3000)]);
    expect(signals).toEqual(["speech_start", "utterance_end"]);
    expect(out[1].at - 350).toBe(1500);
  });

  it("soft words under the threshold keep a sentence open instead of ending it after 1.5 s", () => {
    const { signals, out } = play([...talk(1500), [0.015, true, 1800], ...talk(1500), hush(3000)]);
    expect(signals).toEqual(["speech_start", "utterance_end"]);
    expect(out[1].at).toBeGreaterThan(1500 + 1800 + 1500);
  });

  it("room noise after the last word (a fan, gain control lifting the room) ends it like silence", () => {
    const answer = talk(2000);
    const { signals, out } = play([...answer, [0.04, false, 5000]]);
    expect(signals).toEqual(["speech_start", "utterance_end"]); // was too_short: the answer was dropped
    expect(out[1].at - total(answer)).toBeLessThanOrEqual(1500 + FRAME_MS);
  });

  it("distant voices after the answer end it within 2.5 s (they used to hold the mic open until the 30 s cap)", () => {
    const answer = talk(2000);
    const { signals, out } = play([...answer, [0.03, true, 10_000]]);
    expect(signals).toEqual(["speech_start", "utterance_end"]);
    expect(out[1].at - total(answer)).toBeLessThanOrEqual(DEFAULT_VAD_CONFIG.unvoicedEndMs + FRAME_MS);
  });

  it("noise does not start it: a fan with voice-like pops, keyboard clatter, a 100 ms voiced click", () => {
    const pops: Seg[] = [];
    for (let i = 0; i < 10; i++) pops.push([0.3, false, 900], [0.3, true, 100]);
    expect(play(pops).signals).toEqual([]);
    const clatter: Seg[] = [];
    for (let i = 0; i < 20; i++) clatter.push([0.25, false, 100], hush(150));
    expect(play(clatter).signals).toEqual([]);
    expect(play([[0.3, true, 100], hush(3000)]).signals).toEqual([]);
  });
});

/* ───────────── barge-in -> normal listening on the same microphone (Cosmo finished, nobody spoke over her) ───────────── */

describe("handOverVadState: an answer given the moment Cosmo stops is heard", () => {
  const BARGE: VadConfig = { ...DEFAULT_VAD_CONFIG, ...BARGE_IN_VAD };
  /** 3 s of Cosmo's echo under the barge-in VAD (voiced, with gaps between words) */
  function underCosmo(): VadState {
    let s = createVadState();
    for (let i = 0; i < 10; i++) {
      for (let t = 0; t < 250; t += FRAME_MS) s = stepVad(s, { rms: 0.025, dtMs: FRAME_MS, voiced: true }, BARGE).state;
      s = stepVad(s, { rms: 0.006, dtMs: FRAME_MS, voiced: false }, BARGE).state;
    }
    return s;
  }
  /** "тийм" (300 ms of voice) right away, then the room */
  function answer(start: VadState, level: number): VadSignal[] {
    let s = start;
    const signals: VadSignal[] = [];
    const frames = [
      ...Array.from({ length: 6 }, () => ({ rms: level, voiced: true })),
      ...Array.from({ length: 80 }, () => ({ rms: 0.004, voiced: false })),
    ];
    for (const f of frames) {
      const step = stepVad(s, { ...f, dtMs: FRAME_MS }, DEFAULT_VAD_CONFIG);
      s = step.state;
      if (step.signal !== "none") signals.push(step.signal);
    }
    return signals;
  }

  it("a soft one-word answer at once is sent (a fresh room calibration measured it as the room and waited 30 s)", () => {
    const cosmo = underCosmo();
    expect(cosmo.phase).toBe("waiting");
    for (const level of [0.04, 0.06]) {
      expect(answer(createVadState(), level)).toEqual([]); // the bug: calibration swallowed the answer
      expect(answer(handOverVadState(cosmo, DEFAULT_VAD_CONFIG), level)).toEqual(["speech_start", "utterance_end"]);
    }
  });

  it("starts with calibration done and a floor capped at the base threshold (the echo floor is not kept)", () => {
    const loudEcho = { ...createVadState(), noiseFloor: 0.08, calibratedMs: 400 };
    const s = handOverVadState(loudEcho, DEFAULT_VAD_CONFIG);
    expect(s.phase).toBe("waiting");
    expect(s.calibratedMs).toBe(DEFAULT_VAD_CONFIG.calibrationMs);
    expect(effectiveThreshold(s, DEFAULT_VAD_CONFIG)).toBeCloseTo(DEFAULT_VAD_CONFIG.threshold, 6);
    expect(s.waitedMs).toBe(0);
    // a quiet room's own floor is kept as it is
    expect(handOverVadState({ ...loudEcho, noiseFloor: 0.003 }).noiseFloor).toBe(0.003);
  });

  it("noise after the handover still does not start speech (a fan, keyboard clatter)", () => {
    let s = handOverVadState(underCosmo(), DEFAULT_VAD_CONFIG);
    const signals: VadSignal[] = [];
    for (let i = 0; i < 60; i++) {
      const step = stepVad(s, { rms: i % 3 === 0 ? 0.25 : 0.03, dtMs: FRAME_MS, voiced: false });
      s = step.state;
      if (step.signal !== "none") signals.push(step.signal);
    }
    expect(signals).toEqual([]);
  });
});
