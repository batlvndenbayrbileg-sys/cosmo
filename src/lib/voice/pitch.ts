/**
 * Voice pitch (fundamental frequency, F0) from raw samples, for the "who is speaking" guess on the assistant screen.
 *
 * Runs in the browser on the decoded recording (src/components/assistant/voice.ts). The samples and the pitch never
 * leave the device: only the derived guess ("female" / "male" / "unknown") is sent with the first utterance.
 *
 * Method: the recording is decimated to about 16 kHz, cut into 40 ms frames (20 ms hop), and for every frame loud
 * enough to be speech the normalised square difference function (McLeod's NSDF, an autocorrelation normalised to
 * -1..1) is searched for its pitch period between 70 and 400 Hz. Frames whose best peak is weak (unvoiced sounds,
 * breath, noise) are dropped; the estimate is the MEDIAN of the voiced frames, which shrugs off the odd octave slip.
 *
 * Honest limits (stated in the UI's code, never as a word on screen): pitch is a weak, population-level cue. Adult
 * speaking F0 is typically around 85-155 Hz for lower voices and 165-255 Hz for higher ones, the ranges overlap, and a
 * cold, a whisper, shouting or a child's voice all move it. That is why classifyVoice has a wide "unknown" band, why
 * the guess is only ever used to pick between two crew members who speak the same language, and why every guess can be
 * corrected by voice ("би Бат", "I'm Mira") or by tapping the name.
 */

export const PITCH_MIN_HZ = 70;
export const PITCH_MAX_HZ = 400;
/** median F0 at or above this: a higher voice */
export const HIGH_VOICE_HZ = 165;
/** median F0 at or below this: a lower voice (between the two: unknown) */
export const LOW_VOICE_HZ = 145;
/** fewer voiced frames than this (about 0.2 s of voice) give no estimate */
export const MIN_VOICED_FRAMES = 10;

const TARGET_RATE = 16_000;
const FRAME_MS = 40;
const HOP_MS = 20;
/** an NSDF peak below this is not a voiced frame */
const VOICED_CLARITY = 0.6;
/** the first peak within this share of the best one is the period (avoids picking a multiple of it) */
const PEAK_SHARE = 0.9;
/** at most this much of the recording is analysed */
const MAX_SECONDS = 8;

export type VoiceClass = "female" | "male" | "unknown";

export interface PitchEstimate {
  /** median F0 over the voiced frames, Hz; null when too little voice was found */
  medianHz: number | null;
  voicedFrames: number;
}

/** Averages blocks of samples down to about 16 kHz (enough for 70-400 Hz, and cheap). */
export function decimate(samples: Float32Array, sampleRate: number): { samples: Float32Array; sampleRate: number } {
  const factor = Math.max(1, Math.floor(sampleRate / TARGET_RATE));
  if (factor === 1) return { samples, sampleRate };
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += samples[i * factor + j];
    out[i] = sum / factor;
  }
  return { samples: out, sampleRate: sampleRate / factor };
}

function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
}

/**
 * F0 of one frame in Hz, or null when the frame is not clearly voiced. `frame` should hold at least two periods of the
 * lowest pitch (40 ms at 16 kHz is 640 samples).
 */
export function estimateFrameF0(frame: Float32Array, sampleRate: number): number | null {
  const n = frame.length;
  const minLag = Math.max(2, Math.floor(sampleRate / PITCH_MAX_HZ));
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / PITCH_MIN_HZ));
  if (maxLag <= minLag) return null;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i];
  mean /= n;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = frame[i] - mean;

  const nsdf = new Float32Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag + 1 && lag < n; lag++) {
    let acf = 0;
    let energy = 0;
    for (let i = 0; i + lag < n; i++) {
      acf += x[i] * x[i + lag];
      energy += x[i] * x[i] + x[i + lag] * x[i + lag];
    }
    nsdf[lag] = energy > 0 ? (2 * acf) / energy : 0;
  }

  // skip the lobe around lag 0: search only after the function has first dropped below zero
  let start = minLag;
  while (start < maxLag && nsdf[start] > 0) start++;
  if (start >= maxLag) return null;

  // local maxima after the dip
  const peaks: number[] = [];
  let best = -1;
  for (let lag = Math.max(start, minLag); lag <= maxLag; lag++) {
    if (nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1]) {
      peaks.push(lag);
      if (nsdf[lag] > best) best = nsdf[lag];
    }
  }
  if (peaks.length === 0 || best < VOICED_CLARITY) return null;
  const period = peaks.find((lag) => nsdf[lag] >= PEAK_SHARE * best) ?? peaks[0];

  // parabolic interpolation around the chosen peak for sub-sample precision
  const a = nsdf[period - 1];
  const b = nsdf[period];
  const c = nsdf[period + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  const hz = sampleRate / (period + shift);
  return hz >= PITCH_MIN_HZ && hz <= PITCH_MAX_HZ ? hz : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((p, q) => p - q);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The median F0 over the voiced frames of a recording (mono samples, -1..1). */
export function estimatePitch(input: Float32Array, inputRate: number): PitchEstimate {
  if (!(inputRate > 0) || input.length === 0) return { medianHz: null, voicedFrames: 0 };
  const clipped = input.length > inputRate * MAX_SECONDS ? input.subarray(0, Math.floor(inputRate * MAX_SECONDS)) : input;
  const { samples, sampleRate } = decimate(clipped, inputRate);
  const frameLen = Math.round((sampleRate * FRAME_MS) / 1000);
  const hop = Math.round((sampleRate * HOP_MS) / 1000);
  if (samples.length < frameLen) return { medianHz: null, voicedFrames: 0 };

  // speech frames are the loud ones: at least 15% of the loudest frame and above a floor (silence, room hum)
  const levels: number[] = [];
  for (let at = 0; at + frameLen <= samples.length; at += hop) levels.push(rms(samples.subarray(at, at + frameLen)));
  const loudest = Math.max(...levels);
  const floor = Math.max(0.005, loudest * 0.15);

  const f0s: number[] = [];
  levels.forEach((level, k) => {
    if (level < floor) return;
    const at = k * hop;
    const hz = estimateFrameF0(samples.subarray(at, at + frameLen), sampleRate);
    if (hz !== null) f0s.push(hz);
  });
  if (f0s.length < MIN_VOICED_FRAMES) return { medianHz: null, voicedFrames: f0s.length };
  return { medianHz: median(f0s), voicedFrames: f0s.length };
}

/**
 * The guess from a median F0: at or above 165 Hz a higher ("female") voice, at or below 145 Hz a lower ("male") one,
 * in between or without an estimate "unknown". A heuristic, not a fact about anyone: see the module comment.
 */
export function classifyVoice(medianHz: number | null): VoiceClass {
  if (medianHz === null || !Number.isFinite(medianHz)) return "unknown";
  if (medianHz >= HIGH_VOICE_HZ) return "female";
  if (medianHz <= LOW_VOICE_HZ) return "male";
  return "unknown";
}

/** true when two guesses are both confident and different: the speaker has probably changed */
export function voiceClearlyChanged(previous: VoiceClass | null, next: VoiceClass): boolean {
  return previous !== null && previous !== "unknown" && next !== "unknown" && previous !== next;
}
