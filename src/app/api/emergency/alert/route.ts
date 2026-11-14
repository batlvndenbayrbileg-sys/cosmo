import { z } from "zod";
import { handle, HttpError, ok } from "@/server/http";
import { requireCrewSession } from "@/server/session";
import { findScenario } from "@/server/emergency/load";
import { insertAlert, listAlerts } from "@/server/db/repos/alert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ scenarioId: z.string().min(1).max(60), checkInId: z.string().min(1).max(80) }).strict();

/**
 * POST /api/emergency/alert - emergency guidance was opened during a check-in: raise a red alert for the crew medical
 * officer and ground (the link to Earth is simulated). Crew role, own check-in only; one alert per check-in and
 * scenario. Worded as an alert, never a diagnosis.
 */
export function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { crewId } = await requireCrewSession();
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "BAD_INPUT", "Expected { scenarioId, checkInId }");
    const scenario = findScenario(parsed.data.scenarioId);
    if (!scenario) throw new HttpError(404, "NOT_FOUND", "Unknown scenario");

    const text = {
      en: `Emergency guidance opened: ${scenario.title.en}. Crew medical officer and ground informed (simulated link).`,
      mn: `Яаралтай тусламжийн заавар нээгдлээ: ${scenario.title.mn}. Багийн эмч болон Дэлхийд мэдэгдлээ (симуляци).`,
    };
    // an alert raised before alerts had a deterministic id is matched by its text
    const existing = (await listAlerts(crewId)).find(
      (a) => a.checkInId === parsed.data.checkInId && a.text.en === text.en,
    );
    // one id per check-in and scenario, inserted only when absent: two requests in flight at once (SOS tapped while
    // the transcript matcher opens the same scenario, a retry) get the same single alert. insertAlert checks that the
    // check-in belongs to this crew member (404 otherwise).
    const alert =
      existing ??
      (await insertAlert(crewId, {
        id: `al-${parsed.data.checkInId}-emergency-${scenario.id}`,
        ifAbsent: true,
        checkInId: parsed.data.checkInId,
        level: "red",
        rule: "SERIOUS_SYMPTOM_WORD",
        text,
      }));
    return ok({ alert });
  });
}
