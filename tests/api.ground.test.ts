import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name) as string } : undefined),
    set: (opts: { name: string; value: string }) => void mocks.jar.set(opts.name, opts.value),
    delete: (name: string) => void mocks.jar.delete(name),
  }),
}));

import { POST as ackAlertRoute } from "@/app/api/alerts/[id]/ack/route";
import { GET as getDashboard } from "@/app/api/dashboard/route";
import { GET as getGroundAlerts } from "@/app/api/ground/alerts/route";
import { GET as getGroundCrew } from "@/app/api/ground/crew/route";
import { GET as getGroundDashboard } from "@/app/api/ground/crew/[crewId]/dashboard/route";
import type { AlertRow, ApiError, CrewStatusCard, DashboardPayload } from "@/lib/types";
import { KPI_KEYS } from "@/lib/types";
import { setClockForTests } from "@/server/clock";
import { latestConfirmedCheckIn } from "@/server/db/repos/checkin";
import { listAlerts } from "@/server/db/repos/alert";
import { GROUND_COOKIE, setGroundCookie } from "@/server/dashboard/roles";
import { setSessionCookie } from "@/server/session";
import { addAlert, addConfirmedCheckIn } from "./helpers/dashboard";
import { getDb } from "@/server/db/client";
import { freshSeededDb, insertCrew, TEST_TODAY } from "./helpers/db";
import { batDemoToday } from "./helpers/health";

const MIN = 60_000;
const NOW = TEST_TODAY;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const LIVE = 0;
const THREE = 180_000;
const TWENTY = 1_200_000;

const signInCrew = (crewId: string) => setSessionCookie({ role: "crew", crewId });
const signInGround = () => setGroundCookie();

const url = (p: string) => `http://localhost${p}`;
const groundDash = (crewId: string, qs = "") =>
  getGroundDashboard(new Request(url(`/api/ground/crew/${crewId}/dashboard${qs}`)), {
    params: Promise.resolve({ crewId }),
  });
const ack = (id: string) =>
  ackAlertRoute(new Request(url(`/api/alerts/${id}/ack`), { method: "POST" }), { params: Promise.resolve({ id }) });

/** Every ground endpoint, as a thunk with an optional query string */
const GROUND_ENDPOINTS: Array<[string, (qs?: string) => Promise<Response>]> = [
  ["GET /api/ground/crew", (qs = "") => getGroundCrew(new Request(url(`/api/ground/crew${qs}`)))],
  ["GET /api/ground/alerts", (qs = "") => getGroundAlerts(new Request(url(`/api/ground/alerts${qs}`)))],
  ["GET /api/ground/crew/bat/dashboard", (qs = "") => groundDash("bat", qs)],
];

beforeEach(async () => {
  await freshSeededDb();
  mocks.jar.clear();
  setClockForTests(NOW);
});
afterEach(() => {
  setClockForTests(null);
});

async function errorOf(res: Response): Promise<ApiError["error"]> {
  return ((await res.json()) as ApiError).error;
}

