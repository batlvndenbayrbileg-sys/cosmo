import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import * as alertRepo from "@/server/db/repos/alert";
import * as checkinRepo from "@/server/db/repos/checkin";
import * as crewRepo from "@/server/db/repos/crew";
import * as groundRepo from "@/server/db/repos/ground";
import * as measurementRepo from "@/server/db/repos/measurement";
import * as turnRepo from "@/server/db/repos/turn";
import { localDateISO } from "@/server/db/shared";
import { HttpError, NotFoundError } from "@/server/http";
import { freshEmptyDb, insertCrew } from "./helpers/db";

/* ───────────── fixtures ───────────── */

/** local-time instant on a November 2026 day, as ISO */
const at = (day: number, h = 8, m = 30) => new Date(2026, 10, day, h, m, 0, 0).toISOString();
const dateOf = (day: number) => localDateISO(new Date(2026, 10, day, 8, 30));

const A = "crew-a";
const B = "crew-b";
const SECRET_NOTE = "B-private-note-7731";
const SECRET_TURN = "B-private-turn-9042";
const SPOKEN_QUOTE = "B-quoted-in-summary-5518";

interface World {
  db: Db;
  /** crew A: confirmed on 10 Nov, sleep 7 */
  aCheckIn: string;
  aAlert: string;
  /** crew B: confirmed on 11 Nov, sleep 5.5, secret note, secret turn, red alert */
  bCheckIn: string;
  bAlert: string;
  /** crew B: still open (unconfirmed), started 12 Nov */
  bOpen: string;
}

let w: World;

function build(): World {
  const db = freshEmptyDb();
  insertCrew(db, A, { language: "mn" });
  insertCrew(db, B, { language: "en" });

  const a = checkinRepo.createCheckIn(A, { language: "mn", startedAt: at(10, 8, 24), id: "ci-a" });
  measurementRepo.upsertMeasurement(A, a.id, {
    key: "sleep_hours", value: 7, unit: "h", sourceText: "seven", confidence: 0.9, source: "voice",
  });
  measurementRepo.upsertMeasurement(A, a.id, {
    key: "day_note", value: "A-note", unit: null, sourceText: null, confidence: null, source: "typed",
  });
  turnRepo.appendTurn(A, a.id, { speaker: "crew", text: "A-turn", language: "mn" });
  const aAlert = alertRepo.insertAlert(A, {
    checkInId: a.id, level: "red", rule: "VITAL_RED", text: { en: "A alert", mn: "A сэрэмжлүүлэг" }, createdAt: at(10, 8, 31),
  });
  checkinRepo.confirmCheckIn(A, a.id, { confirmedAt: at(10), summaryJson: JSON.stringify({ overall: "red" }) });

  const b = checkinRepo.createCheckIn(B, { language: "en", startedAt: at(11, 8, 24), id: "ci-b" });
  measurementRepo.upsertMeasurement(B, b.id, {
    key: "sleep_hours", value: 5.5, unit: "h", sourceText: "five and a half", confidence: 0.8, source: "voice",
  });
  measurementRepo.upsertMeasurement(B, b.id, {
    key: "symptom_headache", value: 1, unit: null, sourceText: "yes", confidence: 1, source: "typed",
  });
  measurementRepo.upsertMeasurement(B, b.id, {
    key: "symptom_note", value: SECRET_NOTE, unit: null, sourceText: SECRET_NOTE, confidence: null, source: "typed",
  });
  turnRepo.appendTurn(B, b.id, { speaker: "crew", text: SECRET_TURN, language: "en" });
  const bAlert = alertRepo.insertAlert(B, {
    checkInId: b.id, level: "red", rule: "HEADACHE_PLUS_VISION", text: { en: "B alert", mn: "B сэрэмжлүүлэг" }, createdAt: at(11, 8, 31),
  });
  checkinRepo.confirmCheckIn(B, b.id, {
    confirmedAt: at(11),
    summaryJson: JSON.stringify({
      overall: "red",
      findings: [
        { key: "symptom_note", value: SECRET_NOTE, status: "red" },
        { key: "sleep_hours", value: 5.5, status: "yellow" },
      ],
      spoken: { language: "en", text: SPOKEN_QUOTE },
    }),
  });

  const open = checkinRepo.createCheckIn(B, { language: "en", startedAt: at(12, 8, 0), id: "ci-b-open" });
  measurementRepo.upsertMeasurement(B, open.id, {
    key: "mood", value: 2, unit: null, sourceText: null, confidence: null, source: "typed",
  });
  turnRepo.appendTurn(B, open.id, { speaker: "cosmo", text: "B-open-turn", language: "en" });

  return { db, aCheckIn: a.id, aAlert: aAlert.id, bCheckIn: b.id, bAlert: bAlert.id, bOpen: open.id };
}

