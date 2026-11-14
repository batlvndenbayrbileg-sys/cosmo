import type { Lang } from "@/lib/types";
import { normalizeLanguageCode } from "@/lib/language";
import { buildResultsFacts } from "@/server/agent/resultsFacts";
import { buildTour, type TourFocus } from "@/server/agent/tour";
import { loadHistory, loadTodayValues } from "@/server/checkin/service";
import { getCheckIn } from "@/server/db/repos/checkin";
import { appendTurn } from "@/server/db/repos/turn";
import { handle, HttpError, ok } from "@/server/http";
import { requireCrewSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface TourResponse {
  language: Lang;
  steps: Array<{ focus: TourFocus; turnId: string; text: string }>;
}

/**
 * POST /api/checkins/:id/tour?lang=mn|en - Cosmo's spoken walkthrough of today's dashboard (crew role, own confirmed
 * check-in only). Each step is stored as a Cosmo turn so the client can voice it through
 * GET /api/checkins/:id/turns/:turnId/audio, and carries the dashboard section to highlight.
 */
export function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { crewId } = await requireCrewSession();
    const { id } = await context.params;
    const checkIn = await getCheckIn(crewId, id); // 404 for another crew member's check-in
    if (checkIn.confirmedAt === null) throw new HttpError(409, "WRONG_STATE", "The check-in is not confirmed yet");

    const url = new URL(request.url);
    const lang: Lang = normalizeLanguageCode(url.searchParams.get("lang")) ?? checkIn.language;
    const today = await loadTodayValues(crewId, id);
    const history = await loadHistory(crewId, checkIn.localDate);
    const facts = buildResultsFacts(today.values, history, lang);
    // sequential so the stored Cosmo turns keep the tour's order
    const steps: TourResponse["steps"] = [];
    for (const step of buildTour(facts, lang)) {
      const turn = await appendTurn(crewId, id, {
        speaker: "cosmo",
        text: step.text,
        language: lang,
        createdAt: new Date().toISOString(),
      });
      steps.push({ focus: step.focus, turnId: turn.id, text: step.text });
    }
    const body: TourResponse = { language: lang, steps };
    return ok(body);
  });
}
