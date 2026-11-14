/**
 * Voice-activity detection as a pure state machine (docs/BRIEF.md section 1, docs/PLAN.md section 6).
 *
 * The recorder samples an AnalyserNode every ~50 ms, converts the time-domain buffer to an RMS level
 * with `rmsFromSamples` and feeds `{ rms, dtMs }` frames into `stepVad`. The machine decides when an
 * utterance starts and ends:
 *
 *   waiting --loud frame--> speaking --900 ms below threshold--> end (utterance_end)
 *
 *  - minimum speech: an utterance with less than 300 ms of loud frames is a click or a cough and is
 *    discarded (`too_short`); the machine goes back to waiting and the recorder restarts.
 *  - maximum length: 30 s after speech started the utterance is cut (`max_length`) and still sent.
 *  - no speech at all for `noSpeechTimeoutMs`: `no_speech` (the mic closes instead of listening forever).
 *  - the loudness threshold adapts to the room: it is max(base threshold, noise floor x multiplier),
 *    where the noise floor is a moving average of the frames that were not loud.
 *  - calibration: the first `calibrationMs` after listening starts only measure the room (the floor is
 *    their mean level). Without this a room
 *    that is steadily above the base threshold (projector fan, AGC hiss) would count as speech from
 *    the first frame and never go quiet, so the utterance would only end at the 30 s cap. A frame
 *    clearly louder than `calibrationSpeechRms` still starts speech during calibration, so a person
 *    who starts talking the moment the mic opens is not cut off.
 *  - quiet frames inside an utterance keep refining the noise floor, so slow room changes are followed.
 */

export interface VadConfig {
  /** minimum RMS (0..1) that can count as speech, whatever the room noise */
  threshold: number;
  /** speech must exceed the measured noise floor by this factor */
  noiseMultiplier: number;
  /** continuous quiet after speech that ends the utterance */
  silenceMs: number;
  /** minimum accumulated loud time for an utterance to be kept */
  minSpeechMs: number;
  /** hard cap on one utterance, measured from the first loud frame */
  maxUtteranceMs: number;
  /** give up when nothing loud happens for this long */
  noSpeechTimeoutMs: number;
  /** smoothing of the noise-floor estimate (0..1, higher adapts faster) */
  noiseAlpha: number;
  /** measure-only window at the start of listening (0 disables calibration) */
  calibrationMs: number;
  /** a frame above this RMS is speech even inside the calibration window */
  calibrationSpeechRms: number;
}



export const DEFAULT_VAD_CONFIG: VadConfig = {
  threshold: 0.02,
  noiseMultiplier: 3,
  silenceMs: 900,
  minSpeechMs: 300,
  maxUtteranceMs: 30_000,
  noSpeechTimeoutMs: 20_000,
  noiseAlpha: 0.1,
  calibrationMs: 300,
  calibrationSpeechRms: 0.08,
};

export type VadPhase = "waiting" | "speaking" | "ended";

export interface VadState {
  phase: VadPhase;
  /** time spent waiting for speech (accumulates across discarded blips) */
  waitedMs: number;
  /** accumulated loud time of the current utterance */
  speechMs: number;
  /** current run of quiet frames inside the utterance */
  silenceMs: number;
  /** time since the first loud frame of the current utterance */
  utteranceMs: number;
  /** moving average of quiet-frame RMS, 0 until the first frame */
  noiseFloor: number;
  /** time spent calibrating so far (stops growing once the window is over) */
  calibratedMs: number;
  /** calibration only: sum of RMS x time, the floor is its mean */
  calibSum: number;
}

export type VadSignal =
  | "none"
  | "speech_start"
  | "utterance_end"
  | "too_short"
  | "max_length"
  | "no_speech";

export interface VadFrame {
  /** RMS level of the frame, 0..1 */
  rms: number;
  /** time since the previous frame in ms */
  dtMs: number;
}

export function createVadState(): VadState {
  return {
    phase: "waiting",
    waitedMs: 0,
    speechMs: 0,
    silenceMs: 0,
    utteranceMs: 0,
    noiseFloor: 0,
    calibratedMs: 0,
    calibSum: 0,
  };
}

