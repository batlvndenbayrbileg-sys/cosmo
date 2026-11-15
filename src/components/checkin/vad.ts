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
 *  - pauses (adaptive end of speech, `endSilenceMs`): after a short or medium answer 1.5 s of quiet ends the utterance
 *    (0.9 s cut people off while they were thinking mid-sentence); once 5 s of voice was heard, 1 s does (a long answer
 *    that stops is finished, and waiting 1.5 s more felt like Cosmo was not listening). Nothing ends within the first
 *    second. Soft voiced frames under the threshold (a phrase that trails off quietly) hold a pause open (hysteresis);
 *    loud unvoiced frames hold it only as consonants right after a voice, and frames far below the speaker's own level
 *    (distant voices, the room lifted by automatic gain) count as quiet.
 *  - minimum speech: an utterance with less than 200 ms of voiced speech is a click, a cough or a noise and is
 *    discarded (`too_short`); the machine goes back to waiting and the recorder restarts. Nothing is sent, so Cosmo
 *    does not answer noise with "sorry, I didn't catch that". (400 ms dropped one-word answers such as "yes".)
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
  /** continuous quiet after speech that ends the utterance (a short or medium answer, see `endSilenceMs`) */
  silenceMs: number;
  /** the quiet that ends a LONG utterance: someone who has talked for a while and stops is done, not thinking */
  trailSilenceMs: number;
  /** up to this much voiced speech the end needs the full `silenceMs` ... */
  shortSpeechMs: number;
  /** ... from this much on only `trailSilenceMs` (linear in between) */
  longSpeechMs: number;
  /** an utterance never ends (by quiet or by noise) earlier than this after it started */
  minUtteranceMs: number;
  /**
   * inside an utterance, a loud frame that does not sound like a voice keeps it open only this soon after the last
   * voiced frame (a consonant: s, sh, ts, kh). Later it counts as quiet, so a fan or traffic that follows the last word
   * ends the utterance like silence does instead of holding it open
   */
  consonantMs: number;
  /**
   * inside an utterance a frame below this share of the speaker's own level is quiet even when it clears the room
   * threshold: distant voices (TV, colleagues) or the room lifted by automatic gain once the person stopped
   */
  quietRatio: number;
  /** smoothing of the speaker's level (loud voiced frames only) */
  levelAlpha: number;
  /** minimum accumulated loud AND voiced time for an utterance to be kept */
  minSpeechMs: number;
  /** inside an utterance: this long without a voiced frame ends it, even if it is still loud (noise after speech) */
  unvoicedEndMs: number;
  /** speech starts only after this much CONTINUOUS loud voiced sound (a lone voiced-looking noise frame does not) */
  onsetMs: number;
  /** a room whose noise floor is at or above this RMS is noisy: speech must then last noisyOnsetMs before it counts */
  noisyFloorRms: number;
  /** the onset in a noisy room (chatter, machinery): a 250 ms "yes" still passes, a burst of noise does not */
  noisyOnsetMs: number;
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
  trailSilenceMs: 1000,
  shortSpeechMs: 2000,
  longSpeechMs: 5000,
  minUtteranceMs: 1000,
  consonantMs: 400,
  quietRatio: 0.2,
  levelAlpha: 0.1,
  // 400 ms dropped one-word answers ("yes", "тийм", "найм" have 250-350 ms of voice): the person then waited for an
  // answer that never came. Noise is kept out by the voicing check, the 150 ms onset and the voiced share.
  minSpeechMs: 200,
  unvoicedEndMs: 2500,
  onsetMs: 150,
  noisyFloorRms: 0.01,
  noisyOnsetMs: 250,
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
  /** `loudMs` at the last loud voiced frame: noise after the last word does not count against the voiced share */
  loudAtVoicedMs: number;
  /** moving average of the speaker's level (RMS of the loud voiced frames of this utterance), 0 before speech */
  speechLevel: number;
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
    loudAtVoicedMs: 0,
    speechLevel: 0,
    utteranceMs: 0,
    noiseFloor: 0,
    calibratedMs: 0,
    calibSum: 0,
  };
}

/**
 * The barge-in recording (open while Cosmo spoke) becomes normal listening on the same microphone: Cosmo finished and
 * nobody spoke over her. The room is NOT measured again: calibration counts its first 300 ms as the room, so a person
 * who answers the moment she stops ("тийм", "yes") would be measured as the room and the answer would never start (the
 * mic then waited 30 s). The floor learned under her voice is kept, capped so the threshold starts at the base
 * threshold (that floor included her echo); quiet frames keep adapting it as usual.
 */
