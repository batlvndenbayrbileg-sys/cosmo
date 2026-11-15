"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MotionConfig, motion } from "framer-motion";
import { ArrowUpRight, Satellite, ShieldCheck } from "lucide-react";
import { fetchCrew, postSession } from "@/components/checkin/api";
import { FallbackBanner } from "@/components/shell/FallbackBanner";
import { PageFrame } from "@/components/shell/PageFrame";
import { TopBar } from "@/components/shell/TopBar";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/I18nProvider";
import type { CrewPublic } from "@/lib/types";
import { CrewCard } from "./CrewCard";
import { saveSelectedCrew } from "./selectedCrew";

type LoadState = { status: "loading" } | { status: "ready"; crew: CrewPublic[] } | { status: "failed" };

const GRID = "grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4 lg:gap-5";

/**
 * The crew picker (/crew, kept for demos: the "/" screen recognises the speaker by itself): the roster (name, role,
 * avatar) and nothing else. No health data is requested or shown here. Tapping a card opens the signed session
 * (POST /api/session { crewId }) and goes to the assistant screen "/". The quiet "Earth console" link leads to /earth,
 * which starts its own ground session.
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
    // the assistant screen, already signed in as this person (the daily check-up opens from its button there)
    router.push("/");
  };

  return (
    <MotionConfig reducedMotion="user">
      <PageFrame data-slot="crew-select" frameClassName="lg:min-h-[calc(100dvh-7rem)]">
        <TopBar />

        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 140, damping: 24 }}
          className="flex flex-col items-start gap-3 sm:items-center sm:text-center"
        >
          <span className="unit-label inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 ring-1 ring-[color:var(--cosmo-hairline)]">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-[color:var(--cosmo-accent)]" />
            {t("crew.eyebrow")}
          </span>
          <h1
            className="text-[32px] leading-[1.1] font-light tracking-tight text-[color:var(--cosmo-ink)] sm:text-[44px]"
          >
            {t("crew.title.lead")} <span className="font-medium">{t("crew.title.accent")}</span>
          </h1>
          <p className="max-w-2xl text-[17px] text-[color:var(--cosmo-label)]">{t("crew.subtitle")}</p>
        </motion.header>

        {sessionFailed ? (
          <FallbackBanner message={t("crew.error.session")} onDismiss={() => setSessionFailed(false)} />
        ) : null}

        {load.status === "loading" ? (
          <div role="status" aria-label={t("crew.loading")} className={GRID}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[360px] rounded-[var(--cosmo-radius-card)] bg-white/60" />
            ))}
          </div>
        ) : load.status === "failed" ? (
          <div className="glass-card flex flex-col items-center gap-4 p-10 text-center">
            <p role="alert" className="text-lg text-[color:var(--cosmo-ink)]">
              {t("crew.error.load")}
            </p>
            <button
              type="button"
              onClick={retry}
              className="inline-flex h-11 items-center rounded-full bg-[color:var(--cosmo-ink)] px-6 text-[15px] font-medium text-white outline-none hover:bg-[color:var(--cosmo-accent-deep)] focus-visible:ring-4 focus-visible:ring-[color:var(--cosmo-accent)]/45"
            >
              {t("shell.action.retry")}
            </button>
          </div>
        ) : load.crew.length === 0 ? (
          <p className="glass-card p-10 text-center text-lg text-[color:var(--cosmo-label)]">{t("crew.empty")}</p>
        ) : (
          <ul role="list" aria-label={t("crew.list.label")} className={GRID}>
            {load.crew.map((crew, i) => (
              <motion.li
                key={crew.id}
                className="flex"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 150, damping: 22, delay: 0.08 + i * 0.07 }}
              >
                <CrewCard
                  crew={crew}
                  busy={selecting === crew.id}
                  disabled={selecting !== null}
                  onSelect={(c) => void select(c)}
                />
              </motion.li>
            ))}
          </ul>
        )}

        <footer className="mt-auto flex flex-col items-center justify-between gap-3 border-t border-white/70 pt-5 sm:flex-row">
          <p className="inline-flex items-center gap-2 text-[14px] text-[color:var(--cosmo-label)]">
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
            {t("crew.privacy")}
          </p>
          <Link
            href="/earth"
            title={t("crew.earth.hint")}
            className="group inline-flex min-h-10 items-center gap-2 rounded-full px-3 py-1.5 text-[14px] text-[color:var(--cosmo-label)] outline-none transition-colors hover:bg-white/70 hover:text-[color:var(--cosmo-ink)] focus-visible:ring-3 focus-visible:ring-[color:var(--cosmo-accent)]/45"
          >
            <Satellite className="size-4" aria-hidden="true" />
            <span className="font-medium">{t("crew.earth.link")}</span>
            <span className="hidden text-[color:var(--cosmo-label)]/80 md:inline">· {t("crew.earth.hint")}</span>
            <ArrowUpRight
              className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              aria-hidden="true"
            />
          </Link>
        </footer>
      </PageFrame>
    </MotionConfig>
  );
}