/** RMS (0..1) of a time-domain buffer: bytes are centred on 128, floats are already -1..1. */
export function rmsFromSamples(samples: Uint8Array | Float32Array): number {
  if (samples.length === 0) return 0;
  const bytes = samples instanceof Uint8Array;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = bytes ? (samples[i] - 128) / 128 : samples[i];
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/** Level an RMS value has to exceed to count as speech right now. */
export function effectiveThreshold(state: VadState, config: VadConfig = DEFAULT_VAD_CONFIG): number {
  return Math.max(config.threshold, state.noiseFloor * config.noiseMultiplier);
}

/** Moving average of the room level; it falls faster than it rises so an over-estimate recovers. */
function adaptFloor(floor: number, rms: number, config: VadConfig): number {
  if (floor === 0) return rms;
  const alpha = rms < floor ? Math.min(1, config.noiseAlpha * 3) : config.noiseAlpha;
  return floor + alpha * (rms - floor);
}

/** One waiting frame inside the calibration window: measure the room, start speech only if it is loud. */
function stepCalibration(
  state: VadState,
  rms: number,
  dt: number,
  config: VadConfig,
): { state: VadState; signal: VadSignal } {
  if (rms > Math.max(config.calibrationSpeechRms, effectiveThreshold(state, config))) {
    // clearly speech already: calibration ends with what was measured so far (the floor may still be 0)
    return {
      state: {
        ...state,
        phase: "speaking",
        speechMs: dt,
        silenceMs: 0,
        utteranceMs: dt,
        calibratedMs: config.calibrationMs,
      },
      signal: "speech_start",
    };
  }
  const calibratedMs = state.calibratedMs + dt;
  const calibSum = state.calibSum + rms * dt;
  const waitedMs = state.waitedMs + dt;
  const next: VadState = {
    ...state,
    waitedMs,
    calibratedMs,
    calibSum,
    noiseFloor: calibratedMs > 0 ? calibSum / calibratedMs : state.noiseFloor,
  };
  if (waitedMs >= config.noSpeechTimeoutMs) return { state: { ...next, phase: "ended" }, signal: "no_speech" };
  return { state: next, signal: "none" };
}

export function stepVad(
  state: VadState,
  frame: VadFrame,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): { state: VadState; signal: VadSignal } {
  if (state.phase === "ended") return { state, signal: "none" };
  const dt = Math.max(0, frame.dtMs);
  const rms = Math.max(0, frame.rms);
  const loud = rms > effectiveThreshold(state, config);

  if (state.phase === "waiting") {
    if (state.calibratedMs < config.calibrationMs) {
      return stepCalibration(state, rms, dt, config);
    }
    if (loud) {
      return {
        state: { ...state, phase: "speaking", speechMs: dt, silenceMs: 0, utteranceMs: dt },
        signal: "speech_start",
      };
    }
    const noiseFloor = adaptFloor(state.noiseFloor, rms, config);
    const waitedMs = state.waitedMs + dt;
    if (waitedMs >= config.noSpeechTimeoutMs) {
      return { state: { ...state, phase: "ended", waitedMs, noiseFloor }, signal: "no_speech" };
    }
    return { state: { ...state, waitedMs, noiseFloor }, signal: "none" };
  }

  // speaking
  const utteranceMs = state.utteranceMs + dt;
  const speechMs = loud ? state.speechMs + dt : state.speechMs;
  const silenceMs = loud ? 0 : state.silenceMs + dt;
  // quiet frames inside the utterance (pauses) keep the room estimate current
  const noiseFloor = loud ? state.noiseFloor : adaptFloor(state.noiseFloor, rms, config);
  const next: VadState = { ...state, utteranceMs, speechMs, silenceMs, noiseFloor };

  if (utteranceMs >= config.maxUtteranceMs) {
    return { state: { ...next, phase: "ended" }, signal: "max_length" };
  }
  if (silenceMs >= config.silenceMs) {
    if (speechMs >= config.minSpeechMs) {
      return { state: { ...next, phase: "ended" }, signal: "utterance_end" };
    }
    // a blip: forget it and keep listening; its duration still counts towards the no-speech timeout
    return {
      state: {
        phase: "waiting",
        waitedMs: state.waitedMs + utteranceMs,
        speechMs: 0,
        silenceMs: 0,
        utteranceMs: 0,
        noiseFloor: next.noiseFloor,
        calibratedMs: state.calibratedMs,
        calibSum: state.calibSum,
      },
      signal: "too_short",
    };
  }
  return { state: next, signal: "none" };
}
