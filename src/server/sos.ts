import "server-only";
import type { Lang, TurnEvent } from "@/lib/types";
import { matchSosRequest, sosSpoken, type SosRaiseResult, type SosReason } from "@/lib/sos";
import { now } from "@/server/clock";
import { raiseCrisisAlert } from "@/server/alerts";
import { getCheckIn } from "@/server/db/repos/checkin";
import { getCrewPublic } from "@/server/db/repos/crew";
import { raiseSosAlert } from "@/server/db/repos/sos";
import { appendTurn } from "@/server/db/repos/turn";
import { crisisReply, detectCrisis } from "@/server/agent/companion";
import type { MachineCtx } from "@/server/agent/machine";
import { saveMachineCtx } from "@/server/checkin/service";

/**
 * SOS to Earth (docs: src/lib/sos). Raised only by the crew member: POST /api/sos (the SOS button) or the words of a
 * conversation turn (sosTurn, called once from runTurn before anything else, so it works in small talk, mid check-in
 * and friend mode alike). Cosmo's confirmation is code text, said only after the alert is stored; when storing fails,
 * Cosmo says so and points to the station's own comms. The camera still is attached afterwards by the browser
 * (POST /api/sos/[id]/photo).
 */

async function ownCheckIn(crewId: string, checkInId: string | null | undefined) {
  if (!checkInId) return null;
  try {
    return await getCheckIn(crewId, checkInId);
  } catch {
    return null; // another member's or an unknown check-in: the SOS goes out anyway, just not tied to it
  }
}

/** POST /api/sos: the alert, plus Cosmo's line stored as a turn of the check-in when there is one (it gets a voice) */
export async function raiseSosFromButton(
  crewId: string,
  input: { checkInId?: string | null; language?: Lang | null; reason?: SosReason },
): Promise<SosRaiseResult> {
  const checkIn = await ownCheckIn(crewId, input.checkInId);
  const { alert, duplicate } = await raiseSosAlert(crewId, {
    reason: input.reason ?? "button",
    checkInId: checkIn?.id ?? null,
  });
  const language: Lang =
    checkIn?.language ?? input.language ?? (await getCrewPublic(crewId).then((c) => c.preferredLanguage, () => "en" as Lang));
  const text = sosSpoken(duplicate ? "duplicate" : "sent", language);
  let turnId: string | null = null;
  if (checkIn) {
    try {
      turnId = (await appendTurn(crewId, checkIn.id, { speaker: "cosmo", text, language, createdAt: now() })).id;
    } catch (err) {
      console.error("[aegis] SOS: storing Cosmo's line failed (the alert itself is stored):", err);
    }
  }
  return { alert, duplicate, spoken: { text, language, turnId } };
}

/**
 * One conversation turn that asks to alert Earth, or null when the words do not (the turn goes on as usual). The
 * events are `sos` (whether the alert is stored, for the browser's photo and status card) and Cosmo's `assistant`
 * line; the caller adds timing and done. The check-in's state is not touched: the next turn continues where it was.
 * Crisis words in the same utterance also raise the crisis alert and add the crisis reply.
 */
export async function sosTurn(p: {
  crewId: string;
  checkInId: string;
  text: string;
  lang: Lang;
  /** friend mode is on (medical-emergency words count as crisis words, as in companion.ts) */
  talking: boolean;
  /** where the check-in stands; with crisis words it is switched to the crisis-aware talk, like the CRISIS event */
  ctx?: MachineCtx;
}): Promise<TurnEvent[] | null> {
  const hit = matchSosRequest(p.text);
  if (!hit) return null;

  let event: Extract<TurnEvent, { type: "sos" }>;
  try {
    const { alert, duplicate } = await raiseSosAlert(p.crewId, { reason: "voice", phrase: hit.phrase, checkInId: p.checkInId });
    event = { type: "sos", ok: true, alertId: alert.id, createdAt: alert.createdAt, duplicate, photoStatus: alert.photoStatus };
  } catch (err) {
    console.error("[aegis] SOS alert could not be stored:", err);
    event = { type: "sos", ok: false, alertId: null, createdAt: null, duplicate: false, photoStatus: null };
  }

  let spoken = sosSpoken(!event.ok ? "failed" : event.duplicate ? "duplicate" : "sent", p.lang);
  const crisis = detectCrisis(p.text, p.talking);
  if (crisis) {
    spoken = `${spoken} ${crisisReply(p.lang, crisis)}`;
    try {
      await raiseCrisisAlert(p.crewId, p.checkInId, crisis);
    } catch (err) {
      console.error("[aegis] crisis alert next to the SOS failed:", err);
    }
    // as the CRISIS transition does (machine.ts): Cosmo stays in a crisis-aware talk for the next turns
    const c = p.ctx;
    if (c && c.state !== "SUMMARY" && c.state !== "DONE") {
      try {
        await saveMachineCtx(p.crewId, p.checkInId, { ...c, companion: true, companionTurns: c.companionTurns + 1, companionCrisis: true });
      } catch (err) {
        console.error("[aegis] marking the crisis next to the SOS failed:", err);
      }
    }
  }

  const cosmoTurn = await appendTurn(p.crewId, p.checkInId, { speaker: "cosmo", text: spoken, language: p.lang, createdAt: now() });
  return [event, { type: "assistant", turnId: cosmoTurn.id, text: spoken, language: p.lang, emotion: "concerned" }];
}
