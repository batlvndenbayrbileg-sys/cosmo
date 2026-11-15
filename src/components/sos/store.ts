/**
 * The crew side of SOS to Earth, as one small store outside React (the status card is mounted in two places of the
 * check-in screen and must not lose a capture in flight when the view changes).
 *
 *  - sendSosToEarth: the SOS button. POST /api/sos; only when the server answers that the alert is stored does Cosmo
 *    say so (the stored turn's voice, else the browser voice). A failure says so and points to the station's comms.
 *  - noteSosFromTurn: the words "tell Earth" in a conversation turn; the server has already stored the alert and
 *    Cosmo's spoken line arrives with the turn, so only the status card and the photo are left to do here.
 * Then, once per alert, the front camera takes one still (camera.ts) and it is attached to that alert; a refused or
 * missing camera is reported instead, and the alert stands without a photo.
 */
import type { Lang, TurnEvent } from "@/lib/types";
import { sosSpoken, type SosPhotoStatus, type SosRaiseResult } from "@/lib/sos";
import { captureFaceStill, type StillResult } from "./camera";

export type SosPhotoUi = "waiting" | "taking" | "attached" | "denied" | "unavailable" | "failed";

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

/** injectable for tests */
export interface SosEnv {
  fetch: typeof fetch;
  capture: () => Promise<StillResult>;
  speak: (text: string, lang: Lang, audioUrl: string | null) => void;
  objectUrl: (blob: Blob) => string | null;
}

let state: SosUiState = SOS_IDLE;
const listeners = new Set<() => void>();
/** alerts whose photo was already taken (or is being taken) in this tab */
const photoDone = new Set<string>();

function set(next: SosUiState): void {
  if (state.phase === "sent" && state.photoUrl && (next.phase !== "sent" || next.photoUrl !== state.photoUrl)) {
    try {
      URL.revokeObjectURL(state.photoUrl);
    } catch {
      /* not a browser */
    }
  }
  state = next;
  for (const l of listeners) l();
}

export function getSosState(): SosUiState {
  return state;
}

export function subscribeSos(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function browserVoice(text: string, lang: Lang): void {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "mn" ? "mn-MN" : "en-US";
    window.speechSynthesis?.speak(u);
  } catch {
    /* the card shows the text */
  }
}

const browserEnv: SosEnv = {
  fetch: (...args) => fetch(...args),
  capture: captureFaceStill,
  speak: (text, lang, audioUrl) => {
    if (!audioUrl) return browserVoice(text, lang);
    const audio = new Audio(audioUrl);
    audio.play().catch(() => browserVoice(text, lang));
  },
  objectUrl: (blob) => {
    try {
      return URL.createObjectURL(blob);
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
}

function updatePhoto(alertId: string, photo: SosPhotoUi, photoUrl: string | null = null): void {
  if (state.phase !== "sent" || state.alertId !== alertId) return;
  set({ ...state, photo, photoUrl: photoUrl ?? state.photoUrl });
}

async function takeAndSendPhoto(alertId: string): Promise<void> {
  if (photoDone.has(alertId)) return;
  photoDone.add(alertId);
  updatePhoto(alertId, "taking");
  const still = await env.capture();
  const url = `/api/sos/${encodeURIComponent(alertId)}/photo`;
  try {
    if (still.ok) {
      const res = await env.fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "image/jpeg" },
        body: still.blob,
      });
      updatePhoto(alertId, res.ok ? "attached" : "failed", res.ok ? env.objectUrl(still.blob) : null);
    } else {
      await env.fetch(url, {
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
  const sameAlert = state.phase === "sent" && state.alertId === alertId;
  set({
    phase: "sent",
    alertId,
    createdAt,
    duplicate,
    photo: sameAlert && state.phase === "sent" ? state.photo : photoUiFor(photoStatus),
    photoUrl: sameAlert && state.phase === "sent" ? state.photoUrl : null,
  });
  if (photoStatus === "pending" || photoStatus === null) void takeAndSendPhoto(alertId);
}

/** The SOS button (or "Send SOS to Earth" in the emergency overlay). Ignored while a request is in flight. */
export async function sendSosToEarth(opts: { checkInId: string | null; lang: Lang }): Promise<void> {
  if (state.phase === "sending") return;
  set({ phase: "sending" });
  let result: SosRaiseResult | null = null;
  try {
    const res = await env.fetch("/api/sos", {
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
    env.speak(sosSpoken("failed", opts.lang), opts.lang, null);
    return;
  }
  const { alert, duplicate, spoken } = result;
  const audioUrl =
    spoken.turnId && opts.checkInId
      ? `/api/checkins/${encodeURIComponent(opts.checkInId)}/turns/${encodeURIComponent(spoken.turnId)}/audio`
      : null;
  env.speak(spoken.text, spoken.language, audioUrl);
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

export function dismissSos(): void {
  if (state.phase === "sending") return;
  set(SOS_IDLE);
}
