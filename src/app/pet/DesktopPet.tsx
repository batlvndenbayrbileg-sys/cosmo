"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CosmoAvatar } from "@/components/cosmo/CosmoAvatar";
import { usePrefersReducedMotion } from "@/components/cosmo/usePrefersReducedMotion";
import { fetchCrew, postSession, turnAudioUrl } from "@/components/checkin/api";
import { BLAZE_FACE_MODEL_URL, MEDIAPIPE_WASM_URL } from "@/components/checkin/face-camera";
import { faceFollowPref } from "@/components/checkin/face-follow-pref";
import { useCheckIn } from "@/hooks/useCheckIn";
import { useRecorder } from "@/hooks/useRecorder";
import { useSpeechPlayer, type SpeakTurn } from "@/hooks/useSpeechPlayer";
import { useI18n } from "@/i18n/I18nProvider";
import { displayName } from "@/lib/identity";
import type { PetMenuInfo } from "@/lib/pet/bridge";
import { explainLines } from "@/lib/pet/explain";
import { isPetCrewId } from "@/lib/pet/link";
import type { CrewPublic } from "@/lib/types";
import { RunSprite } from "@/components/pet/RunSprite";
import { nextWanderFrac, wanderRestMs } from "@/lib/pet/stroll";

const MIN_AUDIO_BYTES = 2000;
const RELISTEN_DELAY_MS = 300;
/** the window's size (electron/main.cjs keeps it on the bottom edge): just Cosmo, or Cosmo with the text box */
const SIZE_IDLE = { w: 140, h: 140 };
const SIZE_TYPING = { w: 250, h: 220 };

/**
 * Camera: find the face (MediaPipe, runs locally, nothing is sent anywhere). Turns Cosmo's head toward it with a
 * smoothed 3D tilt written straight to the element's style (no React renders), and when the user has clearly moved
 * to another part of the room, asks the main process to run there along the bottom of the screen.
 * Off unless turned on (the same remembered choice as the website's "Cosmo looks at you"). Reduced motion: she still
 * follows along the screen edge, without the head tilt.
 */
function useFaceFollow(target: React.RefObject<HTMLDivElement | null>, enabled: boolean, reducedMotion: boolean) {
  useEffect(() => {
    if (!enabled) return; // camera off: the stream is never opened (and is stopped by the cleanup below)
    let stop = false;
    let stream: MediaStream | null = null;
    // MediaPipe's wasm reports its info lines through console.error, which Next's dev overlay counts as "issues"
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === "string" && /gl_context|inference_feedback_manager|INFO:|XNNPACK/.test(args[0])) return;
      realError(...args);
    };
    let detector: { close(): void } | null = null;
    (async () => {
      try {
        const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const d = await FaceDetector.createFromOptions(await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL), {
          baseOptions: { modelAssetPath: BLAZE_FACE_MODEL_URL },
          runningMode: "VIDEO",
        });
        detector = d;
        if (stop) return d.close();
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, frameRate: 15 } });
        // turned off (or unmounted) while the camera was opening: the cleanup already ran, so close it here
        if (stop) {
          s.getTracks().forEach((t) => t.stop());
          return d.close();
        }
        stream = s;
        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        let x = 0;
        let y = 0;
        let tx = 0;
        let ty = 0;
        let last = 0;
        let committed: number | null = null;
        let away = 0;
        const tick = (now: number) => {
          if (stop) return d.close(); // turning the camera on again makes a new one
          // ~8 detections a second is plenty for a head turn and keeps the CPU quiet
          if (now - last > 120 && video.videoWidth) {
            last = now;
            const box = d.detectForVideo(video, now).detections[0]?.boundingBox;
            if (box) {
              // mirrored like a mirror: the user's right is screen right
              const at = 1 - (box.originX + box.width / 2) / video.videoWidth;
              // Run only when the user has clearly moved to another part of the room: ignore anything within
              // 22% of the frame from where Cosmo last went, and need 3 detections in a row to be sure.
              if (committed === null) committed = at;
              else if (Math.abs(at - committed) > 0.22) {
                if (++away >= 3) {
                  committed = at;
                  away = 0;
                  window.cosmoPet?.goTo(at);
                }
              } else away = 0;
              tx = Math.max(-1, Math.min(1, 2 * at - 1));
              ty = Math.max(-1, Math.min(1, 2 * ((box.originY + box.height / 2) / video.videoHeight) - 1));
            } else {
              tx = 0;
              ty = 0;
            }
          }
          const nx = x + (tx - x) * 0.1;
          const ny = y + (ty - y) * 0.1;
          // skip style writes once settled (and always under reduced motion)
          if (!reducedMotion && (Math.abs(nx - x) > 0.001 || Math.abs(ny - y) > 0.001)) {
            x = nx;
            y = ny;
            const el = target.current;
            if (el) el.style.transform = `perspective(500px) translate(${x * 6}px, ${y * 3}px) rotateY(${x * 18}deg) rotateX(${-y * 10}deg)`;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } catch {
        // no camera / blocked / model missing: the pet simply does not follow; free what was already made
        stream?.getTracks().forEach((t) => t.stop());
        detector?.close();
      }
    })();
    const el = target.current;
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
      console.error = realError;
      if (el) el.style.transform = "";
    };
  }, [target, enabled, reducedMotion]);
}

