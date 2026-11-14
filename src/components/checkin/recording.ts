/**
 * Pure helpers for the recorder hook (src/hooks/useRecorder.ts), kept free of browser APIs so the
 * timing rules can be unit-tested in node.
 *
 *  - StartGate: start() awaits getUserMedia (100 ms to many seconds on the first permission prompt).
 *    A push-to-talk release, a Space tap or an unmount that happens in that window has no live session
 *    to act on; the gate remembers it so start() can honour it the moment the stream arrives.
 *  - recordingCapMs: the hard limit of one recording enforced by the recorder itself, independent of
 *    the VAD, so push-to-talk and the path without an AudioContext are capped too.
 */
import type { VadConfig } from "./vad";

export type EndRequest = "stop" | "cancel";

export class StartGate {
  private opening = false;
  private pending: EndRequest | null = null;

  /** true while a start() is waiting for the microphone */
  get starting(): boolean {
    return this.opening;
  }

  /** a start() begins; false when one is already in flight */
  begin(): boolean {
    if (this.opening) return false;
    this.opening = true;
    this.pending = null;
    return true;
  }

  /**
   * stop()/cancel() while there is no session yet. Returns true when the request was remembered
   * (a start is in flight). A cancel always wins over a stop.
   */
  defer(kind: EndRequest): boolean {
    if (!this.opening) return false;
    if (this.pending === null || kind === "cancel") this.pending = kind;
    return true;
  }

  /** the microphone arrived (or failed): the start is over; returns what was requested meanwhile */
  settle(): EndRequest | null {
    const pending = this.pending;
    this.opening = false;
    this.pending = null;
    return pending;
  }
}

/**
 * Hard limit of one recording in ms. Push-to-talk (no VAD) is capped at the maximum utterance length;
 * with VAD the recording may first wait for speech (no-speech timeout) and then run one utterance, so
 * the cap is the sum: it never fires before the VAD's own limits, it only backstops them.
 */
export function recordingCapMs(
  config: Pick<VadConfig, "maxUtteranceMs" | "noSpeechTimeoutMs">,
  vadActive: boolean,
): number {
  return vadActive ? config.maxUtteranceMs + config.noSpeechTimeoutMs : config.maxUtteranceMs;
}

export function capReached(elapsedMs: number, capMs: number): boolean {
  return elapsedMs >= capMs;
}
