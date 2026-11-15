import "server-only";

/**
 * SQLite schema (docs/PLAN.md section 3 + docs/DASHBOARD_PLAN.md section 5).
 *
 * Every statement is idempotent (IF NOT EXISTS) so it can be applied on every start.
 *
 * Isolation guarantee: `measurement`, `turn` and `alert` carry a denormalised `crew_id`, and a
 * COMPOSITE foreign key (check_in_id, crew_id) -> check_in(id, crew_id) makes it impossible for a
 * row to claim a crew that does not own its check-in. (Foreign keys must be ON: see client.ts.)
 *
 * Timestamps are ISO-8601 UTC strings produced by `Date#toISOString()` (fixed width, so string
 * comparison equals time comparison). `check_in.local_date` is the server-local calendar date
 * (YYYY-MM-DD) of `started_at`; it groups history by day.
 *
 * `sos_alert` (SOS to Earth, src/server/sos.ts) is added on top, additively: an SOS can be raised outside any check-in,
 * so its `check_in_id` is nullable (the composite foreign key applies only when it is set) and `crew_id` references the
 * crew member directly. The face still is a base64 JPEG (at most SOS_PHOTO_MAX_BYTES) in `photo_jpeg`, read only by
 * the ground photo route.
 *
 * `pain_report` (the pain check, src/server/pain.ts) is additive too: one row per pain told to Cosmo, tied to the
 * check-in it was told in. Only structured fields are stored (place, 0-10, since when, the related data items built by
 * code, red flags), never the words. `sent_at` is set once it is on the Earth console; `awaiting` / `asked_turn_id`
 * say what Cosmo asked and in which turn, so only the very next answer is read as the reply.
 */
