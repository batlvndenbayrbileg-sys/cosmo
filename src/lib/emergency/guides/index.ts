import { BUILTIN_CALL_FOR_HELP, type EmergencyScenario } from "../schema";
import { ANAPHYLAXIS } from "./anaphylaxis";
import { BURNS } from "./burns";
import { CHEST_PAIN } from "./chest-pain";
import { CHOKING } from "./choking";
import { FAINTING } from "./fainting";
import { HEAD_INJURY } from "./head-injury";
import { NOT_BREATHING } from "./not-breathing";
import { SEIZURE } from "./seizure";
import { SEVERE_BLEEDING } from "./severe-bleeding";

export { CHECKED as GUIDES_CHECKED } from "./common";

/**
 * The guides that ship with the app, most urgent first. The order is also the voice-matching order, so "fainted and
 * not breathing" opens CPR. The always-available "get help now" card comes last.
 */
export const BUILTIN_GUIDES: readonly EmergencyScenario[] = [
  NOT_BREATHING,
  CHOKING,
  SEVERE_BLEEDING,
  ANAPHYLAXIS,
  CHEST_PAIN,
  SEIZURE,
  HEAD_INJURY,
  BURNS,
  FAINTING,
  BUILTIN_CALL_FOR_HELP,
];

/**
 * The library the app shows: the built-in guides, with a team scenario of the same id replacing the built-in one in
 * place, and the team's other scenarios first (their trigger words are the most specific, so they are matched first).
 */
export function mergeScenarios(
  team: readonly EmergencyScenario[],
  builtIn: readonly EmergencyScenario[] = BUILTIN_GUIDES,
): EmergencyScenario[] {
  const byId = new Map(team.map((s) => [s.id, s]));
  const builtInIds = new Set(builtIn.map((s) => s.id));
  const extras = team.filter((s) => !builtInIds.has(s.id));
  return [...extras, ...builtIn.map((s) => byId.get(s.id) ?? s)];
}

export function findBuiltInGuide(id: string): EmergencyScenario | null {
  return BUILTIN_GUIDES.find((s) => s.id === id) ?? null;
}