describe("role separation", () => {
  it.each(GROUND_ENDPOINTS)("%s: 401 NO_SESSION without a cookie", async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("NO_SESSION");
  });

  it.each(GROUND_ENDPOINTS)("%s: 403 FORBIDDEN for a crew cookie", async (_name, call) => {
    await signInCrew("bat");
    const res = await call();
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("FORBIDDEN");
  });

  it.each(GROUND_ENDPOINTS)("%s: 200 for a ground cookie", async (_name, call) => {
    await signInGround();
    expect((await call()).status).toBe(200);
  });

  it("a ground cookie gets 403 on /api/dashboard and on the alert acknowledge route", async () => {
    await signInGround();
    const dash = await getDashboard(new Request(url("/api/dashboard")));
    expect(dash.status).toBe(403);
    expect((await errorOf(dash)).code).toBe("FORBIDDEN");
    const miraAlert = (await listAlerts("mira"))[0];
    const res = await ack(miraAlert.id);
    expect(res.status).toBe(403);
    expect((await listAlerts("mira"))[0].acknowledgedAt).toBeNull();
  });

  it("no cookie gets 401 on /api/dashboard and on the alert acknowledge route", async () => {
    expect((await getDashboard(new Request(url("/api/dashboard")))).status).toBe(401);
    expect((await ack("whatever")).status).toBe(401);
  });

  it("a forged ground cookie (tampered signature) is no session at all: 401", async () => {
    await signInCrew("bat");
    const token = mocks.jar.get("cosmo_session") as string;
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ p: { role: "ground" }, exp: Date.now() + 1e8 })).toString("base64url");
    mocks.jar.set("cosmo_session", `${forged}.${sig}`);
    expect(body).not.toBe(forged);
    const res = await getGroundCrew(new Request(url("/api/ground/crew")));
    expect(res.status).toBe(401);
    // the same forgery in the ground cookie
    mocks.jar.clear();
    await signInGround();
    const [, gsig] = (mocks.jar.get(GROUND_COOKIE) as string).split(".");
    mocks.jar.set(GROUND_COOKIE, `${forged}.${gsig}`);
    expect((await getGroundCrew(new Request(url("/api/ground/crew")))).status).toBe(401);
  });

  it("opening the Earth console does not log the crew member out (separate cookies, regression)", async () => {
    await signInCrew("bat");
    const session = await import("@/app/api/session/route");
    const res = await session.POST(
      new Request(url("/api/session"), { method: "POST", body: JSON.stringify({ role: "ground" }) }),
    );
    expect(res.status).toBe(204);
    // the crew side still works ...
    const dash = await getDashboard(new Request(url("/api/dashboard")));
    expect(dash.status).toBe(200);
    expect(((await dash.json()) as DashboardPayload).crew.id).toBe("bat");
    // ... and so does the Earth side
    expect((await getGroundCrew(new Request(url("/api/ground/crew")))).status).toBe(200);
    // a crew member who signs in afterwards does not end the Earth session either
    await signInCrew("mira");
    expect((await getGroundCrew(new Request(url("/api/ground/crew")))).status).toBe(200);
    expect(((await (await getDashboard(new Request(url("/api/dashboard")))).json()) as DashboardPayload).crew.id).toBe("mira");
  });

  it("with both cookies present, acknowledging acts as the crew member and the ground routes keep working", async () => {
    await signInCrew("mira");
    await signInGround();
    expect((await ack((await listAlerts("mira"))[0].id)).status).toBe(200);
    expect((await getGroundAlerts(new Request(url("/api/ground/alerts")))).status).toBe(200);
  });
});

describe("delayMs validation", () => {
  beforeEach(async () => {
    await signInGround();
  });

  it.each(GROUND_ENDPOINTS)("%s: rejects anything but 0, 180000, 1200000 with 400 BAD_INPUT", async (_name, call) => {
    for (const bad of ["5", "-1", "abc", "1.5", "180001", "1200000.0", "0x10", "3", "60000", "NaN", "1e3", " 0", "00"]) {
      const res = await call(`?delayMs=${encodeURIComponent(bad)}`);
      expect(res.status, `delayMs=${bad}`).toBe(400);
      expect((await errorOf(res)).code).toBe("BAD_INPUT");
    }
  });

  it.each(GROUND_ENDPOINTS)("%s: accepts 0, 180000 and 1200000, and no parameter at all", async (_name, call) => {
    for (const good of [`?delayMs=${LIVE}`, `?delayMs=${THREE}`, `?delayMs=${TWENTY}`, ""]) {
      expect((await call(good)).status, good).toBe(200);
    }
  });
});