beforeEach(() => {
  w = build();
});

const notFound = (fn: () => unknown) => expect(fn).toThrow(NotFoundError);

/* ───────────── registry: every crew-scoped repo function and its isolation case ───────────── */

/**
 * Explicit registry of every function exported by db/repos/*.ts except ground.ts. The sweep test
 * below cross-checks it against the real module exports, so a new repo function cannot be added
 * without being listed here (and therefore without a case in `cases`).
 */
const REGISTRY: Record<string, readonly string[]> = {
  crew: ["listCrewPublic", "getCrewPublic"],
  checkin: [
    "createCheckIn", "getCheckIn", "getOpenCheckInForDate", "setCheckInState", "confirmCheckIn",
    "latestConfirmedCheckIn", "listHistoryDays",
  ],
  measurement: ["upsertMeasurement", "listMeasurements"],
  turn: ["appendTurn", "listTurns"],
  alert: ["insertAlert", "listAlerts", "ackAlert"],
};
const MODULES: Record<string, Record<string, unknown>> = {
  crew: crewRepo, checkin: checkinRepo, measurement: measurementRepo, turn: turnRepo, alert: alertRepo,
};
/** roster-only functions: no health data, hence no crewId parameter */
const ROSTER_ONLY = new Set(["crew.listCrewPublic"]);

