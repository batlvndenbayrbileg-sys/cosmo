import "server-only";
import type { ApiError, ApiErrorCode } from "@/lib/types";

/** An error that is safe to show to the client: status, machine code and a short message. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Thrown instead of ever returning another crew member's row. The message is deliberately generic
 * so it cannot be used to tell "does not exist" from "belongs to someone else".
 */
export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(404, "NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

const NO_STORE = { "cache-control": "no-store" } as const;

export function jsonError(code: ApiErrorCode, message: string, status: number): Response {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status, headers: NO_STORE });
}

/** 200 JSON response. Health data is never cacheable: `cache-control: no-store` unless overridden. */
export function ok<T>(data: T, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("cache-control")) headers.set("cache-control", NO_STORE["cache-control"]);
  return Response.json(data, { ...init, headers });
}

/**
 * Wraps a route handler body. HttpError becomes an ApiError JSON response; anything else is logged
 * server-side and returned as a generic 500 with code INTERNAL. Stack traces never leave the server.
 */
export async function handle(fn: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonError(err.code, err.message, err.status);
    }
    console.error("[cosmo] unhandled error in route handler:", err);
    return jsonError("INTERNAL", "Internal error", 500);
  }
}
