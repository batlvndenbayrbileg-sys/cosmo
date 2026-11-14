/** Pure helpers for the Earth console (no React, no I/O). */

import type { AlertRow } from "@/lib/types";

/** newest first; ties keep the server order */
export function sortAlertsNewestFirst(alerts: readonly AlertRow[]): AlertRow[] {
  return alerts
    .map((alert, index) => ({ alert, index }))
    .sort((a, b) => {
      const ta = Date.parse(a.alert.createdAt);
      const tb = Date.parse(b.alert.createdAt);
      if (Number.isNaN(ta) || Number.isNaN(tb) || ta === tb) return a.index - b.index;
      return tb - ta;
    })
    .map((x) => x.alert);
}
