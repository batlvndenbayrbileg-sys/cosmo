// lil cosmo: the main process's pure decisions (no Electron imports), unit-tested in tests/pet.core.test.ts.
// Everything that arrives from outside (the command line, a lilcosmo:// link, the page over IPC, an environment
// variable) is checked here before main.cjs acts on it.
"use strict";

const PROTOCOL = "lilcosmo";

/** crew ids are plain slugs ("bat", "mira_2"); the same rule as src/lib/pet/link.ts (a test keeps them in step) */
const CREW_ID = /^[A-Za-z0-9_-]{1,100}$/;
/** lilcosmo://crew/<id>, optionally with the trailing slash some browsers add. Nothing else is accepted. */
const CREW_LINK = /^lilcosmo:\/\/crew\/([A-Za-z0-9_-]{1,100})\/?$/i;

/** a crew id from one command-line argument (`--crew=<id>` or a lilcosmo:// link), or null */
function crewFromArg(arg) {
  if (typeof arg !== "string") return null;
  if (arg.startsWith("--crew=")) {
    const id = arg.slice("--crew=".length);
    return CREW_ID.test(id) ? id : null;
  }
  const m = CREW_LINK.exec(arg);
  return m ? m[1] : null;
}

/** the crew member a launch (or a second launch) asks for: the last valid argument wins; none = null (she sleeps) */
function crewFromArgs(argv) {
  let crew = null;
  for (const a of Array.isArray(argv) ? argv : []) {
    const id = crewFromArg(a);
    if (id !== null) crew = id;
  }
  return crew;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The website the pet shows, reduced to its origin. https anywhere; plain http only on this computer (dev).
 * Anything else (another scheme, a typo) is null, and main.cjs refuses to start rather than load it.
 */
function normalizeOrigin(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return url.origin;
  return null;
}

/** is `url` on exactly this origin (not a look-alike such as http://localhost:3000.evil.example)? */
function sameOrigin(url, origin) {
  if (typeof url !== "string" || typeof origin !== "string") return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** the pet page for a crew member (or the sleeping pet) */
function petUrl(origin, crew) {
  const url = new URL("/pet", origin);
  if (crew !== null && crew !== undefined && CREW_ID.test(crew)) url.searchParams.set("crew", crew);
  return url.href;
}

/** the dashboard the page asks to open: a path under /dashboard on our own origin, or null */
function dashboardUrl(origin, path) {
  if (typeof path !== "string" || !path.startsWith("/dashboard") || path.startsWith("//")) return null;
  let url;
  try {
    url = new URL(path, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.pathname !== "/dashboard" && !url.pathname.startsWith("/dashboard/")) return null;
  return url.href;
}

/** a window size the page asks for: whole pixels within sane bounds, or null */
function petSize(w, h) {
  const ok = (v) => typeof v === "number" && Number.isFinite(v) && v >= 60 && v <= 600;
  return ok(w) && ok(h) ? { w: Math.round(w), h: Math.round(h) } : null;
}

/** where the camera sees the person, 0 (screen left) .. 1 (right); null for anything that is not a number */
function clampFrac(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, v));
}

/**
 * The run's speed for the next tick: speed up gently, never above `max`, and slow down in time to stop on the spot
 * (v^2 = 2·a·d). Pure, so the ease-in / ease-out is tested.
 */
function nextSpeed(speed, distance, accel, max) {
  const d = Math.abs(distance);
  return Math.max(0, Math.min(max, speed + accel, Math.sqrt(2 * accel * d) + 0.5, d));
}

const MENU_LABELS = {
  talk: "Talk",
  stop: "Stop talking",
  write: "Write",
  camera: "Camera (follow me)",
  dashboard: "Open dashboard",
  profile: "Switch profile",
  noProfiles: "(could not load)",
  quit: "Quit lil cosmo",
};

/** the right-click menu's labels in the page's language; missing or odd ones fall back to English */
function menuLabels(raw) {
  const out = { ...MENU_LABELS };
  if (typeof raw !== "object" || raw === null) return out;
  for (const k of Object.keys(MENU_LABELS)) {
    const v = raw[k];
    if (typeof v === "string" && v.trim() !== "" && v.length <= 60) out[k] = v;
  }
  return out;
}

/** the crew list for "Switch profile": valid ids and short names only */
function menuCrew(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c.id === "string" && CREW_ID.test(c.id) && typeof c.name === "string" && c.name.trim() !== "")
    .slice(0, 50)
    .map((c) => ({ id: c.id, name: c.name.slice(0, 60) }));
}

module.exports = {
  PROTOCOL,
  CREW_ID,
  crewFromArg,
  crewFromArgs,
  normalizeOrigin,
  sameOrigin,
  petUrl,
  dashboardUrl,
  petSize,
  clampFrac,
  nextSpeed,
  menuLabels,
  menuCrew,
};