const cases: Record<string, () => void> = {
  /* crew */
  "crew.listCrewPublic": () => {
    const roster = crewRepo.listCrewPublic();
    expect(roster.map((c) => c.id)).toEqual([A, B]);
    // roster fields only
    expect(Object.keys(roster[0]).sort()).toEqual(
      ["avatarSeed", "id", "mascotVariant", "name", "preferredLanguage", "role"],
    );
  },
  "crew.getCrewPublic": () => {
    expect(crewRepo.getCrewPublic(A).id).toBe(A);
    expect(crewRepo.getCrewPublic(B).id).toBe(B);
    notFound(() => crewRepo.getCrewPublic("nobody"));
  },

  /* checkin */
  "checkin.createCheckIn": () => {
    notFound(() => checkinRepo.createCheckIn("nobody", { language: "en" }));
    const mine = checkinRepo.createCheckIn(A, { language: "en", startedAt: at(13) });
    expect(mine.crewId).toBe(A);
    // cannot hijack B's check-in id: the primary key is taken, nothing of B's changes
    expect(() => checkinRepo.createCheckIn(A, { language: "en", id: w.bCheckIn })).toThrow();
    expect(checkinRepo.getCheckIn(B, w.bCheckIn).crewId).toBe(B);
  },
  "checkin.getCheckIn": () => {
    expect(checkinRepo.getCheckIn(A, w.aCheckIn).id).toBe(w.aCheckIn);
    notFound(() => checkinRepo.getCheckIn(A, w.bCheckIn));
    notFound(() => checkinRepo.getCheckIn(B, w.aCheckIn));
    notFound(() => checkinRepo.getCheckIn(A, "does-not-exist"));
  },
  "checkin.getOpenCheckInForDate": () => {
    expect(checkinRepo.getOpenCheckInForDate(B, dateOf(12))?.id).toBe(w.bOpen);
    // A has no open check-in that day, and must never be handed B's
    expect(checkinRepo.getOpenCheckInForDate(A, dateOf(12))).toBeNull();
    expect(checkinRepo.getOpenCheckInForDate(B, dateOf(11))).toBeNull(); // confirmed: not open
  },
  "checkin.setCheckInState": () => {
    notFound(() => checkinRepo.setCheckInState(A, w.bCheckIn, "DONE", "{}"));
    notFound(() => checkinRepo.setCheckInState(A, w.bOpen, "CONFIRM"));
    expect(checkinRepo.getCheckIn(B, w.bOpen).state).toBe("GREETING");
    // the owner can
    expect(checkinRepo.setCheckInState(B, w.bOpen, "KPI_CAPTURE", '{"x":1}')).toMatchObject({
      state: "KPI_CAPTURE", stateJson: '{"x":1}',
    });
    // state_json is kept when omitted
    expect(checkinRepo.setCheckInState(B, w.bOpen, "CONFIRM").stateJson).toBe('{"x":1}');
  },
  "checkin.confirmCheckIn": () => {
    notFound(() => checkinRepo.confirmCheckIn(A, w.bOpen, { confirmedAt: at(13), summaryJson: "{}" }));
    expect(checkinRepo.getCheckIn(B, w.bOpen).confirmedAt).toBeNull();
    // the owner can, exactly once
    const done = checkinRepo.confirmCheckIn(B, w.bOpen, { confirmedAt: at(13), summaryJson: null });
    expect(done.confirmedAt).toBe(at(13));
    expect(() => checkinRepo.confirmCheckIn(B, w.bOpen, { confirmedAt: at(14), summaryJson: null })).toThrow(
      expect.objectContaining({ status: 409, code: "WRONG_STATE" }),
    );
  },
  "checkin.latestConfirmedCheckIn": () => {
    expect(checkinRepo.latestConfirmedCheckIn(A)?.id).toBe(w.aCheckIn);
    expect(checkinRepo.latestConfirmedCheckIn(B)?.id).toBe(w.bCheckIn);
    insertCrew(w.db, "crew-c");
    expect(checkinRepo.latestConfirmedCheckIn("crew-c")).toBeNull();
  },
  "checkin.listHistoryDays": () => {
    const a = checkinRepo.listHistoryDays(A, { before: dateOf(20), days: 14 });
    const b = checkinRepo.listHistoryDays(B, { before: dateOf(20), days: 14 });
    expect(a).toEqual([{ date: dateOf(10), values: { sleep_hours: 7, day_note: "A-note" } }]);
    expect(b).toEqual([
      { date: dateOf(11), values: { sleep_hours: 5.5, symptom_headache: 1, symptom_note: SECRET_NOTE } },
    ]);
    expect(JSON.stringify(a)).not.toContain("B-");
    expect(JSON.stringify(b)).not.toContain("A-note");
    expect(checkinRepo.listHistoryDays("crew-nobody", { before: dateOf(20), days: 14 })).toEqual([]);
  },

  /* measurement */
  "measurement.upsertMeasurement": () => {
    const attempt = () =>
      measurementRepo.upsertMeasurement(A, w.bCheckIn, {
        key: "sleep_hours", value: 1, unit: "h", sourceText: "hijack", confidence: 1, source: "typed",
      });
    notFound(attempt);
    notFound(() =>
      measurementRepo.upsertMeasurement(A, w.bOpen, {
        key: "mood", value: 5, unit: null, sourceText: null, confidence: null, source: "typed",
      }),
    );
    // B's data is untouched
    expect(measurementRepo.listMeasurements(B, w.bCheckIn).find((m) => m.key === "sleep_hours")?.value).toBe(5.5);
    expect(measurementRepo.listMeasurements(B, w.bOpen).find((m) => m.key === "mood")?.value).toBe(2);
    // owner can correct an open check-in: the row is updated, not duplicated
    measurementRepo.upsertMeasurement(B, w.bOpen, {
      key: "mood", value: 4, unit: null, sourceText: "four", confidence: 1, source: "typed",
    });
    expect(measurementRepo.listMeasurements(B, w.bOpen).filter((m) => m.key === "mood")).toHaveLength(1);
    expect(measurementRepo.listMeasurements(B, w.bOpen).find((m) => m.key === "mood")?.value).toBe(4);
    // confirmed check-ins are immutable
    expect(() =>
      measurementRepo.upsertMeasurement(B, w.bCheckIn, {
        key: "sleep_hours", value: 9, unit: "h", sourceText: null, confidence: null, source: "typed",
      }),
    ).toThrow(expect.objectContaining({ status: 409, code: "WRONG_STATE" }));
  },
  "measurement.listMeasurements": () => {
    notFound(() => measurementRepo.listMeasurements(A, w.bCheckIn));
    notFound(() => measurementRepo.listMeasurements(B, w.aCheckIn));
    const a = measurementRepo.listMeasurements(A, w.aCheckIn);
    expect(a.map((m) => m.key).sort()).toEqual(["day_note", "sleep_hours"]);
    expect(JSON.stringify(a)).not.toContain("B-");
  },

  /* turn */
  "turn.appendTurn": () => {
    notFound(() => turnRepo.appendTurn(A, w.bCheckIn, { speaker: "crew", text: "inject", language: "en" }));
    expect(turnRepo.listTurns(B, w.bCheckIn).map((t) => t.text)).toEqual([SECRET_TURN]);
    turnRepo.appendTurn(B, w.bCheckIn, { speaker: "cosmo", text: "after confirm", language: "en" });
    expect(turnRepo.listTurns(B, w.bCheckIn)).toHaveLength(2);
  },
  "turn.listTurns": () => {
    notFound(() => turnRepo.listTurns(A, w.bCheckIn));
    notFound(() => turnRepo.listTurns(A, w.bOpen, { limit: 5 }));
    expect(turnRepo.listTurns(A, w.aCheckIn).map((t) => t.text)).toEqual(["A-turn"]);
    // limit returns the most recent turns, oldest first
    for (const t of ["t1", "t2", "t3"]) turnRepo.appendTurn(B, w.bOpen, { speaker: "crew", text: t, language: "en" });
    expect(turnRepo.listTurns(B, w.bOpen, { limit: 2 }).map((t) => t.text)).toEqual(["t2", "t3"]);
    expect(turnRepo.listTurns(B, w.bOpen).map((t) => t.text)).toEqual(["B-open-turn", "t1", "t2", "t3"]);
  },

  /* alert */
  "alert.insertAlert": () => {
    notFound(() =>
      alertRepo.insertAlert(A, { checkInId: w.bCheckIn, level: "red", rule: "OVERALL", text: { en: "x", mn: "x" } }),
    );
    expect(alertRepo.listAlerts(B)).toHaveLength(1);
    const mine = alertRepo.insertAlert(A, {
      checkInId: w.aCheckIn, level: "yellow", rule: "OVERALL", text: { en: "mine", mn: "минийх" },
    });
    expect(mine.crewId).toBe(A);
    expect(mine.text).toEqual({ en: "mine", mn: "минийх" });
  },
  "alert.listAlerts": () => {
    const a = alertRepo.listAlerts(A);
    const b = alertRepo.listAlerts(B);
    expect(a.map((x) => x.id)).toEqual([w.aAlert]);
    expect(b.map((x) => x.id)).toEqual([w.bAlert]);
    expect(a.every((x) => x.crewId === A)).toBe(true);
    expect(b.every((x) => x.crewId === B)).toBe(true);
  },
  "alert.ackAlert": () => {
    notFound(() => alertRepo.ackAlert(A, w.bAlert));
    notFound(() => alertRepo.ackAlert(B, w.aAlert));
    expect(alertRepo.listAlerts(B)[0].acknowledgedAt).toBeNull();
    expect(alertRepo.listAlerts(A)[0].acknowledgedAt).toBeNull();
    const acked = alertRepo.ackAlert(B, w.bAlert, at(12, 9, 0));
    expect(acked.acknowledgedAt).toBe(at(12, 9, 0));
    // idempotent: the first acknowledgement time is kept
    expect(alertRepo.ackAlert(B, w.bAlert, at(13, 9, 0)).acknowledgedAt).toBe(at(12, 9, 0));
    expect(alertRepo.listAlerts(A)[0].acknowledgedAt).toBeNull();
  },
};

