/**
 * Thin client for the AEGIS API (docs/PLAN.md section 5). Every function takes an optional `fetchImpl`
 * so tests can inject a fake. Failures become `ApiClientError` with an ApiErrorCode (or "NETWORK"
 * when the request never got an answer). `crewId` is never sent except to POST /api/session: after
 * that the server knows who is asking from the signed cookie.
 */
import { audioFileName } from "./speech";
import { parseDemoScript, type DemoScript } from "./demo";
import type {
  ApiErrorCode,
  CheckInCreated,
  CheckInSnapshot,
  CrewPublic,
  DashboardPayload,
  HealthResponse,
  Lang,
} from "@/lib/types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const ERROR_CODES: readonly string[] = [
  "INTERNAL",
  "NO_SESSION",
  "FORBIDDEN",
  "NOT_FOUND",
  "BAD_INPUT",
  "WRONG_STATE",
  "STT_FAILED",
  "LLM_FAILED",
  "TTS_FAILED",
];

export class ApiClientError extends Error {
  readonly code: ApiErrorCode | "NETWORK";
  readonly status: number;
  constructor(code: ApiErrorCode | "NETWORK", message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

function defaultFetch(): FetchLike {
  return (input, init) => globalThis.fetch(input, init);
}

async function send(fetchImpl: FetchLike | undefined, url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await (fetchImpl ?? defaultFetch())(url, { credentials: "same-origin", ...init });
  } catch (cause) {
    if (init?.signal?.aborted) throw cause;
    throw new ApiClientError("NETWORK", "Network request failed", 0);
  }
  if (!res.ok) throw await errorFromResponse(res);
  return res;
}

function codeForStatus(status: number): ApiErrorCode {
  if (status === 401) return "NO_SESSION";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 400) return "BAD_INPUT";
  if (status === 409) return "WRONG_STATE";
  return "INTERNAL";
}

export async function errorFromResponse(res: Response): Promise<ApiClientError> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const err = (body as { error: unknown }).error;
      if (typeof err === "object" && err !== null) {
        const { code, message } = err as { code?: unknown; message?: unknown };
        if (typeof code === "string" && ERROR_CODES.includes(code)) {
          return new ApiClientError(
            code as ApiErrorCode,
            typeof message === "string" ? message : "",
            res.status,
          );
        }
      }
    }
  } catch {
    // not JSON: fall through to the status mapping
  }
  return new ApiClientError(codeForStatus(res.status), `HTTP ${res.status}`, res.status);
}

async function readJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiClientError("INTERNAL", "The server sent an unreadable response", res.status);
  }
}

/* ───────────── endpoints ───────────── */

export async function postSession(crewId: string, fetchImpl?: FetchLike): Promise<void> {
  await send(fetchImpl, "/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ crewId }),
  });
}

function isCrewPublic(v: unknown): v is CrewPublic {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.name === "string" &&
    typeof c.role === "string" &&
    (c.preferredLanguage === "mn" || c.preferredLanguage === "en") &&
    typeof c.mascotVariant === "number" &&
    typeof c.avatarSeed === "string"
  );
}

/** GET /api/crew. Accepts a bare array or { crew: [...] }; invalid entries are dropped. */
export async function fetchCrew(fetchImpl?: FetchLike): Promise<CrewPublic[]> {
  const res = await send(fetchImpl, "/api/crew");
  const body = await readJson<unknown>(res);
  const list = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null && Array.isArray((body as { crew?: unknown }).crew)
      ? (body as { crew: unknown[] }).crew
      : [];
  return list.filter(isCrewPublic);
}

/** `language` undefined: the server uses the crew member's own preferred language (what the check-in screen does). */
export async function createCheckIn(language: Lang | undefined, fetchImpl?: FetchLike): Promise<CheckInCreated> {
  const res = await send(fetchImpl, "/api/checkins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language }),
  });
  return readJson<CheckInCreated>(res);
}