export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS crew_member (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  role               TEXT NOT NULL,
  preferred_language TEXT NOT NULL CHECK (preferred_language IN ('mn','en')),
  mascot_variant     INTEGER NOT NULL,
  avatar_seed        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS check_in (
  id            TEXT PRIMARY KEY,
  crew_id       TEXT NOT NULL REFERENCES crew_member(id),
  started_at    TEXT NOT NULL,
  confirmed_at  TEXT,
  local_date    TEXT NOT NULL,
  language      TEXT NOT NULL CHECK (language IN ('mn','en')),
  summary_json  TEXT,
  state         TEXT NOT NULL DEFAULT 'GREETING'
                CHECK (state IN ('GREETING','SMALL_TALK','KPI_CAPTURE','CONFIRM','SUMMARY','DONE')),
  state_json    TEXT NOT NULL DEFAULT '{}',
  UNIQUE (id, crew_id)
);
CREATE INDEX IF NOT EXISTS idx_checkin_crew_time ON check_in (crew_id, started_at);
CREATE INDEX IF NOT EXISTS idx_checkin_crew_date ON check_in (crew_id, local_date);
CREATE INDEX IF NOT EXISTS idx_checkin_crew_confirmed ON check_in (crew_id, confirmed_at);

CREATE TABLE IF NOT EXISTS measurement (
  id           TEXT PRIMARY KEY,
  check_in_id  TEXT NOT NULL,
  crew_id      TEXT NOT NULL,
  key          TEXT NOT NULL,
  value        REAL,
  value_text   TEXT,
  unit         TEXT,
  source_text  TEXT,
  confidence   REAL,
  source       TEXT NOT NULL DEFAULT 'typed' CHECK (source IN ('typed','voice','simulated')),
  created_at   TEXT NOT NULL,
  UNIQUE (check_in_id, key),
  CHECK (value IS NOT NULL OR value_text IS NOT NULL),
  FOREIGN KEY (check_in_id, crew_id) REFERENCES check_in (id, crew_id)
);
CREATE INDEX IF NOT EXISTS idx_measurement_crew_key ON measurement (crew_id, key, created_at);

CREATE TABLE IF NOT EXISTS turn (
  id           TEXT PRIMARY KEY,
  check_in_id  TEXT NOT NULL,
  crew_id      TEXT NOT NULL,
  speaker      TEXT NOT NULL CHECK (speaker IN ('crew','cosmo','system')),
  text         TEXT NOT NULL,
  language     TEXT NOT NULL CHECK (language IN ('mn','en')),
  created_at   TEXT NOT NULL,
  FOREIGN KEY (check_in_id, crew_id) REFERENCES check_in (id, crew_id)
);
CREATE INDEX IF NOT EXISTS idx_turn_checkin_time ON turn (check_in_id, created_at);
CREATE INDEX IF NOT EXISTS idx_turn_crew ON turn (crew_id);

CREATE TABLE IF NOT EXISTS alert (
  id              TEXT PRIMARY KEY,
  crew_id         TEXT NOT NULL,
  check_in_id     TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  level           TEXT NOT NULL CHECK (level IN ('yellow','red')),
  rule            TEXT NOT NULL,
  text_json       TEXT NOT NULL,
  acknowledged_at TEXT,
  FOREIGN KEY (check_in_id, crew_id) REFERENCES check_in (id, crew_id)
);
CREATE INDEX IF NOT EXISTS idx_alert_crew_time ON alert (crew_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_checkin ON alert (check_in_id);

CREATE TABLE IF NOT EXISTS sos_alert (
  id            TEXT PRIMARY KEY,
  crew_id       TEXT NOT NULL REFERENCES crew_member(id),
  check_in_id   TEXT,
  created_at    TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('button','voice')),
  phrase        TEXT,
  photo_status  TEXT NOT NULL DEFAULT 'pending'
                CHECK (photo_status IN ('pending','attached','denied','unavailable')),
  photo_jpeg    TEXT,
  photo_bytes   INTEGER,
  photo_at      TEXT,
  seen_at       TEXT,
  FOREIGN KEY (check_in_id, crew_id) REFERENCES check_in (id, crew_id)
);
CREATE INDEX IF NOT EXISTS idx_sos_crew_time ON sos_alert (crew_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sos_time ON sos_alert (created_at);

CREATE TABLE IF NOT EXISTS pain_report (
  id             TEXT PRIMARY KEY,
  crew_id        TEXT NOT NULL,
  check_in_id    TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  location       TEXT CHECK (location IN ('head','eye','ear','tooth','throat','chest','abdomen','side','back','arm','leg','joint','whole_body')),
  severity       INTEGER CHECK (severity BETWEEN 0 AND 10),
  severity_word  TEXT CHECK (severity_word IN ('mild','moderate','severe')),
  onset_kind     TEXT CHECK (onset_kind IN ('just_now','minutes','hours','this_morning','last_night','today','yesterday','days','weeks')),
  onset_amount   REAL,
  items_json     TEXT NOT NULL DEFAULT '[]',
  red_flags_json TEXT NOT NULL DEFAULT '[]',
  urgent         INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0,1)),
  guide_id       TEXT,
  sos_alert_id   TEXT,
  sent_at        TEXT,
  awaiting       TEXT CHECK (awaiting IN ('location','details')),
  asked_turn_id  TEXT,
  FOREIGN KEY (check_in_id, crew_id) REFERENCES check_in (id, crew_id)
);
CREATE INDEX IF NOT EXISTS idx_pain_crew_time ON pain_report (crew_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pain_sent ON pain_report (sent_at);
`;

/**
 * The same schema for Postgres (Supabase, and PGlite in tests). Differences from SQLite:
 *  - every table has `seq`, an identity column that plays the part of SQLite's `rowid` (insertion order tie-breaker;
 *    queries say `rowid` and the Postgres adapter rewrites it, see sql.ts)
 *  - REAL is DOUBLE PRECISION (Postgres REAL is 4-byte and would turn 36.6 into 36.599998)
 *  - row level security is ON with no policies: Supabase's public Data API (anon / authenticated keys) can read
 *    nothing, while the app's own database role, which owns the tables, is unaffected
 */
export const PG_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS crew_member (
  id                 TEXT PRIMARY KEY,
  seq                BIGINT GENERATED ALWAYS AS IDENTITY,
  name               TEXT NOT NULL,
  role               TEXT NOT NULL,
  preferred_language TEXT NOT NULL CHECK (preferred_language IN ('mn','en')),
  mascot_variant     INTEGER NOT NULL,
  avatar_seed        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS check_in (
  id            TEXT PRIMARY KEY,
  seq           BIGINT GENERATED ALWAYS AS IDENTITY,
  crew_id       TEXT NOT NULL REFERENCES crew_member(id),
  started_at    TEXT NOT NULL,
  confirmed_at  TEXT,
  local_date    TEXT NOT NULL,
  language      TEXT NOT NULL CHECK (language IN ('mn','en')),
  summary_json  TEXT,
  state         TEXT NOT NULL DEFAULT 'GREETING'
                CHECK (state IN ('GREETING','SMALL_TALK','KPI_CAPTURE','CONFIRM','SUMMARY','DONE')),
  state_json    TEXT NOT NULL DEFAULT '{}',
  UNIQUE (id, crew_id)
);
CREATE INDEX IF NOT EXISTS idx_checkin_crew_time ON check_in (crew_id, started_at);
CREATE INDEX IF NOT EXISTS idx_checkin_crew_date ON check_in (crew_id, local_date);
CREATE INDEX IF NOT EXISTS idx_checkin_crew_confirmed ON check_in (crew_id, confirmed_at);

CREATE TABLE IF NOT EXISTS measurement (
  id           TEXT PRIMARY KEY,
  seq          BIGINT GENERATED ALWAYS AS IDENTITY,
  check_in_id  TEXT NOT NULL,
  crew_id      TEXT NOT NULL,
  key          TEXT NOT NULL,
  value        DOUBLE PRECISION,
  value_text   TEXT,
  unit         TEXT,
  source_text  TEXT,
  confidence   DOUBLE PRECISION,
  source       TEXT NOT NULL DEFAULT 'typed' CHECK (source IN ('typed','voice','simulated')),
  created_at   TEXT NOT NULL,
  UNIQUE (check_in_id, key),
  CHECK (value IS NOT NULL OR value_text IS NOT NULL),
  FOREIGN KEY (check_in_id, crew_id) REFERENCES check_in (id, crew_id)
);
CREATE INDEX IF NOT EXISTS idx_measurement_crew_key ON measurement (crew_id, key, created_at);

CREATE TABLE IF NOT EXISTS turn (
  id           TEXT PRIMARY KEY,
  seq          BIGINT GENERATED ALWAYS AS IDENTITY,
  check_in_id  TEXT NOT NULL,
  crew_id      TEXT NOT NULL,
  speaker      TEXT NOT NULL CHECK (speaker IN ('crew','cosmo','system')),
  text         TEXT NOT NULL,
  language     TEXT NOT NULL CHECK (language IN ('mn','en')),
  created_at   TEXT NOT NULL,
  FOREIGN KEY (check_in_id, crew_id) REFERENCES check_in (id, crew_id)
);
CREATE INDEX IF NOT EXISTS idx_turn_checkin_time ON turn (check_in_id, created_at);
CREATE INDEX IF NOT EXISTS idx_turn_crew ON turn (crew_id);

CREATE TABLE IF NOT EXISTS alert (
  id              TEXT PRIMARY KEY,
  seq             BIGINT GENERATED ALWAYS AS IDENTITY,
  crew_id         TEXT NOT NULL,
  check_in_id     TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  level           TEXT NOT NULL CHECK (level IN ('yellow','red')),
  rule            TEXT NOT NULL,
  text_json       TEXT NOT NULL,
  acknowledged_at TEXT,
  FOREIGN KEY (check_in_id, crew_id) REFERENCES check_in (id, crew_id)
);
CREATE INDEX IF NOT EXISTS idx_alert_crew_time ON alert (crew_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_checkin ON alert (check_in_id);

CREATE TABLE IF NOT EXISTS sos_alert (
  id            TEXT PRIMARY KEY,
  seq           BIGINT GENERATED ALWAYS AS IDENTITY,
  crew_id       TEXT NOT NULL REFERENCES crew_member(id),
  check_in_id   TEXT,
  created_at    TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('button','voice')),
  phrase        TEXT,
  photo_status  TEXT NOT NULL DEFAULT 'pending'
                CHECK (photo_status IN ('pending','attached','denied','unavailable')),
  photo_jpeg    TEXT,
  photo_bytes   INTEGER,
  photo_at      TEXT,
  seen_at       TEXT,
  FOREIGN KEY (check_in_id, crew_id) REFERENCES check_in (id, crew_id)
);
CREATE INDEX IF NOT EXISTS idx_sos_crew_time ON sos_alert (crew_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sos_time ON sos_alert (created_at);

CREATE TABLE IF NOT EXISTS pain_report (
  id             TEXT PRIMARY KEY,
  seq            BIGINT GENERATED ALWAYS AS IDENTITY,
  crew_id        TEXT NOT NULL,
  check_in_id    TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  location       TEXT CHECK (location IN ('head','eye','ear','tooth','throat','chest','abdomen','side','back','arm','leg','joint','whole_body')),
  severity       INTEGER CHECK (severity BETWEEN 0 AND 10),
  severity_word  TEXT CHECK (severity_word IN ('mild','moderate','severe')),
  onset_kind     TEXT CHECK (onset_kind IN ('just_now','minutes','hours','this_morning','last_night','today','yesterday','days','weeks')),
  onset_amount   DOUBLE PRECISION,
  items_json     TEXT NOT NULL DEFAULT '[]',
  red_flags_json TEXT NOT NULL DEFAULT '[]',
  urgent         INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0,1)),
  guide_id       TEXT,
  sos_alert_id   TEXT,
  sent_at        TEXT,
  awaiting       TEXT CHECK (awaiting IN ('location','details')),
  asked_turn_id  TEXT,
  FOREIGN KEY (check_in_id, crew_id) REFERENCES check_in (id, crew_id)
);
CREATE INDEX IF NOT EXISTS idx_pain_crew_time ON pain_report (crew_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pain_sent ON pain_report (sent_at);

ALTER TABLE crew_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_in ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement ENABLE ROW LEVEL SECURITY;
ALTER TABLE turn ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE sos_alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE pain_report ENABLE ROW LEVEL SECURITY;
`;

/** the tables and indexes PG_SCHEMA_SQL creates (read from it, so the two cannot drift apart); see pgSchemaReady */
export const PG_SCHEMA_TABLES: readonly string[] = [...PG_SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(
  (m) => m[1],
);
export const PG_SCHEMA_INDEXES: readonly string[] = [...PG_SCHEMA_SQL.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)/g)].map(
  (m) => m[1],
);