/* ───────────── tests ───────────── */

describe("repo contract sweep", () => {
  it("every exported repo function is registered, and every registered function exists", () => {
    for (const [mod, exports] of Object.entries(MODULES)) {
      const actual = Object.entries(exports)
        .filter(([, v]) => typeof v === "function")
        .map(([k]) => k)
        .sort();
      expect(actual, `exports of repos/${mod}.ts`).toEqual([...REGISTRY[mod]].sort());
    }
  });

  it("the first parameter of every repo function is named crewId (roster-only functions excepted)", () => {
    for (const [mod, exports] of Object.entries(MODULES)) {
      for (const name of REGISTRY[mod]) {
        const fn = exports[name] as (...a: unknown[]) => unknown;
        const first = /^[^(]*\(\s*([A-Za-z_$][\w$]*)/.exec(fn.toString())?.[1];
        if (ROSTER_ONLY.has(`${mod}.${name}`)) {
          expect(fn.length, `${mod}.${name} is roster-only and takes no arguments`).toBe(0);
        } else {
          expect(first, `${mod}.${name} first parameter`).toBe("crewId");
          expect(fn.length, `${mod}.${name}`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("only ground.ts reads across crew members: every ground export is named ground* (plus the redaction helper) and none touches turns", () => {
    const names = Object.entries(groundRepo).filter(([, v]) => typeof v === "function").map(([k]) => k);
    for (const n of names) expect(n === "redactSummaryJson" || n.startsWith("ground"), n).toBe(true);
    expect(names.some((n) => /turn/i.test(n))).toBe(false);
    for (const [name, fn] of Object.entries(groundRepo)) {
      if (!name.startsWith("ground") || typeof fn !== "function") continue;
      // every ground read that can expose data takes asOf (roster reads excepted)
      if (name === "groundListCrew" || name === "groundGetCrew") continue;
      expect(fn.toString(), name).toMatch(/asOf/);
    }
  });

  it("has an isolation case for every registered function, and no stray cases", () => {
    const registered = Object.entries(REGISTRY).flatMap(([m, fns]) => fns.map((f) => `${m}.${f}`)).sort();
    expect(Object.keys(cases).sort()).toEqual(registered);
  });
});

describe("crew isolation: crew A can never read or modify crew B's data", () => {
  for (const name of Object.keys(cases)) {
    it(name, () => cases[name]());
  }
});

describe("database-level guarantee (composite foreign keys)", () => {
  it("refuses a measurement whose crew_id differs from its check-in's crew_id", () => {
    expect(() =>
      w.db
        .prepare(
          "INSERT INTO measurement (id, check_in_id, crew_id, key, value, source, created_at) VALUES ('x', ?, ?, 'mood', 3, 'typed', ?)",
        )
        .run(w.bCheckIn, A, at(12)),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("refuses a turn or an alert that claims another crew member's check-in", () => {
    expect(() =>
      w.db
        .prepare("INSERT INTO turn (id, check_in_id, crew_id, speaker, text, language, created_at) VALUES ('t', ?, ?, 'crew', 'x', 'en', ?)")
        .run(w.bCheckIn, A, at(12)),
    ).toThrow(/FOREIGN KEY/i);
    expect(() =>
      w.db
        .prepare("INSERT INTO alert (id, crew_id, check_in_id, created_at, level, rule, text_json) VALUES ('al', ?, ?, ?, 'red', 'OVERALL', '{}')")
        .run(A, w.bCheckIn, at(12)),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("refuses to re-assign a check-in to another crew member while it has measurements", () => {
    expect(() => w.db.prepare("UPDATE check_in SET crew_id = ? WHERE id = ?").run(A, w.bCheckIn)).toThrow(
      /FOREIGN KEY/i,
    );
  });

  it("enforces UNIQUE(check_in_id, key) and the source CHECK", () => {
    expect(() =>
      w.db
        .prepare("INSERT INTO measurement (id, check_in_id, crew_id, key, value, source, created_at) VALUES ('dup', ?, ?, 'sleep_hours', 1, 'typed', ?)")
        .run(w.aCheckIn, A, at(12)),
    ).toThrow(/UNIQUE/i);
    expect(() =>
      w.db
        .prepare("INSERT INTO measurement (id, check_in_id, crew_id, key, value, source, created_at) VALUES ('bad', ?, ?, 'mood', 1, 'guess', ?)")
        .run(w.aCheckIn, A, at(12)),
    ).toThrow(/CHECK/i);
  });
});

describe("repo behaviour", () => {
  it("stores text keys in value_text, numbers (booleans as 0/1) in value", () => {
    const rows = w.db
      .prepare("SELECT key, value, value_text FROM measurement WHERE check_in_id = ? ORDER BY key")
      .all(w.bCheckIn);
    expect(rows).toEqual([
      { key: "sleep_hours", value: 5.5, value_text: null },
      { key: "symptom_headache", value: 1, value_text: null },
      { key: "symptom_note", value: null, value_text: SECRET_NOTE },
    ]);
  });

  it("rejects a text value for a numeric key and a number for a text key (BAD_INPUT, nothing stored)", () => {
    const bad = (key: "mood" | "day_note", value: number | string) =>
      measurementRepo.upsertMeasurement(B, w.bOpen, { key, value, unit: null, sourceText: null, confidence: null, source: "typed" });
    expect(() => bad("mood", "five")).toThrow(expect.objectContaining({ status: 400, code: "BAD_INPUT" }));
    expect(() => bad("mood", Number.NaN)).toThrow(HttpError);
    expect(() => bad("day_note", 5)).toThrow(HttpError);
    expect(measurementRepo.listMeasurements(B, w.bOpen).map((m) => m.key)).toEqual(["mood"]);
  });

  it("listHistoryDays: latest `days` confirmed dates before `before`, one entry per date (latest confirmed), oldest first", () => {
    const early = checkinRepo.createCheckIn(A, { language: "mn", startedAt: at(10, 7, 0), id: "ci-a-early" });
    measurementRepo.upsertMeasurement(A, early.id, {
      key: "sleep_hours", value: 3, unit: "h", sourceText: null, confidence: null, source: "typed",
    });
    checkinRepo.confirmCheckIn(A, early.id, { confirmedAt: at(10, 7, 10), summaryJson: null });
    // two confirmed check-ins on 10 Nov: the later confirmation wins (sleep 7, not 3)
    expect(checkinRepo.listHistoryDays(A, { before: dateOf(11), days: 14 })).toEqual([
      { date: dateOf(10), values: { sleep_hours: 7, day_note: "A-note" } },
    ]);
    // `before` is exclusive
    expect(checkinRepo.listHistoryDays(A, { before: dateOf(10), days: 14 })).toEqual([]);
    // `days` counts confirmed days, not calendar days: a gap does not shrink the window
    expect(checkinRepo.listHistoryDays(A, { before: dateOf(11), days: 1 })).toHaveLength(1);
    expect(checkinRepo.listHistoryDays(A, { before: dateOf(28), days: 1 }).map((d) => d.date)).toEqual([dateOf(10)]);
    expect(() => checkinRepo.listHistoryDays(A, { before: "11/11/2026", days: 14 })).toThrow(HttpError);
    expect(() => checkinRepo.listHistoryDays(A, { before: dateOf(11), days: 0 })).toThrow(HttpError);
  });

  it("listHistoryDays returns the last `days` confirmed days even across a long gap (baseline survives old data)", () => {
    // 14 consecutive confirmed days, 1..14 Nov, for crew A (10 Nov already exists with sleep 7)
    for (let day = 1; day <= 14; day++) {
      if (day === 10) continue;
      const c = checkinRepo.createCheckIn(A, { language: "mn", startedAt: at(day, 8, 0), id: `gap-${day}` });
      measurementRepo.upsertMeasurement(A, c.id, {
        key: "sleep_hours", value: day, unit: "h", sourceText: null, confidence: null, source: "simulated",
      });
      checkinRepo.confirmCheckIn(A, c.id, { confirmedAt: at(day, 8, 30), summaryJson: null });
    }
    const expectedDates = Array.from({ length: 14 }, (_, i) => dateOf(i + 1));
    for (const day of [15, 20, 23, 24, 25, 28]) {
      const got = checkinRepo.listHistoryDays(A, { before: dateOf(day), days: 14 });
      expect(got.map((d) => d.date), `before ${dateOf(day)}`).toEqual(expectedDates);
    }
    // fewer than `days` available: everything there is, oldest first
    expect(checkinRepo.listHistoryDays(A, { before: dateOf(28), days: 3 }).map((d) => d.date)).toEqual([
      dateOf(12), dateOf(13), dateOf(14),
    ]);
    // a hole inside the history is skipped, not padded: the 10th is absent here
    expect(checkinRepo.listHistoryDays(A, { before: dateOf(12), days: 3 }).map((d) => d.date)).toEqual([
      dateOf(9), dateOf(10), dateOf(11),
    ]);
    // ground applies the same rule, and asOf decides which days count
    const g = groundRepo.groundListHistoryDays(A, { before: dateOf(28), days: 14, asOf: at(28) });
    expect(g.map((d) => d.date)).toEqual(expectedDates);
    const early = groundRepo.groundListHistoryDays(A, { before: dateOf(28), days: 14, asOf: at(5, 8, 30) });
    expect(early.map((d) => d.date)).toEqual([dateOf(1), dateOf(2), dateOf(3), dateOf(4), dateOf(5)]);
  });

  it("unconfirmed check-ins never appear in history or latestConfirmed", () => {
    expect(checkinRepo.listHistoryDays(B, { before: dateOf(20), days: 14 }).map((d) => d.date)).toEqual([dateOf(11)]);
    expect(checkinRepo.latestConfirmedCheckIn(B)?.id).toBe(w.bCheckIn);
  });

  it("createCheckIn stores state GREETING and the local date of startedAt", () => {
    const c = checkinRepo.createCheckIn(A, { language: "en", startedAt: at(15, 23, 30) });
    expect(c).toMatchObject({ state: "GREETING", stateJson: "{}", confirmedAt: null, summaryJson: null, language: "en" });
    expect(c.localDate).toBe(dateOf(15));
    expect(c.startedAt).toBe(at(15, 23, 30));
  });
});

describe("ground reads: asOf, redaction, no turns", () => {
  it("groundListCrew is roster only", () => {
    expect(groundRepo.groundListCrew().map((c) => c.id)).toEqual([A, B]);
    expect(groundRepo.groundGetCrew(B)?.id).toBe(B);
    expect(groundRepo.groundGetCrew("nobody")).toBeNull();
  });

  it("groundLatestConfirmedCheckIn respects asOf (confirmed_at <= asOf is visible, inclusive)", () => {
    expect(groundRepo.groundLatestConfirmedCheckIn(B, at(11, 8, 29))).toBeNull();
    expect(groundRepo.groundLatestConfirmedCheckIn(B, at(11, 8, 30))?.id).toBe(w.bCheckIn);
    expect(groundRepo.groundLatestConfirmedCheckIn(B, at(20))?.id).toBe(w.bCheckIn);
    expect(groundRepo.groundLatestConfirmedCheckIn(A, at(10, 8, 29))).toBeNull();
    // unconfirmed check-ins are never visible, however late asOf is
    expect(groundRepo.groundLatestConfirmedCheckIn(B, "2099-01-01T00:00:00.000Z")?.id).toBe(w.bCheckIn);
  });

  it("asOf accepts any ISO instant (offsets are normalised), and rejects garbage", () => {
    const sameInstantWithOffset = new Date(at(11, 8, 30)).toISOString().replace("Z", "+00:00");
    expect(groundRepo.groundLatestConfirmedCheckIn(B, sameInstantWithOffset)?.id).toBe(w.bCheckIn);
    expect(() => groundRepo.groundLatestConfirmedCheckIn(B, "yesterday")).toThrow(HttpError);
  });

  it("never returns state_json, and redacts free text from the stored summary", () => {
    const rec = groundRepo.groundLatestConfirmedCheckIn(B, at(20))!;
    expect(rec).not.toHaveProperty("stateJson");
    const summary = JSON.parse(rec.summaryJson!);
    expect(summary.spoken.text).toBe("");
    expect(summary.findings[0]).toMatchObject({ key: "symptom_note", value: "" });
    expect(summary.findings[1]).toMatchObject({ key: "sleep_hours", value: 5.5 });
    expect(rec.summaryJson).not.toContain(SECRET_NOTE);
    expect(rec.summaryJson).not.toContain(SPOKEN_QUOTE);
    // a summary that is not JSON is dropped, not passed through
    expect(groundRepo.redactSummaryJson("not json")).toBeNull();
    expect(groundRepo.redactSummaryJson(null)).toBeNull();
  });

  it("groundListMeasurements: asOf gate, numeric values intact, text keys redacted to ''", () => {
    expect(groundRepo.groundListMeasurements(B, w.bCheckIn, at(11, 8, 29))).toEqual([]);
    const rows = groundRepo.groundListMeasurements(B, w.bCheckIn, at(11, 8, 30));
    expect(rows.map((r) => r.key).sort()).toEqual(["sleep_hours", "symptom_headache", "symptom_note"]);
    expect(rows.find((r) => r.key === "sleep_hours")?.value).toBe(5.5);
    expect(rows.find((r) => r.key === "symptom_headache")?.value).toBe(1);
    const note = rows.find((r) => r.key === "symptom_note")!;
    expect(note.value).toBe("");
    expect(note.sourceText).toBeNull();
    expect(JSON.stringify(rows)).not.toContain(SECRET_NOTE);
  });

  it("groundListMeasurements never leaks the verbatim transcript snippet, on numeric keys either", () => {
    const SENTENCE = "I slept 5 hours, my head hurts and I miss my wife";
    const c = checkinRepo.createCheckIn(B, { language: "en", startedAt: at(13, 8, 0), id: "ci-b-sentence" });
    measurementRepo.upsertMeasurement(B, c.id, {
      key: "sleep_hours", value: 5, unit: "h", sourceText: SENTENCE, confidence: 0.9, source: "voice",
    });
    checkinRepo.confirmCheckIn(B, c.id, { confirmedAt: at(13, 8, 30), summaryJson: null });
    // the crew member's own read still has the snippet (it is shown back for confirmation)
    expect(measurementRepo.listMeasurements(B, c.id)[0].sourceText).toBe(SENTENCE);
    const rows = groundRepo.groundListMeasurements(B, c.id, at(13, 8, 30));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "sleep_hours", value: 5, sourceText: null });
    expect(JSON.stringify(rows)).not.toContain("head hurts");
    // none of the ground reads of this crew member contains it
    const everything = JSON.stringify([
      groundRepo.groundLatestConfirmedCheckIn(B, at(20)),
      groundRepo.groundListHistoryDays(B, { before: dateOf(20), days: 14, asOf: at(20) }),
      groundRepo.groundListAlerts(at(20)),
    ]);
    expect(everything).not.toContain("miss my wife");
  });

  it("groundListMeasurements never returns an unconfirmed check-in or one under the wrong crewId", () => {
    expect(groundRepo.groundListMeasurements(B, w.bOpen, "2099-01-01T00:00:00.000Z")).toEqual([]);
    expect(groundRepo.groundListMeasurements(A, w.bCheckIn, "2099-01-01T00:00:00.000Z")).toEqual([]);
    expect(groundRepo.groundListMeasurements(B, w.aCheckIn, "2099-01-01T00:00:00.000Z")).toEqual([]);
  });

  it("groundListHistoryDays respects asOf and omits free-text keys entirely", () => {
    const opts = { before: dateOf(20), days: 14 };
    expect(groundRepo.groundListHistoryDays(B, { ...opts, asOf: at(11, 8, 29) })).toEqual([]);
    const days = groundRepo.groundListHistoryDays(B, { ...opts, asOf: at(11, 8, 30) });
    expect(days).toEqual([{ date: dateOf(11), values: { sleep_hours: 5.5, symptom_headache: 1 } }]);
    expect(JSON.stringify(days)).not.toContain(SECRET_NOTE);
    expect(groundRepo.groundListHistoryDays(A, { ...opts, asOf: at(20) })).toEqual([
      { date: dateOf(10), values: { sleep_hours: 7 } },
    ]);
  });

  it("groundListHistoryDays is keyed by crewId: A's history never contains B's rows", () => {
    const a = groundRepo.groundListHistoryDays(A, { before: dateOf(20), days: 14, asOf: at(20) });
    expect(JSON.stringify(a)).not.toContain("5.5");
    expect(a.map((d) => d.date)).toEqual([dateOf(10)]);
  });

  it("groundListAlerts: only alerts whose check-in is visible, newest first, across crew", () => {
    expect(groundRepo.groundListAlerts(at(10, 8, 29))).toEqual([]);
    expect(groundRepo.groundListAlerts(at(10, 8, 30)).map((a) => a.id)).toEqual([w.aAlert]);
    expect(groundRepo.groundListAlerts(at(11, 8, 29)).map((a) => a.id)).toEqual([w.aAlert]);
    expect(groundRepo.groundListAlerts(at(11, 8, 30)).map((a) => a.id)).toEqual([w.bAlert, w.aAlert]);
    expect(groundRepo.groundListAlerts(at(11, 8, 30)).map((a) => a.crewId)).toEqual([B, A]);
  });

  it("an alert on a check-in that is not confirmed yet is invisible to ground", () => {
    alertRepo.insertAlert(B, {
      checkInId: w.bOpen, level: "red", rule: "VITAL_RED", text: { en: "open", mn: "нээлттэй" }, createdAt: at(12, 8, 10),
    });
    expect(groundRepo.groundListAlerts("2099-01-01T00:00:00.000Z").map((a) => a.text.en)).toEqual(["B alert", "A alert"]);
    checkinRepo.confirmCheckIn(B, w.bOpen, { confirmedAt: at(12, 8, 20), summaryJson: null });
    expect(groundRepo.groundListAlerts(at(12, 8, 19)).map((a) => a.text.en)).toEqual(["B alert", "A alert"]);
    expect(groundRepo.groundListAlerts(at(12, 8, 20)).map((a) => a.text.en)).toEqual(["open", "B alert", "A alert"]);
  });

  it("nothing a ground read returns contains turn text or free-text notes", () => {
    const everything = JSON.stringify([
      groundRepo.groundListCrew(),
      groundRepo.groundLatestConfirmedCheckIn(A, at(20)),
      groundRepo.groundLatestConfirmedCheckIn(B, at(20)),
      groundRepo.groundListMeasurements(A, w.aCheckIn, at(20)),
      groundRepo.groundListMeasurements(B, w.bCheckIn, at(20)),
      groundRepo.groundListHistoryDays(A, { before: dateOf(20), days: 14, asOf: at(20) }),
      groundRepo.groundListHistoryDays(B, { before: dateOf(20), days: 14, asOf: at(20) }),
      groundRepo.groundListAlerts(at(20)),
    ]);
    for (const secret of [SECRET_NOTE, SECRET_TURN, SPOKEN_QUOTE, "B-open-turn", "A-turn", "A-note"]) {
      expect(everything, secret).not.toContain(secret);
    }
  });
});