export function handOverVadState(state: VadState, config: VadConfig = DEFAULT_VAD_CONFIG): VadState {
  const cap = config.threshold / Math.max(1, config.noiseMultiplier);
  return { ...createVadState(), calibratedMs: config.calibrationMs, noiseFloor: Math.min(state.noiseFloor, cap) };
}

/**
 * The quiet that ends the utterance now: the full `silenceMs` after a short answer (a pause there is usually thinking),
 * falling linearly to `trailSilenceMs` once `longSpeechMs` of voice was heard (a long answer that stops is finished).
 */
export function endSilenceMs(speechMs: number, config: VadConfig = DEFAULT_VAD_CONFIG): number {
  const span = config.longSpeechMs - config.shortSpeechMs;
  const t = span > 0 ? Math.min(1, Math.max(0, (speechMs - config.shortSpeechMs) / span)) : speechMs >= config.longSpeechMs ? 1 : 0;
  return Math.round(config.silenceMs + t * (Math.min(config.trailSilenceMs, config.silenceMs) - config.silenceMs));
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
        loudAtVoicedMs: dt,
        speechLevel: rms,
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
      // in a noisy room a voice-like burst must last longer before it counts as the person speaking
      const needOnsetMs =
        state.noiseFloor >= config.noisyFloorRms ? Math.max(config.onsetMs, config.noisyOnsetMs) : config.onsetMs;
      if (frame.voiced === undefined || onsetMs >= needOnsetMs) {
        return {
          state: {
            ...state,
            phase: "speaking",
            waitedMs,
            speechMs: onsetMs,
            loudMs: onsetMs,
            loudAtVoicedMs: onsetMs,
            speechLevel: rms,
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
  // far below the speaker's own level: distant voices, or the room lifted by gain control once the person stopped
  const underSpeaker = state.speechLevel > 0 && rms < state.speechLevel * config.quietRatio;
  const loudHere = loud && !underSpeaker;
  const speech = loudHere && voiced;
  // a voice that does not clear the threshold (soft words, a phrase that trails off quietly) holds the pause open but is
  // not speech; how long it can do that is bounded by unvoicedEndMs since the last real speech frame
  const hold =
    !speech &&
    frame.voiced === true &&
    rms > Math.max(config.threshold * 0.5, state.noiseFloor * config.voicedMultiplier);
  const sinceVoicedMs = speech ? 0 : state.sinceVoicedMs + dt;
  // loud unvoiced frames right after a voice are consonants (s, sh, ts) and keep the utterance open; the same sound
  // going on for longer is the room (fan, traffic) and counts as quiet
  const consonant = loudHere && !voiced && sinceVoicedMs <= config.consonantMs;
  const silenceMs = speech || hold || consonant ? 0 : state.silenceMs + dt;
  const speechMs = speech ? state.speechMs + dt : state.speechMs;
  const loudMs = loudHere ? state.loudMs + dt : state.loudMs;
  const loudAtVoicedMs = speech ? loudMs : state.loudAtVoicedMs;
  const speechLevel = speech ? state.speechLevel + config.levelAlpha * (rms - state.speechLevel) : state.speechLevel;
  // quiet, unvoiced frames inside the utterance (pauses) keep the room estimate current
  const roomFrame = !loudHere && !(voiced && frame.voiced !== undefined);
  const noiseFloor = roomFrame ? adaptFloor(state.noiseFloor, rms, config) : state.noiseFloor;
  const next: VadState = {
    ...state,
    utteranceMs,
    speechMs,
    loudMs,
    loudAtVoicedMs,
    speechLevel,
    silenceMs,
    sinceVoicedMs,
    noiseFloor,
  };

  // enough voice, and not mostly noise with a few voice-like moments in it (noise after the last word does not count)
  const realSpeech = speechMs >= config.minSpeechMs && speechMs >= config.minVoicedShare * loudAtVoicedMs;
  // a pause (shorter once a long answer was heard), or no real voice for a while (only soft or distant voices)
  const needQuietMs = endSilenceMs(speechMs, config);
  const needNoVoiceMs = config.unvoicedEndMs - (config.silenceMs - needQuietMs);
  const capped = utteranceMs >= config.maxUtteranceMs;
  // 30 s of real speech is sent; 30 s of mostly noise is dropped like a blip
  if (capped && realSpeech) {
    return { state: { ...next, phase: "ended" }, signal: "max_length" };
  }
  if (capped || (utteranceMs >= config.minUtteranceMs && (silenceMs >= needQuietMs || sinceVoicedMs >= needNoVoiceMs))) {
    if (realSpeech) {
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
        loudAtVoicedMs: 0,
        speechLevel: 0,
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
