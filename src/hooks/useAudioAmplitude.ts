"use client";

/**
 * useAudioAmplitude(audio): 0..1 loudness of an <audio> element, for Cosmo's mouth.
 *
 * Per element (cached in a WeakMap in audio-graph.ts, because createMediaElementSource may only be
 * called once per element; a failed build is cached too and its context closed) it builds AudioContext -> MediaElementAudioSourceNode -> AnalyserNode (fftSize 256,
 * smoothingTimeConstant 0.6) -> destination, so the audio stays audible. While the element plays,
 * a requestAnimationFrame loop turns the analyser's time-domain buffer into an RMS level.
 *
 * The graph is built lazily on the first 'play' (or when the element is already playing), and the
 * context is resumed on every 'play'. Cleanup removes listeners and cancels the loop; the graph is
 * deliberately kept (disconnecting the source would silence the element).
 *
 * The audio must be same-origin (or CORS-enabled): a tainted element is read as silence by the
 * analyser. For speechSynthesis there is no element at all: use useSimulatedAmplitude instead.
 */
import { useEffect, useState } from "react";
import { SPEECH_GAIN, rmsToAmplitude } from "@/components/cosmo/amplitude";
import { ensureAudioGraph, getAudioGraph, type AudioGraph } from "@/components/cosmo/audio-graph";

function resume(graph: AudioGraph | null) {
  if (graph && graph.context.state === "suspended") {
    graph.context.resume().catch(() => {});
  }
}

export function useAudioAmplitude(audio: HTMLAudioElement | null): number {
  // keyed by element so a stale value never leaks to the next element
  const [reading, setReading] = useState<{ audio: HTMLAudioElement | null; value: number }>({
    audio: null,
    value: 0,
  });

  useEffect(() => {
    if (!audio) return;

    let raf = 0;
    let last = 0;
    const report = (value: number) => {
      last = value;
      setReading({ audio, value });
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const graph = getAudioGraph(audio);
      if (!graph) return;
      graph.analyser.getByteTimeDomainData(graph.buffer);
      const next = rmsToAmplitude(graph.buffer, SPEECH_GAIN);
      if (Math.abs(next - last) >= 0.01 || (next === 0 && last !== 0)) report(next);
    };

    const start = () => {
      if (raf) return;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (last !== 0) report(0);
    };

    const onPlay = () => {
      resume(ensureAudioGraph(audio));
      start();
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlay);
    audio.addEventListener("pause", stop);
    audio.addEventListener("ended", stop);
    audio.addEventListener("emptied", stop);
    if (!audio.paused && !audio.ended) onPlay();

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlay);
      audio.removeEventListener("pause", stop);
      audio.removeEventListener("ended", stop);
      audio.removeEventListener("emptied", stop);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
  }, [audio]);

  return reading.audio === audio ? reading.value : 0;
}
