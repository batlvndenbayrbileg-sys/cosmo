/**
 * Voice-activity detection as a pure state machine (docs/BRIEF.md section 1, docs/PLAN.md section 6).
 *
 * The recorder samples an AnalyserNode every ~50 ms, converts the time-domain buffer to an RMS level
 * with `rmsFromSamples` and feeds `{ rms, dtMs }` frames into `stepVad`. The machine decides when an
 * utterance starts and ends:
 *
 *   waiting --loud VOICED frame--> speaking --1.5 s below threshold--> end (utterance_end)
 *
 *  - voiced: besides the level, each frame carries `voiced` (see `voicingFromSpectrum`): whether its spectrum looks like
 *    a human voice (energy concentrated in the speech band, harmonic rather than flat like a fan, hiss or traffic).
 *    Only loud AND voiced frames start an utterance or count as speech, so background noise neither opens the
 *    microphone nor gets sent to be "answered". Loud unvoiced frames inside an utterance (consonants like s, sh, ts)
 *    still keep it open; but if nothing voiced is heard for `unvoicedEndMs` the utterance ends anyway, so a noise that
 *    follows the speech cannot hold the microphone open.
 *  - pauses: 1.5 s of quiet ends an utterance (was 0.9 s, which cut people off while they were thinking mid-sentence).
 *  - minimum speech: an utterance with less than 400 ms of voiced speech is a click, a cough or a noise and is
 *    discarded (`too_short`); the machine goes back to waiting and the recorder restarts. Nothing is sent, so Cosmo
 *    does not answer noise with "sorry, I didn't catch that".
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
  /** the same factor for a frame the spectrum says is a voice (it needs less margin over a noisy room) */
  voicedMultiplier: number;
  /** continuous quiet after speech that ends the utterance */
  silenceMs: number;
  /** minimum accumulated loud AND voiced time for an utterance to be kept */
  minSpeechMs: number;
  /** inside an utterance: this long without a voiced frame ends it, even if it is still loud (noise after speech) */
  unvoicedEndMs: number;
  /** speech starts only after this much CONTINUOUS loud voiced sound (a lone voiced-looking noise frame does not) */
  onsetMs: number;
  /** an utterance is kept only if at least this share of its loud time was voiced (else it was mostly noise) */
  minVoicedShare: number;
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
  /**
   * Barge-in listening (while Cosmo is speaking): Cosmo's own voice leaking back from the speakers IS voice, so while
   * waiting, voiced frames that are not loud enough count as the room too. The person then has to be clearly louder
   * than Cosmo's echo to interrupt. Off for normal listening.
   */
  roomIncludesVoice?: boolean;
}

/**
 * Listening WHILE Cosmo speaks, so the person can interrupt her (team feedback 2026-11-15). The floor learns the level
 * of Cosmo's echo (roomIncludesVoice), speech must be 3x louder than it for 250 ms, and the calibration override is off
 * (Cosmo's first syllable must never count as the person).
 */
export const BARGE_IN_VAD: Partial<VadConfig> = {
  roomIncludesVoice: true,
  voicedMultiplier: 3,
  noiseMultiplier: 3,
  onsetMs: 250,
  calibrationMs: 400,
  calibrationSpeechRms: 1,
  noSpeechTimeoutMs: 120_000,
};



export const DEFAULT_VAD_CONFIG: VadConfig = {
  threshold: 0.02,
  // frames of unknown or non-voice sound must clear the room by 3x; a frame the spectrum confirms as a voice only by
  // 1.4x (3x missed normal speech next to a fan)
  noiseMultiplier: 3,
  voicedMultiplier: 1.4,
  silenceMs: 1500,
  minSpeechMs: 400,
  unvoicedEndMs: 2500,
  onsetMs: 150,
  minVoicedShare: 0.35,
  maxUtteranceMs: 30_000,
  noSpeechTimeoutMs: 30_000,
  noiseAlpha: 0.1,
  calibrationMs: 300,
  calibrationSpeechRms: 0.08,
};

