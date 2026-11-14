/**
 * Client-side fetch helpers for the Earth console. The ground role is established with
 * POST /api/session { role: "ground" }; the helper does that once and retries once when a request answers 401.
 */

import type { ApiError, ApiErrorCode } from "@/lib/types";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | "NETWORK";

  constructor(status: number, code: ApiErrorCode | "NETWORK", message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

/** JSON body of a response, or null for an empty / non-JSON body */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function failure(res: Response): Promise<ApiRequestError> {
  const body = await readJson(res);
  if (isApiError(body)) {
    return new ApiRequestError(res.status, body.error.code, body.error.message);
  }
  return new ApiRequestError(res.status, "INTERNAL", `Request failed (${res.status})`);
}

/**
 * GET JSON. Resolves to null for 204 / empty bodies. Throws ApiRequestError for HTTP errors and for
 * network failures (code "NETWORK"). AbortError is re-thrown untouched so callers can ignore it.
 */
export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, { signal, cache: "no-store", credentials: "same-origin" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiRequestError(0, "NETWORK", "Network error");
  }
  if (!res.ok) throw await failure(res);
  return (await readJson(res)) as T | null;
}

/** POST with an optional JSON body. Returns the parsed body (null when empty). */
export async function postJson<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiRequestError(0, "NETWORK", "Network error");
  }
  if (!res.ok) throw await failure(res);
  return (await readJson(res)) as T | null;
}

let groundSession: Promise<void> | null = null;

/** Starts the ground session once per page load; a failure is not cached. */
export function ensureGroundSession(): Promise<void> {
  if (!groundSession) {
    groundSession = postJson<unknown>("/api/session", { role: "ground" }).then(
      () => undefined,
      (err: unknown) => {
        groundSession = null;
        throw err;
      },
    );
  }
  return groundSession;
}

/** forget the cached session (after a 401 the cookie is gone or was replaced) */
export function resetGroundSession(): void {
  groundSession = null;
}

/** GET a /api/ground/* route as the ground role: ensures the session, retries once on 401/403. */
export async function groundGet<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  await ensureGroundSession();
  try {
    return await getJson<T>(url, signal);
  } catch (err) {
    if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) {
      resetGroundSession();
      await ensureGroundSession();
      return getJson<T>(url, signal);
    }
    throw err;
  }
}
