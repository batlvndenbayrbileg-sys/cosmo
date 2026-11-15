/**
 * The crew side of SOS to Earth, as one small store outside React (the status card is mounted in two places of the
 * check-in screen and must not lose a capture in flight when the view changes).
 *
 *  - sendSosToEarth: the SOS button. POST /api/sos; only when the server answers that the alert is stored does Cosmo
 *    say so (the stored turn's voice, else the browser voice). A failure says so and points to the station's comms.
 *  - noteSosFromTurn: the words "tell Earth" in a conversation turn; the server has already stored the alert and
 *    Cosmo's spoken line arrives with the turn, so only the status card and the photo are left to do here.
 * Then, once per alert, the front camera takes one still (camera.ts) and it is attached to that alert; a refused or
 * missing camera is reported instead, and the alert stands without a photo. The crew member may delete the photo
 * afterwards (removeSosPhoto): the Earth console no longer has it, the alert stays.
 *
 * One voice at a time: Cosmo's line is said by Cosmo's own player when the check-in screen is mounted (it registers
 * itself with registerSosSpeaker), so the mouth moves, the microphone knows Cosmo is talking, and stopping Cosmo stops
 * it; otherwise it goes through the shared voice channel (src/components/voice/channel.ts). Either way a new line
 * (a second press, a guide step) silences the one before.
 */
import type { Lang, TurnEvent } from "@/lib/types";
import { sosSpoken, type SosAlert, type SosPhotoStatus, type SosRaiseResult } from "@/lib/sos";
import { speakOnChannel } from "@/components/voice/channel";
import { parseStoredCrew, readSelectedCrewRaw } from "@/components/crew/selectedCrew";
import { captureFaceStill, type StillResult } from "./camera";

export type SosPhotoUi =
  | "waiting"
  | "taking"
  | "attached"
  | "denied"
  | "unavailable"
  | "failed"
  /** the crew member asked to delete the attached photo */
  | "deleting"
  | "deleted"
  /** the delete did not go through: the photo is still with Earth, the card offers to try again */
  | "deleteFailed";

export type SosUiState =
  | { phase: "idle" }
  | { phase: "sending" }
  | {
      phase: "sent";
      alertId: string;
      createdAt: string;
      duplicate: boolean;
      photo: SosPhotoUi;
      /** object URL of the still that was sent (shown to the crew member) */
      photoUrl: string | null;
    }
  | { phase: "failed"; checkInId: string | null; lang: Lang };

export const SOS_IDLE: SosUiState = { phase: "idle" };

/** one line Cosmo says about the SOS */
export interface SosLine {
  text: string;
  lang: Lang;
  /** set when the line is a stored turn of the check-in: its server voice is at `audioUrl` */
  checkInId: string | null;
  turnId: string | null;
  audioUrl: string | null;
}

/** injectable for tests */
export interface SosEnv {
  fetch: typeof fetch;
  capture: () => Promise<StillResult>;
  speak: (line: SosLine) => void;
  objectUrl: (blob: Blob) => string | null;
  /** the crew member chosen in this tab (selectedCrew), to renew a lost session; null when unknown */
  crewId: () => string | null;
}

let state: SosUiState = SOS_IDLE;
const listeners = new Set<() => void>();
/** alerts whose photo was already taken (or is being taken) in this tab */
const photoDone = new Set<string>();

type SentState = Extract<SosUiState, { phase: "sent" }>;
/**
 * the alert on the card before a press now "sending": a second press of SOS within the incident is the same alert,
 * and its photo (state and thumbnail) must come back with the answer, not be lost
 */
let lastSent: SentState | null = null;
/** the object URL of the thumbnail, kept while it is shown or may come back (revoked once it cannot) */
let heldUrl: string | null = null;

function holdUrl(url: string | null): void {
  if (heldUrl && heldUrl !== url) {
    try {
      URL.revokeObjectURL(heldUrl);
    } catch {
      /* not a browser */
    }
  }
  heldUrl = url;
}

