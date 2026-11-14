"use client";

/**
 * Run demo: fetches GET /api/demo/script?lang= and replays the CREW side through the SAME turn
 * endpoint a typed answer uses (sendText), so the real pipeline, cards and speech all run. Pacing is
 * natural: wait until Cosmo has finished, pause 1.0-1.5 s, "type" the utterance into the transcript,
 * send it. Stops by itself when the conversation is finished (the dashboard takes over).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDemoScript } from "./api";
import { abortableSleep, demoGapMs, typingPlan, waitUntil } from "./demo";
import type { Lang } from "@/lib/types";

/** A turn that never goes quiet (stalled network, speech that never ends) must not hang the demo. */
const IDLE_TIMEOUT_MS = 60_000;

export interface DemoRunnerDeps {
  language: Lang;
  sendText: (text: string) => Promise<boolean>;
  setTyping: (text: string | null) => void;
  /** latest screen facts; called at run time, never during render */
  readLive: () => { idle: boolean; finished: boolean };
  /** silence the microphone and any speech before the first utterance */
  onStart: () => void;
}

export interface DemoRunner {
  running: boolean;
  /** the script could not be loaded or the run broke off */
  failed: boolean;
  run: () => Promise<void>;
  stop: () => void;
}

export function useDemoRunner(deps: DemoRunnerDeps): DemoRunner {
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);
  const controller = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    controller.current?.abort();
  }, []);

  const run = useCallback(async (): Promise<void> => {
    if (controller.current) return;
    const mine = new AbortController();
    controller.current = mine;
    const { signal } = mine;
    setRunning(true);
    setFailed(false);
    depsRef.current.onStart();

    try {
      const script = await fetchDemoScript(depsRef.current.language);
      for (const utterance of script.utterances) {
        const live = () => depsRef.current.readLive();
        // wait for Cosmo (the greeting, then every reply) to finish before the next utterance
        if (!(await waitUntil(() => live().idle || live().finished, signal, { timeoutMs: IDLE_TIMEOUT_MS }))) break;
        if (live().finished) break;
        if (!(await abortableSleep(demoGapMs(Math.random()), signal))) break;

        const plan = typingPlan(utterance);
        let aborted = false;
        for (const frame of plan.frames) {
          depsRef.current.setTyping(frame);
          if (!(await abortableSleep(plan.frameMs, signal))) {
            aborted = true;
            break;
          }
        }
        if (aborted) break;
        const sent = await depsRef.current.sendText(utterance);
        if (!sent) break;
      }
    } catch {
      if (!signal.aborted) setFailed(true);
    } finally {
      depsRef.current.setTyping(null);
      if (controller.current === mine) controller.current = null;
      setRunning(false);
    }
  }, []);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  return { running, failed, run, stop };
}
