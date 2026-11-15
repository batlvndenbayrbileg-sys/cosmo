"use client";

/**
 * The "/" screen: Cosmo the health helper, straight away, with no crew picker in front (team request 2026-11-15).
 *
 *  1. Nobody known yet: IdentifyStage greets in both languages and recognises the speaker from the first words.
 *  2. Then the assistant conversation (CheckInExperience with entry="assistant"): a helper who answers anything; the
 *     daily check-up opens only from its "Daily check-up" button or "start my daily check-up", and "back to assistant"
 *     returns, keeping the check-up's progress.
 *  3. The person is remembered for this tab (the signed session cookie, plus the display copy in sessionStorage). Another
 *     person is looked for when the voice clearly changes, when someone says "I'm Mira" / "би Бат", or from the name
 *     chip; the conversation then re-opens as that person (a fresh mount, so Cosmo changes look with its entry animation).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckInExperience } from "@/components/checkin/CheckInExperience";
import { fetchCrew, fetchSessionCrewId, postIdentify, postSession } from "@/components/checkin/api";
import { clearSelectedCrew, parseStoredCrew, readSelectedCrewRaw, saveSelectedCrew } from "@/components/crew/selectedCrew";
import { useI18n } from "@/i18n/I18nProvider";
import type { CrewPublic, Lang } from "@/lib/types";
import { voiceClearlyChanged } from "@/lib/voice/pitch";
import { IdentifyStage, type Resolved } from "./IdentifyStage";
import { forgetVoice, measureVoice, readRememberedVoice, rememberVoice } from "./voice";

type Stage =
  | { kind: "loading" }
  | { kind: "identify" }
  | { kind: "ready"; crew: CrewPublic; firstText: string | null; language?: Lang; welcome?: "quiet" | "back"; seq: number };

export function AssistantHome() {
  const { setLang } = useI18n();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [roster, setRoster] = useState<CrewPublic[]>([]);
  const seq = useRef(0);

  // who is already signed in on this tab: the cookie and the display copy must agree, otherwise listen first
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = parseStoredCrew(readSelectedCrewRaw());
      const sessionCrewId = await fetchSessionCrewId();
      if (cancelled) return;
      if (stored && sessionCrewId === stored.id) {
        setStage({ kind: "ready", crew: stored, firstText: null, seq: ++seq.current });
      } else {
        setStage({ kind: "identify" });
      }
    })();
    fetchCrew().then(
      (crew) => {
        if (!cancelled) setRoster(crew);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useCallback(
    (crew: CrewPublic, opts: { firstText: string | null; language?: Lang; welcome?: "quiet" | "back" }) => {
      saveSelectedCrew(crew);
      setLang(opts.language ?? crew.preferredLanguage);
      setStage({ kind: "ready", crew, firstText: opts.firstText, language: opts.language, welcome: opts.welcome, seq: ++seq.current });
    },
    [setLang],
  );

  const resolved = useCallback(
    (r: Resolved) => open(r.crew, { firstText: r.firstText, language: r.language, welcome: r.firstText ? "quiet" : "back" }),
    [open],
  );

  /** another person, by id (a correction by voice, or a tap on the name chip) */
  const switchTo = useCallback(
    async (crewId: string | null, firstText: string | null = null) => {
      if (crewId === null) {
        clearSelectedCrew();
        forgetVoice();
        setStage({ kind: "identify" });
        return;
      }
      const list = roster.length > 0 ? roster : await fetchCrew().catch(() => [] as CrewPublic[]);
      const crew = list.find((c) => c.id === crewId);
      if (!crew) return;
      try {
        await postSession(crew.id);
      } catch {
        return;
      }
      const remembered = readRememberedVoice();
      rememberVoice({ crewId: crew.id, voice: remembered?.crewId === crew.id ? remembered.voice : "unknown" });
      open(crew, { firstText, welcome: firstText ? "quiet" : "back" });
    },
    [roster, open],
  );

  const current = stage.kind === "ready" ? stage.crew : null;

  /**
   * Every utterance during the conversation: the voice is measured on the device first. A clearly different voice is
   * re-identified (its words then open the other person's conversation); otherwise the words go on as usual.
   * Returns true when the utterance was handled here, or the transcript to send as text, or null (send the audio).
   */
  const routeUtterance = useCallback(
    async (blob: Blob): Promise<true | string | null> => {
      if (!current) return null;
      const voice = await measureVoice(blob);
      const remembered = readRememberedVoice();
      const known = remembered?.crewId === current.id ? remembered.voice : null;
      if (!voiceClearlyChanged(known, voice)) {
        if (voice !== "unknown" && (known === null || known === "unknown")) rememberVoice({ crewId: current.id, voice });
        return null;
      }
      try {
        const r = await postIdentify({ audio: blob, voice, previous: current.id });
        if (r.crew && r.crew.id !== current.id) {
          rememberVoice({ crewId: r.crew.id, voice });
          open(r.crew, { firstText: r.transcript, language: r.language, welcome: "quiet" });
          return true;
        }
        // the same person after all (or nobody else of that language): their words go on, without a second recognition
        if (r.crew) rememberVoice({ crewId: r.crew.id, voice: known ?? voice });
        return r.transcript;
      } catch {
        return null;
      }
    },
    [current, open],
  );

  if (stage.kind === "loading") return <div className="aegis-bg fixed inset-0" aria-busy="true" />;
  if (stage.kind === "identify") return <IdentifyStage onResolved={resolved} />;
  return (
    <CheckInExperience
      key={stage.seq}
      entry="assistant"
      assistant={{
        crew: stage.crew,
        roster,
        firstText: stage.firstText,
        language: stage.language,
        welcome: stage.welcome,
        onIdentity: (crewId) => void switchTo(crewId),
        onChoose: (crew) => void switchTo(crew.id),
        onNoSession: () => void switchTo(null),
        routeUtterance,
      }}
    />
  );
}
