import { DEMO_SCRIPTS } from "@/server/agent/scripts";
import { handle, HttpError, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The scripted demo check-in (the astronaut side, Bat's demo values) in `?lang=mn|en`. It holds no health data of
 * anyone: the lines are fixed text, replayed by the client through the normal turn endpoint.
 */
export function GET(request: Request): Promise<Response> {
  return handle(() => {
    const lang = new URL(request.url).searchParams.get("lang");
    if (lang !== "mn" && lang !== "en") throw new HttpError(400, "BAD_INPUT", "lang must be mn or en");
    return ok(DEMO_SCRIPTS[lang]);
  });
}