describe("GET /api/ground/crew", () => {
  beforeEach(async () => {
    await signInGround();
  });

  it("returns one status card per crew member, shaped as CrewStatusCard, with 16 stars and no extra data", async () => {
    const res = await getGroundCrew(new Request(url("/api/ground/crew")));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const cards = (await res.json()) as CrewStatusCard[];
    expect(cards.map((c) => c.crew.id)).toEqual(["bat", "saraa", "alex", "mira"]);
    for (const c of cards) {
      expect(Object.keys(c).sort()).toEqual(["crew", "lastCheckInAt", "openAlerts", "overall", "readiness", "stars"]);
      expect(c.stars.map((s) => s.key)).toEqual([...KPI_KEYS]);
      expect(c.lastCheckInAt).not.toBeNull();
      expect(typeof c.readiness).toBe("number");
    }
    const byId = Object.fromEntries(cards.map((c) => [c.crew.id, c]));
    expect(byId.bat.overall).toBe("green");
    expect(byId.saraa.overall).toBe("green");
    expect(byId.alex.overall).toBe("yellow");
    expect(byId.mira.overall).toBe("red");
    expect(byId.mira.openAlerts).toBe(1);
    expect(byId.bat.openAlerts).toBe(0);
    const starStatus = (id: string, key: string) => byId[id].stars.find((s) => s.key === key)!.status;
    expect(starStatus("mira", "symptom_headache")).toBe("yellow");
    expect(starStatus("mira", "vision_check")).toBe("yellow");
    expect(starStatus("alex", "bp_systolic")).toBe("yellow");
    expect(starStatus("bat", "bp_systolic")).toBe("green");
    expect(starStatus("bat", "day_note")).toBe("no_data");
    expect(byId.bat.lastCheckInAt).toBe((await latestConfirmedCheckIn("bat"))!.confirmedAt);
  });

  it("applies the simulated link delay: a check-in confirmed 5 minutes ago is hidden at 20 min and shown at Live", async () => {
    const fresh = await addConfirmedCheckIn({ crewId: "bat", language: "mn", values: batDemoToday(), confirmedAt: ago(5 * MIN) });
    const freshAt = (await latestConfirmedCheckIn("bat"))!.confirmedAt;
    const bat = async (delayMs: number) => {
      const cards = (await (await getGroundCrew(new Request(url(`/api/ground/crew?delayMs=${delayMs}`)))).json()) as CrewStatusCard[];
      return cards.find((c) => c.crew.id === "bat")!;
    };

    const live = await bat(LIVE);
    expect(live.lastCheckInAt).toBe(freshAt);
    expect(live.overall).toBe("yellow");
    expect((await bat(THREE)).lastCheckInAt).toBe(freshAt); // 5 min old > 3 min delay: already arrived

    const lagged = await bat(TWENTY);
    expect(lagged.lastCheckInAt).not.toBe(freshAt);
    expect(lagged.overall).toBe("green");
    expect(fresh).toBeTruthy();
  });

  it("a check-in confirmed 2 minutes ago is also hidden at the 3 minute delay", async () => {
    await addConfirmedCheckIn({ crewId: "saraa", language: "mn", values: batDemoToday(), confirmedAt: ago(2 * MIN) });
    const at = async (delayMs: number) =>
      ((await (await getGroundCrew(new Request(url(`/api/ground/crew?delayMs=${delayMs}`)))).json()) as CrewStatusCard[]).find(
        (c) => c.crew.id === "saraa",
      )!;
    expect((await at(LIVE)).overall).toBe("yellow");
    expect((await at(THREE)).overall).toBe("green");
  });

  it("shows no_data cards with null readiness while nothing has arrived yet", async () => {
    setClockForTests(new Date(2026, 9, 29, 12)); // before the first seeded check-in (31 Oct)
    const cards = (await (await getGroundCrew(new Request(url("/api/ground/crew")))).json()) as CrewStatusCard[];
    expect(cards).toHaveLength(4);
    for (const c of cards) {
      expect(c.overall).toBe("no_data");
      expect(c.readiness).toBeNull();
      expect(c.lastCheckInAt).toBeNull();
      expect(c.openAlerts).toBe(0);
      expect(c.stars.every((s) => s.status === "no_data")).toBe(true);
    }
  });

  it("openAlerts counts only visible, unacknowledged alerts", async () => {
    const id = await addConfirmedCheckIn({ crewId: "bat", language: "mn", values: batDemoToday(), confirmedAt: ago(2 * MIN) });
    await addAlert("bat", id, ago(2 * MIN));
    const open = async (crew: string, delayMs: number) =>
      ((await (await getGroundCrew(new Request(url(`/api/ground/crew?delayMs=${delayMs}`)))).json()) as CrewStatusCard[]).find(
        (c) => c.crew.id === crew,
      )!.openAlerts;
    expect(await open("bat", LIVE)).toBe(1);
    expect(await open("bat", THREE)).toBe(0);
    // acknowledging Mira's alert closes it on the console
    await signInCrew("mira");
    expect((await ack((await listAlerts("mira"))[0].id)).status).toBe(200);
    await signInGround();
    expect(await open("mira", LIVE)).toBe(0);
  });
});

