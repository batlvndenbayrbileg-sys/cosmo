"use client";

/**
 * The on-device voice guess for "who is speaking" (src/lib/identity.ts). The recorded utterance is decoded in the
 * browser, its pitch is measured (src/lib/voice/pitch.ts: autocorrelation on the voiced frames, median), and only the
 * derived class leaves this module. The samples and the pitch are never sent anywhere and never stored.
 *
 * The person last recognised and their voice class are remembered for this tab (sessionStorage, no health data), so a
 * new person is looked for only when the voice clearly changes (both guesses confident and different) or on "switch".
 */
import { classifyVoice, estimatePitch, type VoiceClass } from "@/lib/voice/pitch";

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & { webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** "female" / "male" / "unknown" for a recorded utterance; "unknown" whenever decoding is not possible */
export async function measureVoice(blob: Blob): Promise<VoiceClass> {
  const Ctor = audioContextCtor();
  if (!Ctor || blob.size === 0) return "unknown";
  let ctx: AudioContext | null = null;
  try {
    ctx = new Ctor();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = buffer.numberOfChannels;
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / channels;
    }
    return classifyVoice(estimatePitch(mono, buffer.sampleRate).medianHz);
  } catch {
    return "unknown";
  } finally {
    void ctx?.close().catch(() => {});
  }
}

const VOICE_KEY = "cosmo.voice";

export interface RememberedVoice {
  crewId: string;
  voice: VoiceClass;
}

export function readRememberedVoice(): RememberedVoice | null {
  try {
    const raw = window.sessionStorage.getItem(VOICE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.crewId !== "string") return null;
    const voice = v.voice === "female" || v.voice === "male" ? v.voice : "unknown";
    return { crewId: v.crewId, voice };
  } catch {
    return null;
  }
}

export function rememberVoice(value: RememberedVoice): void {
  try {
    window.sessionStorage.setItem(VOICE_KEY, JSON.stringify(value));
  } catch {
    // not remembered: a voice change is simply not looked for
  }
}

export function forgetVoice(): void {
  try {
    window.sessionStorage.removeItem(VOICE_KEY);
  } catch {
    // nothing to forget
  }
}