function set(next: SosUiState): void {
  if (next.phase === "sent") {
    lastSent = next;
    holdUrl(next.photoUrl);
  } else if (next.phase !== "sending") {
    lastSent = null;
    holdUrl(null);
  }
  state = next;
  for (const l of listeners) l();
}

/** the alert shown (or, while a second press is on its way, the one shown before it) */
function currentSent(): SentState | null {
  return state.phase === "sent" ? state : state.phase === "sending" ? lastSent : null;
}

export function getSosState(): SosUiState {
  return state;
}

export function subscribeSos(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Cosmo's own player (the check-in screen), when it is mounted */
let speaker: ((line: SosLine) => void) | null = null;

/** the check-in screen hands Cosmo's player to the store while it is mounted; returns the unregister function */
export function registerSosSpeaker(fn: (line: SosLine) => void): () => void {
  speaker = fn;
  return () => {
    if (speaker === fn) speaker = null;
  };
}

const browserEnv: SosEnv = {
  fetch: (...args) => fetch(...args),
  capture: captureFaceStill,
  speak: (line) => {
    if (speaker) speaker(line);
    else speakOnChannel(line.text, line.lang, line.audioUrl);
  },
  objectUrl: (blob) => {
    try {
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  },
  crewId: () => {
    try {
      return parseStoredCrew(readSelectedCrewRaw())?.id ?? null;
    } catch {
      return null;
    }
  },
};

let env: SosEnv = browserEnv;

/** tests only: replace the browser parts (null restores them) and reset the store */
export function setSosEnvForTests(next: SosEnv | null): void {
  env = next ?? browserEnv;
  photoDone.clear();
  state = SOS_IDLE;
  lastSent = null;
  heldUrl = null;
  speaker = null;
}

/**
 * fetch for the SOS routes: an expired or lost session cookie (401: a tab left open past the 12 h session, another
 * app on the same host) must not stop an SOS. The session is renewed once for the crew member chosen in this tab
 * (the same POST /api/session the start screen makes) and the request is sent again.
 */
async function sosFetch(url: string, init: RequestInit): Promise<Response> {
  const res = await env.fetch(url, init);
  if (res.status !== 401) return res;
  const crewId = env.crewId();
  if (!crewId) return res;
  try {
    const renewed = await env.fetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crewId }),
    });
    if (!renewed.ok) return res;
  } catch {
    return res;
  }
  return env.fetch(url, init);
}

function photoUrlOf(alertId: string): string {
  return `/api/sos/${encodeURIComponent(alertId)}/photo`;
}

/** `photoUrl` undefined keeps the current one, null drops it */
function updatePhoto(alertId: string, photo: SosPhotoUi, photoUrl?: string | null): void {
  const cur = currentSent();
  if (!cur || cur.alertId !== alertId) return;
  const next: SentState = { ...cur, photo, photoUrl: photoUrl === undefined ? cur.photoUrl : photoUrl };
  if (state.phase === "sent") {
    set(next);
  } else {
    // a second press is on its way: the photo's news waits with the alert it belongs to
    lastSent = next;
    holdUrl(next.photoUrl);
  }
}

/** what the server says the photo is now (the answer of the photo routes); null when it cannot be read */
async function photoStatusOf(res: Response): Promise<SosPhotoStatus | null> {
  try {
    const body = (await res.json()) as Partial<SosAlert> | null;
    return typeof body?.photoStatus === "string" ? body.photoStatus : null;
  } catch {
    return null;
  }
}

async function takeAndSendPhoto(alertId: string): Promise<void> {
  if (photoDone.has(alertId)) return;
  photoDone.add(alertId);
  updatePhoto(alertId, "taking");
  const still = await env.capture();
  const url = photoUrlOf(alertId);
  try {
    if (still.ok) {
      const res = await sosFetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "image/jpeg" },
        body: still.blob,
      });
      // attached only when the server says so (a photo deleted meanwhile, from another tab, stays deleted)
      const status = res.ok ? await photoStatusOf(res) : null;
      if (res.ok && (status === "attached" || status === null)) updatePhoto(alertId, "attached", env.objectUrl(still.blob));
      else if (res.ok && status === "denied") updatePhoto(alertId, "deleted", null);
      else updatePhoto(alertId, "failed", null);
    } else {
      await sosFetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missing: still.reason }),
      });
      updatePhoto(alertId, still.reason);
    }
  } catch {
    updatePhoto(alertId, still.ok ? "failed" : still.reason);
  }
}

