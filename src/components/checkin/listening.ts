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

/**
 * Whether hands-free listening may go on once Cosmo has finished: the same conditions under which the check-in screen
 * opens the microphone by itself. The barge-in recording (open under her voice) is handed over to normal listening
 * only then; otherwise it is closed. Without this check, a text field opened while she spoke, a finished check-in or
 * a running demo left the microphone listening (and sending) after her last word.
 */
export interface HandsFreeInput {
  conversationMode: boolean;
  micUsable: boolean;
  ready: boolean;
  canTalk: boolean;
  keyboardOpen: boolean;
  /** autoplay blocked: Cosmo waits for a tap */
  blocked: boolean;
  /** the check-in conversation is DONE (on the check-in stage) */
  finished: boolean;
  busy: boolean;
  demoRunning: boolean;
}

export function handsFreeAllowed(input: HandsFreeInput): boolean {
  return (
    input.conversationMode &&
    input.micUsable &&
    input.ready &&
    input.canTalk &&
    !input.keyboardOpen &&
    !input.blocked &&
    !input.finished &&
    !input.busy &&
    !input.demoRunning
  );
}

/**
 * The words the "thinking" pill quotes: the line of the turn in flight. Typed text is still pending (it has no
 * transcript event yet), so it wins over the last transcript line, which can be an older crew line (a turn that
 * failed after its transcript) and must not be quoted as if it were what Cosmo is thinking about now.
 */
export function pillQuoteSource(
  pending: { text: string } | null | undefined,
  lastLine: { speaker: string; text: string } | null | undefined,
): string | null {
  if (pending) return pending.text.trim() === "" ? null : pending.text;
  return lastLine?.speaker === "crew" ? lastLine.text : null;
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
