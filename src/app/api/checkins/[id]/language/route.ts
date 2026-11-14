import { z } from "zod";
import type { Lang } from "@/lib/types";
import { getQuestion } from "@/lib/kpi/registry";
import { cursorQuestion } from "@/server/agent/machine";
import { greeting, readBack } from "@/server/agent/templates";
import { loadMachineCtx, loadTodayValues } from "@/server/checkin/service";
import { getCheckIn, setCheckInLanguage } from "@/server/db/repos/checkin";
import { getCrewPublic } from "@/server/db/repos/crew";
import { appendTurn } from "@/server/db/repos/turn";
import { handle, HttpError, ok } from "@/server/http";
import { requireCrewSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY = z.object({ language: z.enum(["mn", "en"]) }).strict();

const SWITCHED: Record<Lang, string> = {
  en: "Okay, let's continue in English.",
  mn: "За, монголоор үргэлжлүүлье.",
};

export interface LanguageResponse {
  language: Lang;
  /** what Cosmo says in the new language (stored as a Cosmo turn, voiced through the turn audio route); null = no change */
  turn: { turnId: string; text: string } | null;
}

/**
 * POST /api/checkins/:id/language { language } - the crew member switched EN/MN on the check-in screen: the
 * conversation follows. Cosmo's next replies and the speech-recognition hint use the new language, and Cosmo says where
 * the check-in stands in it (the open question again, the read-back, or a greeting). Crew role, own check-in only.
 */
export function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { crewId } = await requireCrewSession();
    const { id } = await context.params;
    const parsed = BODY.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "BAD_INPUT", 'Expected { "language": "mn" | "en" }');
    const lang = parsed.data.language;

    const before = await getCheckIn(crewId, id); // 404 for another crew member's check-in
    if (before.language === lang) {
      const body: LanguageResponse = { language: lang, turn: null };
      return ok(body);
    }
    const checkIn = await setCheckInLanguage(crewId, id, lang);
    const ctx = await loadMachineCtx(checkIn);

    let text: string;
    switch (ctx.state) {
      case "GREETING":
      case "SMALL_TALK":
        text = greeting(await getCrewPublic(crewId), lang);
        break;
      case "KPI_CAPTURE": {
        const q = cursorQuestion(ctx);
        text = q ? `${SWITCHED[lang]} ${getQuestion(q).prompts[lang]}` : SWITCHED[lang];
        break;
      }
      case "CONFIRM":
        text = `${SWITCHED[lang]} ${readBack((await loadTodayValues(crewId, id)).values, lang)}`;
        break;
      default:
        text = SWITCHED[lang];
    }
    const turn = await appendTurn(crewId, id, { speaker: "cosmo", text, language: lang, createdAt: new Date().toISOString() });
    const body: LanguageResponse = { language: lang, turn: { turnId: turn.id, text } };
    return ok(body);
  });
}
