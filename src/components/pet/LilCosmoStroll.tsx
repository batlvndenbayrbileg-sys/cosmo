"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { CosmoAvatar } from "@/components/cosmo/CosmoAvatar";
import { usePrefersReducedMotion } from "@/components/cosmo/usePrefersReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import {
  STROLL_MIN_VIEWPORT,
  STROLL_SPEED,
  clampStroll,
  nextStroll,
  runDurationMs,
  strollHiddenOn,
  strollBounds,
} from "@/lib/pet/stroll";
import { RunSprite } from "./RunSprite";

/** the person hid her for this tab ("×") */
const HIDDEN_KEY = "cosmo.lilStroll.hidden";
const SIZE = 72;
const HELLO_MS = 2600;

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function isWideViewport(): boolean {
  return window.innerWidth >= STROLL_MIN_VIEWPORT;
}

function readHidden(): boolean {
  try {
    return window.sessionStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * lil cosmo on the website: a small Cosmo that lives on the bottom edge of the screen, the twin of the desktop pet
 * (docs/lil-cosmo.md). She stands and bobs for a few seconds, then runs to a new spot with the team's 12-frame run
 * cycle (arms and legs pumping), facing the way she goes. A tap makes her hop and say hello; "×" hides her for this tab.
 *
 * Only the pet itself takes pointer events, so the page underneath stays usable. Movement is a transform on a ref
 * (one React render per run, not per frame). Hidden on phones, on the desktop pet's own page, the ground console and
 * developer pages. Reduced motion: she stands still in the corner, no running, no bobbing.
 */
export function LilCosmoStroll() {
  const pathname = usePathname();
  const reduced = usePrefersReducedMotion();
  const { t } = useI18n();
  // the server (and hydration) render nothing: wide is false until the browser's own width is read
  const wide = useSyncExternalStore(subscribeResize, isWideViewport, () => false);
  const [hidden, setHidden] = useState(() => (typeof window === "undefined" ? false : readHidden()));
  const [running, setRunning] = useState(false);
  const [dir, setDir] = useState(1);
  const [hello, setHello] = useState(false);
  const [helloSide, setHelloSide] = useState<"left" | "center" | "right">("center");
  const [hop, setHop] = useState(0);

  const petRef = useRef<HTMLDivElement | null>(null);
  const x = useRef<number>(Number.NaN);
  const timer = useRef<number>(0);
  const raf = useRef<number>(0);
  const helloTimer = useRef<number>(0);

  const place = useCallback((nx: number) => {
    x.current = nx;
    if (petRef.current) petRef.current.style.transform = `translate3d(${nx}px,0,0)`;
  }, []);

  const active = wide && !hidden && !strollHiddenOn(pathname);

  // the stroll loop: stand -> run -> stand ..., one plan at a time
  useEffect(() => {
    if (!active) return;
    const width = () => window.innerWidth;
    if (!Number.isFinite(x.current)) place(strollBounds(width(), SIZE).max - 40);
    else place(clampStroll(x.current, width(), SIZE));
    if (reduced) {
      // she never starts a run here, so `running` stays false
      place(strollBounds(width(), SIZE).max);
      return;
    }

    let cancelled = false;
    let wasRunning = false;
    const step = () => {
      if (cancelled) return;
      const plan = nextStroll(x.current, width(), SIZE, Math.random, wasRunning);
      if (plan.kind === "stand") {
        wasRunning = false;
        setRunning(false);
        timer.current = window.setTimeout(step, plan.ms);
        return;
      }
      wasRunning = true;
      const from = x.current;
      const to = plan.to;
      const ms = Math.max(1, runDurationMs(from, to, STROLL_SPEED));
      setDir(to >= from ? 1 : -1);
      setRunning(true);
      let start: number | null = null;
      const tick = (now: number) => {
        if (cancelled) return;
        start ??= now;
        const k = Math.min(1, (now - start) / ms);
        // ease in and out a little, so starting and stopping do not look mechanical
        const e = k < 0.12 ? (k / 0.12) ** 2 * 0.06 : k > 0.88 ? 1 - ((1 - k) / 0.12) ** 2 * 0.06 : 0.06 + ((k - 0.12) / 0.76) * 0.88;
        place(from + (to - from) * e);
        if (k < 1) raf.current = requestAnimationFrame(tick);
        else step();
      };
      raf.current = requestAnimationFrame(tick);
    };
    timer.current = window.setTimeout(step, 1200);

    const onResize = () => place(clampStroll(x.current, width(), SIZE));
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
      cancelAnimationFrame(raf.current);
      window.removeEventListener("resize", onResize);
      setRunning(false);
    };
  }, [active, reduced, place]);

  useEffect(() => () => window.clearTimeout(helloTimer.current), []);

  if (!active) return null;

  const sayHello = () => {
    // near an edge the bubble opens towards the middle of the screen, so it is never cut off
    const nx = x.current;
    setHelloSide(nx < 90 ? "left" : nx > window.innerWidth - SIZE - 120 ? "right" : "center");
    setHop((n) => n + 1);
    setHello(true);
    window.clearTimeout(helloTimer.current);
    helloTimer.current = window.setTimeout(() => setHello(false), HELLO_MS);
  };

  const hide = () => {
    try {
      window.sessionStorage.setItem(HIDDEN_KEY, "1");
    } catch {
      /* hidden for this render only */
    }
    setHidden(true);
  };

  return (
    <div aria-hidden={false} className="pointer-events-none fixed inset-x-0 bottom-0 z-[45] h-[96px]" data-slot="lil-cosmo-stroll">
      <style>{`
        .lc-bob { animation: lc-bob 2.4s ease-in-out infinite; transform-origin: 50% 100%; }
        .lc-hop { animation: lc-hop .6s cubic-bezier(.3,.7,.4,1) 1; transform-origin: 50% 100%; }
        @keyframes lc-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        @keyframes lc-hop { 0% { transform: translateY(0) scale(1.08,.9) } 40% { transform: translateY(-22px) scale(.95,1.06) } 75% { transform: translateY(0) scale(1.05,.94) } 100% { transform: translateY(0) scale(1) } }
        @keyframes lc-pop { 0% { opacity: 0; transform: translate(-50%, 6px) scale(.9) } 100% { opacity: 1; transform: translate(-50%, 0) scale(1) } }
        @keyframes lc-pop-side { 0% { opacity: 0; transform: translateY(6px) scale(.9) } 100% { opacity: 1; transform: translateY(0) scale(1) } }
        .lc-x { opacity: 0; transition: opacity .15s ease-out; }
        .lc-pet:hover .lc-x, .lc-x:focus-visible { opacity: 1; }
        @media (hover: none) { .lc-x { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .lc-bob, .lc-hop { animation: none !important } }
      `}</style>
      <div ref={petRef} className="lc-pet absolute bottom-3 left-0 will-change-transform" style={{ width: SIZE, height: SIZE }}>
        {hello ? (
          <div
            role="status"
            className={`absolute bottom-[calc(100%+6px)] rounded-2xl bg-white/95 px-3 py-1.5 text-[13px] font-medium whitespace-nowrap text-[#0F1B2D] shadow-[0_10px_24px_-12px_rgba(20,40,90,0.5)] ring-1 ring-black/5 ${
              helloSide === "left" ? "left-0" : helloSide === "right" ? "right-0" : "left-1/2"
            }`}
            style={{
              animation: helloSide === "center" ? "lc-pop .18s ease-out both" : "lc-pop-side .18s ease-out both",
              transform: helloSide === "center" ? "translateX(-50%)" : undefined,
            }}
          >
            {t("crew.pet.stroll.hello")}
          </div>
        ) : null}
        <button
          type="button"
          onClick={sayHello}
          aria-label={t("crew.pet.stroll.label")}
          className="pointer-events-auto relative block h-full w-full cursor-pointer rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
        >
          <span key={hop} className={`absolute inset-0 ${hop > 0 ? "lc-hop" : ""}`}>
            {/* standing Cosmo and the running sprite cross-fade, so starting and stopping never blink */}
            <span
              className={`absolute inset-0 transition-opacity duration-150 ease-out motion-reduce:transition-none ${running ? "" : "lc-bob"}`}
              style={{ opacity: running ? 0 : 1 }}
            >
              <CosmoAvatar variant={0} state="idle" emotion="happy" amplitude={0} pose={hello ? "front" : "auto"} />
            </span>
            <RunSprite running={running} dir={dir} size={SIZE} />
          </span>
        </button>
        <button
          type="button"
          onClick={hide}
          aria-label={t("crew.pet.stroll.hide")}
          className="lc-x pointer-events-auto absolute -top-1 -right-1 flex size-6 items-center justify-center rounded-full bg-white/90 text-[#0F1B2D]/60 shadow ring-1 ring-black/10 outline-none hover:text-[#0F1B2D] focus-visible:ring-3 focus-visible:ring-ring/60"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
