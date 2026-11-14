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

ALTER TABLE crew_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_in ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement ENABLE ROW LEVEL SECURITY;
ALTER TABLE turn ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert ENABLE ROW LEVEL SECURITY;
`;

/** the tables and indexes PG_SCHEMA_SQL creates (read from it, so the two cannot drift apart); see pgSchemaReady */
export const PG_SCHEMA_TABLES: readonly string[] = [...PG_SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(
  (m) => m[1],
);
export const PG_SCHEMA_INDEXES: readonly string[] = [...PG_SCHEMA_SQL.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)/g)].map(
  (m) => m[1],
);