export type TourFocus = "overall" | "alerts" | "body" | "vital" | "radar" | "plan" | "timeline" | "ask";
export interface TourStep {
  focus: TourFocus;
  turnId: string;
  text: string;
}

/** POST /api/checkins/:id/tour - Cosmo's spoken walkthrough of today's dashboard (stored as Cosmo turns). */
export async function postTour(
  checkInId: string,
  language: Lang,
  fetchImpl?: FetchLike,
): Promise<{ language: Lang; steps: TourStep[] }> {
  const res = await send(fetchImpl, `/api/checkins/${encodeURIComponent(checkInId)}/tour?lang=${language}`, {
    method: "POST",
  });
  return readJson<{ language: Lang; steps: TourStep[] }>(res);
}

/** POST /api/checkins/:id/language - switch the conversation language (EN/MN on the check-in screen). */
export async function postLanguage(
  checkInId: string,
  language: Lang,
  fetchImpl?: FetchLike,
): Promise<{ language: Lang; turn: { turnId: string; text: string } | null }> {
  const res = await send(fetchImpl, `/api/checkins/${encodeURIComponent(checkInId)}/language`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language }),
  });
  return readJson<{ language: Lang; turn: { turnId: string; text: string } | null }>(res);
}

export async function fetchSnapshot(checkInId: string, fetchImpl?: FetchLike): Promise<CheckInSnapshot> {
  const res = await send(fetchImpl, `/api/checkins/${encodeURIComponent(checkInId)}`);
  return readJson<CheckInSnapshot>(res);
}

function turnUrl(checkInId: string): string {
  return `/api/checkins/${encodeURIComponent(checkInId)}/turn`;
}

/** Opens the SSE stream for a typed (or demo) utterance. The caller reads `response.body`. */
export async function postTurnText(
  checkInId: string,
  text: string,
  signal?: AbortSignal,
  fetchImpl?: FetchLike,
): Promise<Response> {
  return send(fetchImpl, turnUrl(checkInId), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ text }),
    signal,
  });
}

/** Opens the SSE stream for a recorded utterance (multipart field `audio`). */
export async function postTurnAudio(
  checkInId: string,
  audio: Blob,
  signal?: AbortSignal,
  fetchImpl?: FetchLike,
): Promise<Response> {
  const form = new FormData();
  form.append("audio", audio, audioFileName(audio.type));
  // no Content-Type header: the browser adds the multipart boundary itself
  return send(fetchImpl, turnUrl(checkInId), {
    method: "POST",
    headers: { Accept: "text/event-stream" },
    body: form,
    signal,
  });
}

export async function fetchDashboard(checkInId: string, fetchImpl?: FetchLike): Promise<DashboardPayload> {
  const res = await send(fetchImpl, `/api/dashboard?checkInId=${encodeURIComponent(checkInId)}`);
  return readJson<DashboardPayload>(res);
}

/** null when the health endpoint cannot be reached: the UI then assumes the optimistic defaults. */
export async function fetchHealth(fetchImpl?: FetchLike): Promise<HealthResponse | null> {
  try {
    const res = await send(fetchImpl, "/api/health");
    return await readJson<HealthResponse>(res);
  } catch {
    return null;
  }
}

export async function fetchDemoScript(language: Lang, fetchImpl?: FetchLike): Promise<DemoScript> {
  const res = await send(fetchImpl, `/api/demo/script?lang=${encodeURIComponent(language)}`);
  const parsed = parseDemoScript(await readJson<unknown>(res));
  if (!parsed) throw new ApiClientError("INTERNAL", "The demo script has no crew lines", res.status);
  return parsed;
}

/**
 * Same-origin URL of a turn's audio (also used by the replay button). No text travels in the URL. `part`: one line of
 * the turn (one beat of Cosmo's step-by-step walkthrough, src/lib/explain.ts).
 */
export function turnAudioUrl(checkInId: string, turnId: string, part?: number): string {
  const base = `/api/checkins/${encodeURIComponent(checkInId)}/turns/${encodeURIComponent(turnId)}/audio`;
  return part === undefined ? base : `${base}?part=${part}`;
}
