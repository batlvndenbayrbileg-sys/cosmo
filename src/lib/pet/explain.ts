import type { ExplainEvent } from "@/lib/explain";
import type { Lang } from "@/lib/types";

/** one line for the speech player (the shape of useSpeechPlayer's SpeakTurn) */
export interface PetLine {
  checkInId: string;
  turnId: string;
  part: number;
  text: string;
  language: Lang;
}

/**
 * The desktop pet has no screen for Cosmo's step-by-step walkthrough (src/components/explain), so she says it: every
 * beat's caption with that beat's own audio (?part=n), then the line that picks the conversation up again.
 */
export function explainLines(explain: ExplainEvent, checkInId: string): PetLine[] {
  const base = { checkInId, turnId: explain.turnId, language: explain.language };
  const lines: PetLine[] = explain.beats
    .filter((b) => b.caption.trim() !== "")
    .map((b) => ({ ...base, part: b.part, text: b.caption }));
  if (explain.resume && explain.resume.text.trim() !== "") lines.push({ ...base, part: explain.resume.part, text: explain.resume.text });
  return lines;
}