describe("GET /api/ground/alerts", () => {
  beforeEach(async () => {
    await signInGround();
  });

  it("lists Mira's seeded alert, newest first, and hides alerts whose check-in has not arrived", async () => {
    const id = await addConfirmedCheckIn({ crewId: "bat", language: "mn", values: batDemoToday(), confirmedAt: ago(5 * MIN) });
    await addAlert("bat", id, ago(4 * MIN));

    const live = (await (await getGroundAlerts(new Request(url("/api/ground/alerts")))).json()) as AlertRow[];
    expect(live.map((a) => a.crewId)).toEqual(["bat", "mira"]);
    expect(live[1]).toMatchObject({ rule: "HEADACHE_PLUS_VISION", level: "red", acknowledgedAt: null });

    const lagged = (await (await getGroundAlerts(new Request(url(`/api/ground/alerts?delayMs=${TWENTY}`)))).json()) as AlertRow[];
    expect(lagged.map((a) => a.crewId)).toEqual(["mira"]);

    const three = (await (await getGroundAlerts(new Request(url(`/api/ground/alerts?delayMs=${THREE}`)))).json()) as AlertRow[];
    expect(three.map((a) => a.crewId)).toEqual(["bat", "mira"]);
  });

  it("alert text uses the word alert and never claims a diagnosis", async () => {
    const alerts = (await (await getGroundAlerts(new Request(url("/api/ground/alerts")))).json()) as AlertRow[];
    for (const a of alerts) {
      expect(a.text.en.toLowerCase()).toContain("alert");
      expect(a.text.en.toLowerCase()).not.toMatch(/diagnosed|you have/);
    }
  });
});

describe("GET /api/ground/crew/[crewId]/dashboard", () => {
  beforeEach(async () => {
    await signInGround();
  });

  it("returns the read-only DashboardPayload of the crew member in the path", async () => {
    const res = await groundDash("mira");
    expect(res.status).toBe(200);
    const p = (await res.json()) as DashboardPayload;
    expect(p.crew.id).toBe("mira");
    expect(p.overall).toBe("red");
    expect(p.alerts).toHaveLength(1);
    expect(p.link).toMatchObject({ state: "online", delayMs: 0, simulated: true });
    expect(p.kpis).toHaveLength(21);
  });

  it("carries the delay into the link and the visible check-in", async () => {
    await addConfirmedCheckIn({ crewId: "bat", language: "mn", values: batDemoToday(), confirmedAt: ago(5 * MIN) });
    const live = (await (await groundDash("bat", `?delayMs=${LIVE}`)).json()) as DashboardPayload;
    expect(live.overall).toBe("yellow");
    const lagged = (await (await groundDash("bat", `?delayMs=${TWENTY}`)).json()) as DashboardPayload;
    expect(lagged.overall).toBe("green");
    expect(lagged.link).toMatchObject({ state: "delayed", delayMs: TWENTY, simulated: true });
    expect(lagged.checkIn.id).toBe("ci-bat-2026-11-13");
  });

  it("answers 404 for an unknown crew member and when nothing has arrived yet", async () => {
    const unknown = await groundDash("nobody");
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).code).toBe("NOT_FOUND");
    setClockForTests(new Date(2026, 9, 29, 12));
    expect((await groundDash("bat")).status).toBe(404);
  });

  it("never exposes notes, source text or Claude's phrasing", async () => {
    const note = "PRIVATE-NOTE-for-the-crew-doctor-only-5530";
    await addConfirmedCheckIn({
      crewId: "bat",
      language: "en",
      values: { ...batDemoToday(), day_note: note, symptom_note: note },
      confirmedAt: ago(5 * MIN),
      sourceText: "VERBATIM-SNIPPET-7712",
      spokenText: `Thanks Bat, you wrote: ${note}`,
    });
    const text = await (await groundDash("bat")).text();
    expect(text).not.toContain(note);
    expect(text).not.toContain("VERBATIM-SNIPPET");
    expect(text).not.toContain("you wrote");
    expect(text).not.toContain("sourceText");
  });
});