/**
 * The desktop pet in the Electron overlay (electron/main.cjs). Cosmo lives on the bottom edge of the screen, runs
 * (12-frame sprite) to wherever the camera sees the user, and talks hands-free with the crew member in `?crew=`, in
 * the same assistant conversation as the website's "/" screen (the daily check-up starts when asked for).
 * No buttons on screen:
 *  - a tap wakes her and she speaks at once (the conversation is opened when the pet starts and the greeting audio is
 *    fetched ahead of time); awake, she listens again after every sentence; a tap or a long silence ends it;
 *  - right-click opens the menu: talk, write (a small text box), camera, dashboard, switch profile, quit;
 *  - "open my dashboard" (assistant action) opens the dashboard in its own window; a walkthrough ("how am I today?")
 *    is said beat by beat; "I'm Mira" switches the pet to Mira.
 */
export function DesktopPet({ crewId }: { crewId: string | null }) {
  const { t, lang, setLang } = useI18n();
  const reducedMotion = usePrefersReducedMotion();
  const [roster, setRoster] = useState<CrewPublic[]>([]);
  const [active, setActive] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [issue, setIssue] = useState<"server" | "micBlocked" | "mic" | null>(null);
  const [hop, setHop] = useState(false);
  /** a one-off idle trick; `wave` shows the waving render, `look` the three-quarter one */
  const [trick, setTrick] = useState<"wave" | "look" | "dance" | "jump" | null>(null);
  // without a profile she is not asleep any more: she wanders the screen edge, and a tap opens the menu to pick one
  const [sleeping, setSleeping] = useState(false);
  const [moving, setMoving] = useState(false);
  const [dir, setDir] = useState(1);
  const press = useRef<{ x: number; moved: boolean } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);
  const speakRef = useRef<ReturnType<typeof useSpeechPlayer>["speak"] | null>(null);
  /** the greeting made while she was asleep, voiced the moment she wakes */
  const pendingGreeting = useRef<SpeakTurn | null>(null);
  /** Cosmo's last line while the conversation is still open (a resumed one has no new greeting) */
  const lastQuestion = useRef<SpeakTurn | null>(null);
  /** bumped to cut a walkthrough short (a tap, a new turn) */
  const explainRun = useRef(0);
  const camera = useSyncExternalStore(faceFollowPref.subscribe, faceFollowPref.read, () => false);
  useFaceFollow(bodyRef, camera && crewId !== null, reducedMotion);

  useEffect(() => {
    document.documentElement.setAttribute("data-pet", "");
    return () => document.documentElement.removeAttribute("data-pet");
  }, []);

  const openDashboard = useCallback((checkInId: string | null) => {
    if (checkInId) window.cosmoPet?.openDashboard(`/dashboard?checkInId=${encodeURIComponent(checkInId)}`);
  }, []);

  const checkIn = useCheckIn({
    // the assistant conversation, like "/"; the crew member's own language
    assistant: {},
    onAssistant: (turn) => {
      const line: SpeakTurn = { checkInId: turn.checkInId, turnId: turn.turnId, text: turn.text, language: turn.language };
      if (activeRef.current) {
        void speakRef.current?.(line);
        return;
      }
      // opened ahead of time: keep the greeting for the wake-up and warm the audio cache now
      pendingGreeting.current = line;
      void fetch(turnAudioUrl(turn.checkInId, turn.turnId), { credentials: "same-origin" }).catch(() => {});
    },
    onSummary: (summary, checkInId) => {
      if (!activeRef.current) return; // stopped while it was on its way
      void speakRef.current?.({ checkInId, turnId: summary.audioTurnId, text: summary.spoken.text, language: summary.spoken.language });
    },
    // no screen for the walkthrough's panels: she says it, beat after beat
    onExplain: (explain, checkInId) => {
      if (!activeRef.current) return;
      const run = ++explainRun.current;
      void (async () => {
        for (const line of explainLines(explain, checkInId)) {
          if (explainRun.current !== run || !activeRef.current) return;
          await speakRef.current?.(line);
        }
      })();
    },
    onAction: (action) => {
      if (action.kind === "dashboard") openDashboard(action.checkInId);
      // "I'm Mira": the pet becomes Mira's (a reload signs her in); "someone else" without a name keeps the pet as is
      else if (action.kind === "identity" && isPetCrewId(action.crewId) && action.crewId !== crewId) {
        window.location.replace(`/pet?crew=${encodeURIComponent(action.crewId)}`);
      }
    },
  });
  const { state, setSpeech, setRecording, sendAudio, sendText, createCheckIn } = checkIn;

  const player = useSpeechPlayer({ onStatusChange: setSpeech });
  const recorder = useRecorder({
    onUtterance: (blob) => {
      if (blob.size >= MIN_AUDIO_BYTES && activeRef.current) void sendAudio(blob);
    },
    onRecordingChange: setRecording,
    onError: (e) => {
      setIssue(e.kind === "denied" ? "micBlocked" : "mic");
      setActive(false);
    },
    onNoSpeech: () => setActive(false), // silence for a while: fall asleep; a touch wakes her
  });
  const { speak, stop: stopSpeech } = player;
  const { start: startRecorder, cancel: cancelRecorder } = recorder;
  useEffect(() => {
    speakRef.current = speak;
  }, [speak]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const current = roster.find((c) => c.id === crewId) ?? null;
  // she speaks the crew member's language; the menu and her little notes follow it
  useEffect(() => {
    if (current) setLang(current.preferredLanguage);
  }, [current, setLang]);

  /** one conversation per pet session; the signed session cookie lives in this window */
  const ensureCheckIn = useCallback(async () => {
    if (state.status === "ready") return true;
    if (crewId === null) return false;
    try {
      await postSession(crewId);
      await createCheckIn();
      return true;
    } catch {
      setIssue("server");
      return false;
    }
  }, [state.status, createCheckIn, crewId]);

  // open the conversation as soon as the pet starts, so waking her up only has to play the greeting
  useEffect(() => {
    if (crewId !== null) {
      void postSession(crewId)
        .then(() => createCheckIn())
        .catch(() => {});
    }
    void fetchCrew()
      .then(setRoster)
      .catch(() => {});
  }, [createCheckIn, crewId]);

  const toggle = useCallback(async () => {
    if (crewId === null) return; // no profile yet: the tap opens the menu instead (onPointerUp)
    setIssue(null);
    if (activeRef.current && state.status !== "failed") {
      setActive(false);
      explainRun.current++;
      cancelRecorder();
      stopSpeech();
      return;
    }
    activeRef.current = true; // before the await: a greeting arriving now is spoken, not stored
    setActive(true);
    setSleeping(false);
    setTrick(null);
    setHop(true);
    setTimeout(() => setHop(false), 700);
    // a fresh conversation: the greeting made ahead of time; a resumed one: say the last line again
    const greeting = pendingGreeting.current ?? lastQuestion.current;
    pendingGreeting.current = null;
    if (greeting) void speak(greeting);
    if (!(await ensureCheckIn())) {
      activeRef.current = false;
      setActive(false);
    }
  }, [crewId, state.status, ensureCheckIn, cancelRecorder, stopSpeech, speak]);

  const submitText = async () => {
    const text = draft.trim();
    if (!text || state.busy) return; // one turn at a time: keep the draft until the reply is in
    setDraft("");
    explainRun.current++;
    cancelRecorder();
    stopSpeech();
    if (!activeRef.current) {
      activeRef.current = true; // a written question is answered out loud too
      setActive(true);
      setSleeping(false);
    }
    if (await ensureCheckIn()) void sendText(text);
  };

  // animation director: while idle, now and then do a trick; after a long quiet, doze off
  useEffect(() => {
    if (active || hop || moving || crewId === null) return;
    const tricks = ["wave", "look", "dance", "jump"] as const;
    let off: ReturnType<typeof setTimeout>;
    const next = () => {
      off = setTimeout(() => {
        setTrick(tricks[Math.floor(Math.random() * tricks.length)]);
        off = setTimeout(() => {
          setTrick(null);
          next();
        }, 2200);
      }, 5000 + Math.random() * 7000);
    };
    if (!sleeping && !reducedMotion) next();
    const nap = setTimeout(() => setSleeping(true), 45_000);
    return () => {
      clearTimeout(off);
      clearTimeout(nap);
    };
  }, [active, hop, moving, sleeping, crewId, reducedMotion]);

  // wandering: while nobody is talking to her, typing or being followed by the camera, she rests a few seconds, then
  // runs to another spot along the bottom of the screen (the main process moves the window, pet:goto). A run wakes
  // her from a doze; a long rest now and then lets her doze off again.
  const wanderAt = useRef(0.92);
  useEffect(() => {
    if (active || typing || reducedMotion || (camera && crewId !== null) || !window.cosmoPet) return;
    let off: ReturnType<typeof setTimeout>;
    const next = () => {
      off = setTimeout(() => {
        const to = nextWanderFrac(wanderAt.current, Math.random);
        wanderAt.current = to;
        setSleeping(false);
        setTrick(null);
        window.cosmoPet?.goTo(to);
        next();
      }, wanderRestMs(Math.random));
    };
    next();
    return () => clearTimeout(off);
  }, [active, typing, reducedMotion, camera, crewId]);

  // running is the main process moving the window; the page plays the sprite facing the way she goes
  useEffect(() => {
    const offDir = window.cosmoPet?.onDir((d) => setDir(d < 0 ? -1 : 1));
    const offMoving = window.cosmoPet?.onMoving((m) => setMoving(m === true));
    return () => {
      offDir?.();
      offMoving?.();
    };
  }, []);

  // writing: close the microphone (the hands-free loop below does not reopen it while typing)
  useEffect(() => {
    if (typing) cancelRecorder();
  }, [typing, cancelRecorder]);

  // the window grows upward to hold the text box (and Cosmo's last line)
  useEffect(() => {
    const size = typing ? SIZE_TYPING : SIZE_IDLE;
    window.cosmoPet?.resize(size.w, size.h);
  }, [typing]);

  // the right-click menu lives in the main process; its picks come back here
  const menuActions = useRef<Record<string, () => void>>({});
  useEffect(() => {
    menuActions.current = {
      talk: () => void toggle(),
      write: () => crewId !== null && setTyping((v) => !v),
      camera: () => faceFollowPref.write(!faceFollowPref.read()),
      dashboard: () => openDashboard(state.checkInId),
    };
  }, [toggle, openDashboard, crewId, state.checkInId]);
  useEffect(() => {
    // one listener only: without the cleanup, dev's double effect run made every toggle fire twice (= no change)
    return window.cosmoPet?.onAction((a) => menuActions.current[a]?.());
  }, []);

  const lastCosmo = [...state.transcript].reverse().find((l) => l.speaker === "cosmo");
  useEffect(() => {
    lastQuestion.current =
      lastCosmo && state.checkInId && state.conversation !== "DONE"
        ? { checkInId: state.checkInId, turnId: lastCosmo.id, text: lastCosmo.text, language: lastCosmo.language }
        : null;
  }, [lastCosmo, state.checkInId, state.conversation]);

  // hands-free: while awake, listen again once Cosmo has finished (never while she speaks)
  useEffect(() => {
    if (!active || typing || state.status !== "ready" || state.busy || state.speech !== "idle" || recorder.recording) {
      return;
    }
    const timer = setTimeout(() => void startRecorder({ vad: true }), RELISTEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, typing, state.status, state.busy, state.speech, recorder.recording, startRecorder]);

  // createCheckIn reports failure in state, not by throwing: show it and do not look awake (a tap retries)
  const failed = state.status === "failed";
  const awake = active && !failed;
  const shownIssue = issue ?? (failed ? "server" : null);
  const mood = hop
    ? "pet-hop"
    : awake
      ? { listening: "pet-listen", thinking: "pet-think", talking: "pet-talk", idle: "pet-alert" }[state.cosmoState]
      : sleeping
        ? "pet-sleep"
        : trick
          ? `pet-${trick}`
          : "pet-idle";

  const menu = (): PetMenuInfo => ({
    crew: roster.map((c) => ({ id: c.id, name: displayName(c, lang) })),
    current: crewId,
    active: awake,
    typing,
    camera,
    canDashboard: state.checkInId !== null,
    labels: {
      talk: t("crew.pet.menu.talk"),
      stop: t("crew.pet.menu.stop"),
      write: t("crew.pet.menu.write"),
      camera: t("crew.pet.menu.camera"),
      dashboard: t("crew.pet.menu.dashboard"),
      profile: t("crew.pet.menu.profile"),
      noProfiles: t("crew.pet.menu.noProfiles"),
      quit: t("crew.pet.menu.quit"),
    },
  });

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-end overflow-hidden"
      onContextMenu={(e) => {
        e.preventDefault();
        window.cosmoPet?.showMenu(menu());
      }}
    >
      <style>{`
        html[data-pet], html[data-pet] body, html[data-pet] .cosmo-bg { background: transparent !important; }
        html[data-pet] [data-slot="app-frame"] > :not(main) { display: none !important; }
        html[data-pet] nextjs-portal { display: none; }
        .pet-idle { animation: pet-bob 3.4s ease-in-out infinite; }
        .pet-alert { animation: pet-bob 1.8s ease-in-out infinite; }
        .pet-hop { animation: pet-hop .7s cubic-bezier(.3,.7,.4,1); }
        .pet-listen { animation: pet-pulse 1.1s ease-in-out infinite; }
        .pet-think { animation: pet-sway 1.6s ease-in-out infinite; }
        .pet-talk { animation: pet-talk .36s ease-in-out infinite; }
        .pet-sleep { animation: pet-snooze 4s ease-in-out infinite; }
        .pet-wave { animation: pet-wave 1.1s ease-in-out 2; }
        .pet-look { animation: pet-lean 2.2s ease-in-out 1; }
        .pet-dance { animation: pet-dance .55s ease-in-out 4; }
        .pet-jump { animation: pet-hop .7s cubic-bezier(.3,.7,.4,1) 3; }
        .pet-anim { transform-origin: 50% 100%; will-change: transform; }
        .pet-z { animation: pet-zzz 2s ease-in infinite; opacity: 0; }
        @keyframes pet-bob { 0%,100% { transform: translateY(0) scale(1,1) } 50% { transform: translateY(-3px) scale(1.01,.99) } }
        @keyframes pet-hop { 0% { transform: translateY(0) scale(1.06,.9) } 35% { transform: translateY(-16px) scale(.96,1.06) } 70% { transform: translateY(0) scale(1.04,.94) } 100% { transform: translateY(0) scale(1) } }
        @keyframes pet-pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.04) } }
        @keyframes pet-sway { 0%,100% { transform: rotate(-4deg) } 50% { transform: rotate(4deg) } }
        @keyframes pet-talk { 0%,100% { transform: translateY(0) scale(1,1) } 50% { transform: translateY(-3px) scale(.98,1.03) } }
        @keyframes pet-snooze { 0%,100% { transform: rotate(5deg) scale(.97,.95) translateY(3px) } 50% { transform: rotate(7deg) scale(.97,.97) translateY(1px) } }
        @keyframes pet-wave { 0%,100% { transform: rotate(0) } 25% { transform: rotate(-5deg) } 75% { transform: rotate(5deg) } }
        @keyframes pet-lean { 0%,100% { transform: rotate(0) translateX(0) } 30%,70% { transform: rotate(6deg) translateX(6px) } }
        @keyframes pet-dance { 0%,100% { transform: rotate(-8deg) translateY(0) } 50% { transform: rotate(8deg) translateY(-8px) } }
        @keyframes pet-zzz { 0% { transform: translate(0,0) scale(.6); opacity: 0 } 30% { opacity: 1 } 100% { transform: translate(8px,-22px) scale(1.2); opacity: 0 } }
        @media (prefers-reduced-motion: reduce) { .pet-anim, .pet-z { animation: none !important; } .pet-z { opacity: .8; } }
      `}</style>

      {typing && (
        <div className="mb-1 w-[230px] space-y-1">
          {lastCosmo && (
            <div className="max-h-[52px] overflow-hidden rounded-xl border border-white/80 bg-white/90 px-2.5 py-1 text-[11px] leading-snug text-[var(--cosmo-ink)] shadow-sm">
              {lastCosmo.text}
            </div>
          )}
          <input
            autoFocus
            value={draft}
            aria-label={t("crew.pet.write.placeholder")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitText();
              if (e.key === "Escape") setTyping(false);
            }}
            placeholder={t("crew.pet.write.placeholder")}
            className="w-full rounded-full bg-[var(--cosmo-ink)]/90 px-3 py-1.5 text-xs text-white outline-none placeholder:text-white/50 focus-visible:ring-2 focus-visible:ring-[var(--cosmo-accent)]/60"
          />
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        aria-label={crewId === null ? t("crew.pet.sleeping") : t("crew.pet.body")}
        title={crewId === null ? t("crew.pet.sleeping") : undefined}
        data-slot="pet-body"
        className="relative h-[124px] w-[124px] shrink-0 cursor-pointer touch-none outline-none select-none"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void toggle();
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return; // right button: the menu
          e.currentTarget.setPointerCapture(e.pointerId);
          press.current = { x: e.screenX, moved: false };
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p) return;
          if (!p.moved && Math.abs(e.screenX - p.x) < 5) return;
          p.moved = true;
          window.cosmoPet?.moveBy(e.screenX - p.x); // sideways only: she stays on the bottom edge
          p.x = e.screenX;
        }}
        onPointerUp={() => {
          // a touch (not a drag) wakes her / puts her to sleep
          // without a profile the tap opens the menu, where "Switch profile" lists the crew
          if (press.current && !press.current.moved) {
            if (crewId === null) window.cosmoPet?.showMenu(menu());
            else void toggle();
          }
          press.current = null;
        }}
        onPointerCancel={() => {
          press.current = null;
        }}
      >
        {/* standing Cosmo and the running sprite cross-fade, so starting and stopping never blink */}
        <div
          ref={bodyRef}
          className="h-full w-full transition-opacity duration-150 ease-out motion-reduce:transition-none"
          style={{ opacity: moving ? 0 : 1 }}
        >
          <div className={`pet-anim relative h-full w-full ${mood}`}>
            <CosmoAvatar
              variant={current?.mascotVariant ?? 0}
              state={awake ? state.cosmoState : "idle"}
              emotion={sleeping ? "neutral" : state.emotion}
              amplitude={player.amplitude}
              pose={hop || trick === "wave" ? "front" : trick === "look" || sleeping ? "three-quarter" : "auto"}
            />
            {sleeping && (
              <>
                <span className="pet-z absolute top-1 right-3 text-sm font-bold text-[#8fb4ff]">z</span>
                <span className="pet-z absolute top-3 right-0 text-xs font-bold text-[#8fb4ff] [animation-delay:1s]">z</span>
              </>
            )}
          </div>
        </div>
        <RunSprite running={moving} dir={dir} />
        {/* the microphone is open: a small green dot beside her (and only then) */}
        {recorder.recording && (
          <span role="status" aria-label={t("crew.pet.mic.on")} className="absolute top-3 right-1.5 flex size-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-3 rounded-full border-2 border-white bg-emerald-500 shadow" />
          </span>
        )}
      </div>
      {shownIssue && (
        <div role="alert" className="absolute top-1 w-full px-1 text-center text-[10px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
          {t(`crew.pet.issue.${shownIssue}`)}
        </div>
      )}
    </div>
  );
}
