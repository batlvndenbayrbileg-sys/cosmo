"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Satellite } from "lucide-react";
import { fetchCrew, postSession } from "@/components/checkin/api";
import { FallbackBanner } from "@/components/shell/FallbackBanner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/I18nProvider";
import type { CrewPublic } from "@/lib/types";
import { CrewCard } from "./CrewCard";
import { saveSelectedCrew } from "./selectedCrew";

type LoadState = { status: "loading" } | { status: "ready"; crew: CrewPublic[] } | { status: "failed" };

/**
 * Start screen: the crew roster (name, role, avatar) and nothing else. No health data is requested
 * or shown here. Tapping a card opens the signed session (POST /api/session { crewId }) and goes to
 * /checkin. The small "Earth console" link leads to /earth, which starts its own ground session.
 */
export function CrewSelect() {
  const router = useRouter();
  const { t, setLang } = useI18n();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [selecting, setSelecting] = useState<string | null>(null);
  const [sessionFailed, setSessionFailed] = useState(false);

  const loadCrew = useCallback(() => {
    fetchCrew().then(
      (crew) => setLoad({ status: "ready", crew }),
      () => setLoad({ status: "failed" }),
    );
  }, []);

  useEffect(() => {
    loadCrew(); // state starts as "loading"; only the promise callbacks set state
  }, [loadCrew]);

  const retry = () => {
    setLoad({ status: "loading" });
    loadCrew();
  };

  const select = async (crew: CrewPublic) => {
    if (selecting) return;
    setSelecting(crew.id);
    setSessionFailed(false);
    try {
      await postSession(crew.id);
    } catch {
      setSelecting(null);
      setSessionFailed(true);
      return;
    }
    saveSelectedCrew(crew);
    // the greeting is spoken in the crew member's preferred language, so the screen follows it
    setLang(crew.preferredLanguage);
    router.push("/checkin");
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 py-4 sm:py-8">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">{t("crew.title")}</h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">{t("crew.subtitle")}</p>
      </header>

      {sessionFailed ? (
        <FallbackBanner message={t("crew.error.session")} onDismiss={() => setSessionFailed(false)} />
      ) : null}

      {load.status === "loading" ? (
        <div
          role="status"
          aria-label={t("crew.loading")}
          className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-80 rounded-3xl" />
          ))}
        </div>
      ) : load.status === "failed" ? (
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-border bg-card p-10 text-center">
          <p role="alert" className="text-lg text-foreground">
            {t("crew.error.load")}
          </p>
          <Button type="button" variant="outline" className="h-10 rounded-xl px-5 text-base" onClick={retry}>
            {t("shell.action.retry")}
          </Button>
        </div>
      ) : load.crew.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-10 text-center text-lg text-muted-foreground">
          {t("crew.empty")}
        </p>
      ) : (
        <ul
          role="list"
          aria-label={t("crew.list.label")}
          className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          {load.crew.map((crew) => (
            <li key={crew.id} className="flex">
              <CrewCard
                crew={crew}
                busy={selecting === crew.id}
                disabled={selecting !== null}
                onSelect={select}
              />
            </li>
          ))}
        </ul>
      )}

      <footer className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">{t("crew.privacy")}</p>
        <Link
          href="/earth"
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Satellite className="size-4" aria-hidden="true" />
          <span>{t("crew.earth.link")}</span>
          <span className="text-muted-foreground/80">- {t("crew.earth.hint")}</span>
        </Link>
      </footer>
    </div>
  );
}
