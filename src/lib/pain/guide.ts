import { BUILTIN_CALL_FOR_HELP, BUILTIN_GUIDES, matchEmergency } from "../emergency";
import type { PainLocation, PainRedFlag } from "./types";

/**
 * The emergency guide (src/lib/emergency) that goes with a pain: chest pain opens the chest pain guide; otherwise the
 * guides' own trigger words in the clause that said it hurts ("I hit my head and it hurts" -> head injury, so a
 * denied clause elsewhere in the utterance never opens a guide); fainting words open the fainting guide; any other
 * urgent pain opens "get help now". Non-urgent pain without trigger words has no guide.
 */
export function painGuide(p: { location: PainLocation | null; clause: string; redFlags: readonly PainRedFlag[]; urgent: boolean }): string | null {
  if (p.location === "chest") return "chest-pain";
  const hit = p.clause ? matchEmergency(p.clause, BUILTIN_GUIDES) : null;
  if (hit) return hit.scenarioId;
  if (p.redFlags.includes("fainting")) return "fainting";
  return p.urgent ? BUILTIN_CALL_FOR_HELP.id : null;
}
