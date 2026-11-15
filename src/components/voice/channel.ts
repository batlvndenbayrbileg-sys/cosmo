/**
 * One voice at a time, ever. Cosmo's main player (useSpeechPlayer) and every other voice in the tab (the emergency
 * guide steps, the dashboard's summary replay, the SOS line when no main player is mounted) share this channel:
 *
 *  - a side voice claims the channel before it makes a sound (claimVoice / speakOnChannel); that silences the side
 *    voice speaking before it AND every main player that is speaking;
 *  - the main player calls stopSideVoices() whenever it starts or stops, so a side voice never talks over Cosmo.
 *
 * The server voice falls back to the browser voice at most once per line, and never after the line was stopped or
 * replaced: pausing an <audio> whose play() is still pending rejects that play() with AbortError, which used to start
 * the browser voice for the old line on top of the new one (two voices on every quick step change, and on every guide
 * opened in development, where React runs effects twice).
 */
import type { Lang } from "@/lib/types";

type Stop = () => void;

/** stoppers of the mounted main players (useSpeechPlayer); each stops only when it is speaking */
const players = new Set<Stop>();
/** the side voice speaking now */
let side: { stop: Stop } | null = null;

/** useSpeechPlayer registers its stop while mounted; returns the unregister function */
export function registerPlayer(stop: Stop): () => void {
  players.add(stop);
  return () => {
    players.delete(stop);
  };
}

function safely(fn: Stop): void {
  try {
    fn();
  } catch {
    /* already stopped */
  }
}

/** silences the side voice speaking now (a guide step, the summary replay, the SOS line), if any */
export function stopSideVoices(): void {
  const prev = side;
  side = null;
  if (prev) safely(prev.stop);
}

/**
 * Becomes the one voice: the side voice before it and every speaking main player are stopped first. Returns the
 * release function (call it when the voice ends by itself; it does nothing once another voice has taken over).
 */
export function claimVoice(stop: Stop): () => void {
  stopSideVoices();
  for (const p of [...players]) safely(p);
  const token = { stop };
  side = token;
  return () => {
    if (side === token) side = null;
  };
}

/** what speakOnChannel needs from the browser (replaced in tests) */
export interface ChannelEnv {
  /** an <audio> for `url`; null when there is no Audio */
  audio: (url: string) => ChannelAudio | null;
  /** the browser voice; `onEnd` when it finished (or failed); returns a cancel function. null: no browser voice */
  browserVoice: (text: string, lang: Lang, onEnd: () => void) => Stop | null;
}

export interface ChannelAudio {
  play: () => Promise<void>;
  pause: () => void;
  onEnded: (cb: () => void) => void;
  onError: (cb: () => void) => void;
}

const browserEnv: ChannelEnv = {
  audio: (url) => {
    if (typeof Audio === "undefined") return null;
    const el = new Audio(url);
    return {
      play: () => el.play(),
      pause: () => {
        el.pause();
        el.removeAttribute("src");
        el.load();
      },
      onEnded: (cb) => el.addEventListener("ended", cb, { once: true }),
      onError: (cb) => el.addEventListener("error", cb, { once: true }),
    };
  },
  browserVoice: (text, lang, onEnd) => {
    const s = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
    if (!s || typeof SpeechSynthesisUtterance === "undefined") return null;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === "mn" ? "mn-MN" : "en-US";
      u.onend = onEnd;
      u.onerror = onEnd;
      s.cancel();
      s.speak(u);
      return () => s.cancel();
    } catch {
      return null;
    }
  },
};

let env: ChannelEnv = browserEnv;

/** tests only: replace the browser parts (null restores them); also forgets every voice */
export function setChannelEnvForTests(next: ChannelEnv | null): void {
  env = next ?? browserEnv;
  side = null;
  players.clear();
}

export interface VoiceHandle {
  /** stops this line if it is still the one speaking (a later line is left alone) */
  stop: () => void;
}

/**
 * Says one line on the channel: the server voice at `audioUrl`, else (or when it fails) the browser voice, once.
 * `audioUrl` null goes straight to the browser voice; with no browser voice the text simply stays on screen.
 */
export function speakOnChannel(text: string, lang: Lang, audioUrl: string | null): VoiceHandle {
  let over = false;
  let fellBack = false;
  let audio: ChannelAudio | null = null;
  let cancelBrowser: Stop | null = null;

  const end = () => {
    over = true;
    release();
  };
  const halt = () => {
    over = true;
    if (audio) safely(audio.pause);
    if (cancelBrowser) safely(cancelBrowser);
  };
  const release = claimVoice(halt);

  const fallback = () => {
    if (over || fellBack) return;
    fellBack = true;
    if (audio) safely(audio.pause);
    cancelBrowser = env.browserVoice(text, lang, end);
    if (!cancelBrowser) end();
  };

  if (audioUrl) audio = env.audio(audioUrl);
  if (!audio) {
    fallback();
  } else {
    audio.onEnded(end);
    audio.onError(fallback);
    audio.play().catch((error: unknown) => {
      // AbortError: this line was paused (stopped or replaced) before it started; never voice it afterwards
      if ((error as { name?: unknown } | null)?.name === "AbortError") return;
      fallback();
    });
  }

  return {
    stop: () => {
      if (over) return;
      halt();
      release();
    },
  };
}
