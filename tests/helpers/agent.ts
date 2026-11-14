import type { ConversationState, KpiKey, TurnEvent } from "@/lib/types";
import type { Agent } from "@/server/agent/agent";
import { parseCtx, type MachineCtx } from "@/server/agent/machine";
import { runTurn } from "@/server/agent/turn";
import type { ToolContext } from "@/server/agent/tools";
import { createOrResumeCheckIn } from "@/server/checkin/service";
import { getCheckIn } from "@/server/db/repos/checkin";
import { loadMachineCtx } from "@/server/checkin/service";

/** drains a turn into an array */
export async function collect(gen: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

export async function playTurn(
  crewId: string,
  checkInId: string,
  text: string,
  extra: { agent?: Agent; fallback?: Agent; kind?: "typed" | "voice"; languageHint?: string } = {},
): Promise<TurnEvent[]> {
  return collect(
    runTurn({
      crewId,
      checkInId,
      input: { kind: extra.kind ?? "typed", text, languageHint: extra.languageHint },
      agent: extra.agent,
      fallback: extra.fallback,
    }),
  );
}

export function eventsOf<T extends TurnEvent["type"]>(events: TurnEvent[], type: T): Array<Extract<TurnEvent, { type: T }>> {
  return events.filter((e): e is Extract<TurnEvent, { type: T }> => e.type === type);
}

export function assistantText(events: TurnEvent[]): string {
  return eventsOf(events, "assistant")[0]?.text ?? "";
}

export async function startCheckIn(crewId: string, language?: string): Promise<string> {
  return (await createOrResumeCheckIn(crewId, language)).checkInId;
}

/** the persisted machine context of a check-in (state column + state_json) */
export async function ctxOf(crewId: string, checkInId: string): Promise<MachineCtx> {
  return loadMachineCtx(await getCheckIn(crewId, checkInId));
}

/** a context in the given state, for direct tool tests */
export function toolContext(
  crewId: string,
  checkInId: string,
  state: ConversationState,
  utterance: string,
  over: Partial<ToolContext> = {},
): ToolContext {
  return {
    crewId,
    checkInId,
    state,
    lang: "en",
    utterance,
    source: "typed",
    filled: new Set<KpiKey>(),
    ...over,
  };
}

/** SSE text -> events (one "data:" line per event, blank line between) */
export function parseSse(body: string): TurnEvent[] {
  const events: TurnEvent[] = [];
  for (const block of body.split("\n\n")) {
    const line = block.trim();
    if (!line) continue;
    if (!line.startsWith("data: ")) throw new Error(`Not an SSE data line: ${line}`);
    events.push(JSON.parse(line.slice("data: ".length)) as TurnEvent);
  }
  return events;
}

export { parseCtx };
