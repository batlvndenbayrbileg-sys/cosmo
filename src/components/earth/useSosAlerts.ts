"use client";

import { useCallback, useEffect, useState } from "react";
import { SOS_POLL_MS, type GroundSosAlert } from "@/lib/sos";
import { ensureGroundSession, groundGet, postJson } from "./api";

/**
 * The Earth console's live SOS feed: GET /api/ground/sos (as the ground role, with the simulated delay) on mount and
 * every SOS_POLL_MS while the page is open, so a new SOS appears within seconds without a reload. A failed poll keeps
 * the last list. `markSeen` acknowledges one alert (optimistically).
 */
export function useSosAlerts(delayMs: number, crewId?: string) {
  const [alerts, setAlerts] = useState<GroundSosAlert[]>([]);
  /** when the list was last fetched (ms); with the delay it says how long a photo has been awaited */
  const [fetchedAt, setFetchedAt] = useState(0);
  const [tick, setTick] = useState(0);
  const query = `delayMs=${delayMs}${crewId ? `&crewId=${encodeURIComponent(crewId)}` : ""}`;

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      groundGet<GroundSosAlert[]>(`/api/ground/sos?${query}`, signal).then(
        (data) => {
          if (!cancelled && !signal.aborted) {
            setAlerts(data ?? []);
            setFetchedAt(Date.now());
          }
        },
        () => {
          // offline or a hiccup: keep what is shown, the next poll tries again
        },
      );
    };
    load();
    const id = window.setInterval(load, SOS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      controller?.abort();
    };
  }, [query, tick]);

  const markSeen = useCallback(async (id: string) => {
    const at = new Date().toISOString();
    setAlerts((list) => list.map((a) => (a.id === id && !a.seenAt ? { ...a, seenAt: at } : a)));
    try {
      await ensureGroundSession();
      await postJson(`/api/ground/sos/${encodeURIComponent(id)}/seen`);
    } catch {
      // the next poll shows the server's truth again
    } finally {
      setTick((n) => n + 1);
    }
  }, []);

  return { alerts, markSeen, delayQuery: `delayMs=${delayMs}`, asOfMs: fetchedAt - delayMs };
}
