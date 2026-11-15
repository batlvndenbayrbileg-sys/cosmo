"use client";

import { useEffect, useState } from "react";
import { APP_CREW_REFERENCE_PANELS } from "@/lib/signature/config";
import { decodePerson, type UrinePersonSlice, type UrinePersonView } from "@/lib/labs/urine";
import { useI18n } from "@/i18n/I18nProvider";
import { LabsShell, UrinePanelView } from "./UrinePanelView";

/** decoded slices kept for the page's lifetime: switching tabs back and forth fetches once per person */
const cache = new Map<string, UrinePersonView>();
/** requests in flight, shared by every mount that asks for the same person (a failed one is dropped so retry refetches) */
const inflight = new Map<string, Promise<UrinePersonView>>();

function loadPerson(person: string): Promise<UrinePersonView> {
  let p = inflight.get(person);
  if (!p) {
    p = fetch(`/api/labs/urine?person=${encodeURIComponent(person)}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<UrinePersonSlice>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((slice) => {
        const view = decodePerson(slice);
        cache.set(person, view);
        return view;
      })
      .finally(() => inflight.delete(person));
    inflight.set(person, p);
  }
  return p;
}

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; view: UrinePersonView };

/**
 * The urine panel of one Inspiration4 reference crew member, fetched when the Labs tab opens (GET /api/labs/urine). The
 * dashboard page never carries the data: only this tab asks for it, and only for the one linked person.
 */
function useUrinePanel(person: string): [LoadState, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>(() => {
    const hit = cache.get(person);
    return hit ? { status: "ready", view: hit } : { status: "loading" };
  });

  useEffect(() => {
    if (cache.has(person)) return;
    let cancelled = false;
    loadPerson(person)
      .then((view) => {
        if (!cancelled) setState({ status: "ready", view });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [person, attempt]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };
  return [state, retry];
}

function Loader({ person }: { person: string }) {
  const { t } = useI18n();
  const [state, retry] = useUrinePanel(person);
  if (state.status === "ready") return <UrinePanelView view={state.view} />;
  return (
    <LabsShell person={person}>
      {state.status === "loading" ? (
        <p role="status" aria-live="polite" className="glass-card px-4 py-3 text-[15px] text-[var(--aegis-label)]">
          {t("dashboard.labs.loading")}
        </p>
      ) : (
        <div role="alert" className="glass-card flex flex-wrap items-center gap-3 px-4 py-3">
          <p className="text-[15px] text-[var(--aegis-ink)]">{t("dashboard.labs.error")}</p>
          <button
            type="button"
            onClick={retry}
            className="rounded-full bg-white px-3.5 py-1.5 text-[14px] font-medium text-[var(--aegis-ink)] ring-1 ring-[var(--aegis-hairline)] outline-none hover:bg-white/80 focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            {t("dashboard.labs.retry")}
          </button>
        </div>
      )}
    </LabsShell>
  );
}

/** the dashboard's Labs tab: the app crew member's linked reference panel (src/lib/signature/config.ts), or a note */
export function LabsPanel({ crewId }: { crewId: string }) {
  const { t } = useI18n();
  const person = APP_CREW_REFERENCE_PANELS[crewId] ?? null;
  if (!person) {
    return (
      <LabsShell person={null}>
        <p role="status" className="glass-card px-4 py-3 text-[15px] text-[var(--aegis-label)]">
          {t("dashboard.labs.unlinked")}
        </p>
      </LabsShell>
    );
  }
  return <Loader key={person} person={person} />;
}
