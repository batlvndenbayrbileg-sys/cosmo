/**
 * What the listening pill on the check-in stage shows (pure, unit-tested in tests/listening.test.ts).
 *
 *  - "listening": the microphone is open and waiting for the person (not while Cosmo talks: the barge-in recording that
 *    runs under her voice needs no extra sign).
 *  - "heard": the person is speaking. The pill offers "Done": one tap sends at once instead of waiting for the pause.
 *  - "writing": the utterance was sent, speech-to-text is running (shown the same moment the recording ends).
 *  - "thinking": the words are in (they are quoted), Cosmo is working out the reply or loading her voice.
 */
import type { SpeechStatus } from "./state";

export type ListeningPillMode = "listening" | "heard" | "writing" | "thinking";

export interface ListeningPillInput {
  recording: boolean;
  /** the VAD heard speech start in this recording */
  heard: boolean;
  /** a turn request is in flight */
  busy: boolean;
  speech: SpeechStatus;
  /** the request in flight is a voice utterance that has no transcript yet */
  transcribing: boolean;
}

export function listeningPillMode(input: ListeningPillInput): ListeningPillMode | null {
  if (input.recording) {
    if (input.heard) return "heard";
    return input.speech === "idle" ? "listening" : null;
  }
  if (input.busy) return input.transcribing ? "writing" : "thinking";
  if (input.speech === "loading") return "thinking";
  return null;
}

/** The words quoted in the "thinking" pill: short enough for one line on a phone. */
export function quoteForPill(text: string | null | undefined, max = 48): string | null {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (clean === "") return null;
  if (clean.length <= max) return clean;
  // the last whole word that leaves room for the ellipsis (a word cut in the middle only when there is no space)
  const space = clean.slice(0, max).lastIndexOf(" ");
  const kept = space > max * 0.6 ? clean.slice(0, space) : clean.slice(0, max - 1);
  return `${kept.trimEnd()}…`;
}