function photoUiFor(status: SosPhotoStatus | null): SosPhotoUi {
  if (status === "attached" || status === "denied" || status === "unavailable") return status;
  return "waiting";
}

function showSent(alertId: string, createdAt: string, duplicate: boolean, photoStatus: SosPhotoStatus | null): void {
  const before = currentSent();
  const same = before && before.alertId === alertId ? before : null;
  set({
    phase: "sent",
    alertId,
    createdAt,
    duplicate,
    photo: same ? same.photo : photoUiFor(photoStatus),
    photoUrl: same ? same.photoUrl : null,
  });
  if (photoStatus === "pending" || photoStatus === null) void takeAndSendPhoto(alertId);
}

/** The SOS button (or "Send SOS to Earth" in the emergency overlay). Ignored while a request is in flight. */
export async function sendSosToEarth(opts: { checkInId: string | null; lang: Lang }): Promise<void> {
  if (state.phase === "sending") return;
  set({ phase: "sending" });
  let result: SosRaiseResult | null = null;
  try {
    const res = await sosFetch("/api/sos", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "button", checkInId: opts.checkInId, language: opts.lang }),
    });
    if (res.ok) result = (await res.json()) as SosRaiseResult;
  } catch {
    result = null;
  }
  if (!result?.alert?.id) {
    set({ phase: "failed", checkInId: opts.checkInId, lang: opts.lang });
    env.speak({ text: sosSpoken("failed", opts.lang), lang: opts.lang, checkInId: null, turnId: null, audioUrl: null });
    return;
  }
  const { alert, duplicate, spoken } = result;
  const voiced = spoken.turnId && opts.checkInId ? { checkInId: opts.checkInId, turnId: spoken.turnId } : null;
  env.speak({
    text: spoken.text,
    lang: spoken.language,
    checkInId: voiced?.checkInId ?? null,
    turnId: voiced?.turnId ?? null,
    audioUrl: voiced
      ? `/api/checkins/${encodeURIComponent(voiced.checkInId)}/turns/${encodeURIComponent(voiced.turnId)}/audio`
      : null,
  });
  showSent(alert.id, alert.createdAt, duplicate, alert.photoStatus);
}

/** the `sos` event of a conversation turn (the words "tell Earth") */
export function noteSosFromTurn(event: Extract<TurnEvent, { type: "sos" }>, lang: Lang, checkInId: string | null): void {
  if (!event.ok || !event.alertId || !event.createdAt) {
    set({ phase: "failed", checkInId, lang });
    return;
  }
  showSent(event.alertId, event.createdAt, event.duplicate, event.photoStatus);
}

/**
 * "Delete photo" on the card: DELETE /api/sos/[id]/photo. Deleting… while it runs, then deleted (the thumbnail goes,
 * Earth no longer has the photo, the alert stays), or deleteFailed with the photo still shown and a retry.
 */
export async function removeSosPhoto(): Promise<void> {
  if (state.phase !== "sent" || (state.photo !== "attached" && state.photo !== "deleteFailed")) return;
  const { alertId } = state;
  updatePhoto(alertId, "deleting");
  try {
    const res = await sosFetch(photoUrlOf(alertId), { method: "DELETE", credentials: "same-origin" });
    const status = res.ok ? await photoStatusOf(res) : null;
    if (res.ok && status !== "attached") updatePhoto(alertId, "deleted", null);
    else updatePhoto(alertId, "deleteFailed");
  } catch {
    updatePhoto(alertId, "deleteFailed");
  }
}

export function dismissSos(): void {
  if (state.phase === "sending") return;
  if (state.phase === "sent" && state.photo === "deleting") return; // the answer is still on its way
  set(SOS_IDLE);
}