export type VadPhase = "waiting" | "speaking" | "ended";

export interface VadState {
  phase: VadPhase;
  /** time spent waiting for speech (accumulates across discarded blips) */
  waitedMs: number;
  /** accumulated loud and voiced time of the current utterance */
  speechMs: number;
  /** current run of quiet frames inside the utterance */
  silenceMs: number;
  /** time since the last loud voiced frame of the current utterance */
  sinceVoicedMs: number;
  /** waiting: current run of continuous loud voiced frames (speech starts at onsetMs) */
  onsetMs: number;
  /** accumulated loud time (voiced or not) of the current utterance */
  loudMs: number;
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
  /** the frame sounds like a voice (voicingFromSpectrum); undefined = unknown, treated as voiced */
  voiced?: boolean;
}

export function createVadState(): VadState {
  return {
    phase: "waiting",
    waitedMs: 0,
    speechMs: 0,
    silenceMs: 0,
    sinceVoicedMs: 0,
    onsetMs: 0,
    loudMs: 0,
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

/* ───────────── voicing: does this frame sound like a voice? ───────────── */

export interface VoicingConfig {
  /** speech band (Hz): where a voice puts most of its energy (fundamental + first formants) */
  bandLowHz: number;
  bandHighHz: number;
  /** analysed range (Hz) the band share is measured against */
  rangeLowHz: number;
  rangeHighHz: number;
  /** minimum share of the analysed energy inside the speech band */
  minBandShare: number;
  /** maximum spectral flatness in the speech band (0 = pure tones / harmonics, 1 = white noise) */
  maxFlatness: number;
}

export const DEFAULT_VOICING: VoicingConfig = {
  bandLowHz: 150,
  bandHighHz: 3500,
  rangeLowHz: 60,
  rangeHighHz: 8000,
  minBandShare: 0.5,
  maxFlatness: 0.35,
};

export interface Voicing {
  voiced: boolean;
  /** share of the analysed energy inside the speech band */
  bandShare: number;
  /** spectral flatness (geometric / arithmetic mean of power) inside the speech band */
  flatness: number;
}

/**
 * Classifies one frame from its spectrum in dB (AnalyserNode.getFloatFrequencyData: bin i is at i x sampleRate /
 * fftSize Hz). A voice puts most of its energy between ~150 Hz and 3.5 kHz and is harmonic (peaky spectrum, low
 * flatness). Fans, air conditioning and traffic rumble sit low; hiss, rain and keyboard clatter are flat.
 */
export function voicingFromSpectrum(
  db: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  config: VoicingConfig = DEFAULT_VOICING,
): Voicing {
  const binHz = sampleRate / fftSize;
  let total = 0;
  let band = 0;
  let bandBins = 0;
  let logSum = 0;
  for (let i = 1; i < db.length; i++) {
    const hz = i * binHz;
    if (hz < config.rangeLowHz || hz > config.rangeHighHz) continue;
    const v = db[i];
    const p = Number.isFinite(v) ? Math.pow(10, v / 10) : 0;
    total += p;
    if (hz >= config.bandLowHz && hz <= config.bandHighHz) {
      band += p;
      bandBins += 1;
      logSum += Math.log(p + 1e-20);
    }
  }
  if (total <= 0 || bandBins === 0 || band <= 0) return { voiced: false, bandShare: 0, flatness: 1 };
  const bandShare = band / total;
  const flatness = Math.exp(logSum / bandBins) / (band / bandBins);
  return {
    voiced: bandShare >= config.minBandShare && flatness <= config.maxFlatness,
    bandShare,
    flatness,
  };
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
  voiced: boolean,
): { state: VadState; signal: VadSignal } {
  if (voiced && rms > Math.max(config.calibrationSpeechRms, effectiveThreshold(state, config))) {
    // clearly speech already: calibration ends with what was measured so far (the floor may still be 0)
    return {
      state: {
        ...state,
        phase: "speaking",
        speechMs: dt,
        loudMs: dt,
        silenceMs: 0,
        sinceVoicedMs: 0,
        onsetMs: 0,
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
  const voiced = frame.voiced !== false;
  // a frame the spectrum confirms as a voice only has to clear the room by voicedMultiplier
  const loud =
    frame.voiced === true
      ? rms > Math.max(config.threshold, state.noiseFloor * config.voicedMultiplier)
      : rms > effectiveThreshold(state, config);

  if (state.phase === "waiting") {
    if (state.calibratedMs < config.calibrationMs) {
      return stepCalibration(state, rms, dt, config, voiced);
    }
    const waitedMs = state.waitedMs + dt;
    if (loud && voiced) {
      // without spectrum data (voiced unknown) the first loud frame starts speech, as before
      const onsetMs = state.onsetMs + dt;
      if (frame.voiced === undefined || onsetMs >= config.onsetMs) {
        return {
          state: {
            ...state,
            phase: "speaking",
            waitedMs,
            speechMs: onsetMs,
            loudMs: onsetMs,
            silenceMs: 0,
            sinceVoicedMs: 0,
            onsetMs: 0,
            utteranceMs: onsetMs,
          },
          signal: "speech_start",
        };
      }
      return { state: { ...state, waitedMs, onsetMs }, signal: "none" };
    }
    // anything that is not a voice is the room: quiet frames and steady noise alike set the floor. A voiced frame that
    // is not loud enough yet (soft speech) is NOT the room: counting it would raise the threshold above the speech itself
    // (a LOUD non-voice frame, e.g. a door or a keyboard burst, is learned 4x slower: a steady fan still becomes the room
    // within a couple of seconds, a short clatter does not lift the threshold above the next words)
    const noiseFloor =
      voiced && frame.voiced !== undefined && !config.roomIncludesVoice
        ? state.noiseFloor
        : adaptFloor(state.noiseFloor, rms, loud ? { ...config, noiseAlpha: config.noiseAlpha / 4 } : config);
    if (waitedMs >= config.noSpeechTimeoutMs) {
      return { state: { ...state, phase: "ended", waitedMs, noiseFloor, onsetMs: 0 }, signal: "no_speech" };
    }
    return { state: { ...state, waitedMs, noiseFloor, onsetMs: 0 }, signal: "none" };
  }

  // speaking
  const utteranceMs = state.utteranceMs + dt;
  const speechMs = loud && voiced ? state.speechMs + dt : state.speechMs;
  const loudMs = loud ? state.loudMs + dt : state.loudMs;
  // loud unvoiced frames (s, sh, ts...) keep the utterance open; only real quiet counts as a pause
  const silenceMs = loud ? 0 : state.silenceMs + dt;
  const sinceVoicedMs = loud && voiced ? 0 : state.sinceVoicedMs + dt;
  // quiet, unvoiced frames inside the utterance (pauses) keep the room estimate current
  const roomFrame = !loud && !(voiced && frame.voiced !== undefined);
  const noiseFloor = roomFrame ? adaptFloor(state.noiseFloor, rms, config) : state.noiseFloor;
  const next: VadState = { ...state, utteranceMs, speechMs, loudMs, silenceMs, sinceVoicedMs, noiseFloor };

  if (utteranceMs >= config.maxUtteranceMs) {
    return { state: { ...next, phase: "ended" }, signal: "max_length" };
  }
  // a pause, or noise with no voice in it for a while (a fan or traffic that follows the speech)
  if (silenceMs >= config.silenceMs || sinceVoicedMs >= config.unvoicedEndMs) {
    // enough voice, and not mostly noise with a few voice-like moments in it
    if (speechMs >= config.minSpeechMs && speechMs >= config.minVoicedShare * loudMs) {
      return { state: { ...next, phase: "ended" }, signal: "utterance_end" };
    }
    // a blip: forget it and keep listening; its duration still counts towards the no-speech timeout
    return {
      state: {
        phase: "waiting",
        waitedMs: state.waitedMs + utteranceMs,
        speechMs: 0,
        silenceMs: 0,
        sinceVoicedMs: 0,
        onsetMs: 0,
        loudMs: 0,
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
