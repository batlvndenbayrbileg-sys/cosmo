"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiRequestError, getJson, groundGet } from "./api";

export type ResourceState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T | null }
  | { status: "error"; error: ApiRequestError };

interface Settled<T> {
  url: string;
  token: number;
  data: T | null;
  error: ApiRequestError | null;
}

function toRequestError(err: unknown): ApiRequestError {
  if (err instanceof ApiRequestError) return err;
  return new ApiRequestError(0, "INTERNAL", err instanceof Error ? err.message : "Request failed");
}

/**
 * GET a JSON resource and track loading / ready / error. `source: "ground"` first establishes the ground
 * session (POST /api/session { role: "ground" }). A new `url` (for example another delay) shows the loading
 * state again; `reload()` retries the same url. `url === null` stays in the loading state without fetching.
 */
export function useResource<T>(
  url: string | null,
  source: "ground" | "plain",
): ResourceState<T> & { reload: () => void } {
  const [token, setToken] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    const request = source === "ground" ? groundGet<T>(url, controller.signal) : getJson<T>(url, controller.signal);
    request.then(
      (data) => {
        if (!controller.signal.aborted) setSettled({ url, token, data, error: null });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({ url, token, data: null, error: toRequestError(err) });
      },
    );
    return () => controller.abort();
  }, [url, source, token]);

  const reload = useCallback(() => setToken((n) => n + 1), []);

  const current = settled && settled.url === url && settled.token === token ? settled : null;
  if (current === null) return { status: "loading", reload };
  if (current.error) return { status: "error", error: current.error, reload };
  return { status: "ready", data: current.data, reload };
}