describe("GET /api/dashboard (crew role)", () => {
  it("returns the signed-in crew member's own latest dashboard, whatever the query says about crew ids", async () => {
    await signInCrew("bat");
    const res = await getDashboard(new Request(url("/api/dashboard?crewId=mira&asOf=2000-01-01")));
    expect(res.status).toBe(200);
    const p = (await res.json()) as DashboardPayload;
    expect(p.crew.id).toBe("bat");
    expect(p.checkIn.id).toBe((await latestConfirmedCheckIn("bat"))!.id);
    expect(p.link.delayMs).toBe(0);
  });

  it("serves a specific own check-in by id and 404s for another member's check-in id", async () => {
    await signInCrew("bat");
    const own = await getDashboard(new Request(url("/api/dashboard?checkInId=ci-bat-2026-11-10")));
    expect(own.status).toBe(200);
    expect(((await own.json()) as DashboardPayload).checkIn.id).toBe("ci-bat-2026-11-10");
    const foreign = await getDashboard(new Request(url(`/api/dashboard?checkInId=${(await latestConfirmedCheckIn("mira"))!.id}`)));
    expect(foreign.status).toBe(404);
    expect((await errorOf(foreign)).code).toBe("NOT_FOUND");
    expect((await getDashboard(new Request(url("/api/dashboard?checkInId=nope")))).status).toBe(404);
  });

  it("answers 404 when the crew member has no confirmed check-in yet and 400 for an empty checkInId", async () => {
    await signInCrew("bat");
    expect((await getDashboard(new Request(url("/api/dashboard?checkInId=")))).status).toBe(400);
    await insertCrew(await getDb(), "newbie");
    await signInCrew("newbie");
    const res = await getDashboard(new Request(url("/api/dashboard")));
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("NOT_FOUND");
  });

  it("gives the crew viewer their notes (the ground viewer never gets them)", async () => {
    const note = "my own note 6644";
    await addConfirmedCheckIn({
      crewId: "bat",
      language: "en",
      values: { ...batDemoToday(), day_note: note },
      confirmedAt: ago(5 * MIN),
    });
    await signInCrew("bat");
    const p = (await (await getDashboard(new Request(url("/api/dashboard")))).json()) as DashboardPayload;
    expect(p.kpis.find((k) => k.key === "day_note")!.value).toBe(note);
  });
});

describe("POST /api/alerts/[id]/ack", () => {
  it("lets a crew member acknowledge their own alert, idempotently, with the clock's time", async () => {
    await signInCrew("mira");
    const id = (await listAlerts("mira"))[0].id;
    const res = await ack(id);
    expect(res.status).toBe(200);
    const row = (await res.json()) as AlertRow;
    expect(row).toMatchObject({ id, crewId: "mira", acknowledgedAt: NOW.toISOString() });
    setClockForTests(new Date(NOW.getTime() + 10 * MIN));
    const again = (await (await ack(id)).json()) as AlertRow;
    expect(again.acknowledgedAt).toBe(NOW.toISOString()); // the first acknowledgement time is kept
  });

  it("answers 404 for another crew member's alert and leaves it unacknowledged", async () => {
    await signInCrew("bat");
    const miras = (await listAlerts("mira"))[0].id;
    const res = await ack(miras);
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("NOT_FOUND");
    expect((await listAlerts("mira"))[0].acknowledgedAt).toBeNull();
    expect((await ack("no-such-alert")).status).toBe(404);
  });
});
