import type { Lang, TurnEvent } from "@/lib/types";
import type { PainEventData } from "@/lib/pain";

/**
 * The pain stage's state (src/components/pain/PainStage.tsx), fed by the `pain` events of conversation turns
 * (useCheckIn calls notePainFromTurn). A small external store, like the SOS card's, so the check-in's reducer stays as
 * it is. `seq` changes with every new event: the stage restarts its step-by-step reveal for it.
 */

export interface PainUiState {
  seq: number;
  event: PainEventData;
  lang: Lang;
  /** the time the event arrived (ms), for the reveal when no voice plays */
  at: number;
}

let state: PainUiState | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function set(next: PainUiState | null): void {
  state = next;
  for (const l of listeners) l();
}

export function getPainState(): PainUiState | null {
  return state;
}

export function subscribePain(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notePainFromTurn(event: Extract<TurnEvent, { type: "pain" }>, lang: Lang): void {
  const { type: _type, ...data } = event;
  void _type;
  seq += 1;
  set({ seq, event: data, lang, at: Date.now() });
}

export function dismissPain(): void {
  if (state) set(null);
}

/** tests only */
export function resetPainStoreForTests(): void {
  state = null;
  seq = 0;
  listeners.clear();
}
