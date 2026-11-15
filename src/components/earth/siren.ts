/**
 * The Earth console's SOS alarm: a two-tone siren made with WebAudio (no sound file). One burst is about 1.6 s of
 * alternating 960 / 640 Hz; `start()` repeats it every few seconds until `stop()`. Browsers keep an AudioContext
 * suspended until the page has had a click or key press: `state()` says so and `unlock()` (called from a user
 * gesture) resumes it.
 */

const BURST_S = 1.6;
const STEP_S = 0.2;
const REPEAT_MS = 4_500;
const HIGH_HZ = 960;
const LOW_HZ = 640;
const VOLUME = 0.12;

type AudioContextCtor = typeof AudioContext;

export interface Siren {
  start(): void;
  stop(): void;
  /** call from a click / key handler */
  unlock(): Promise<void>;
  state(): "running" | "suspended" | "unsupported";
  dispose(): void;
}

/** the tone schedule of one burst: [offset in seconds, frequency] (pure, for tests) */
export function sirenSchedule(burstS = BURST_S, stepS = STEP_S): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i * stepS < burstS - 1e-9; i++) out.push([Number((i * stepS).toFixed(3)), i % 2 === 0 ? HIGH_HZ : LOW_HZ]);
  return out;
}

export function createSiren(): Siren {
  const Ctor: AudioContextCtor | undefined =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext);
  let ctx: AudioContext | null = null;
  let timer: number | null = null;

  const context = (): AudioContext | null => {
    if (!Ctor) return null;
    try {
      ctx ??= new Ctor();
    } catch {
      return null;
    }
    return ctx;
  };

  const burst = () => {
    const c = context();
    if (!c || c.state !== "running") return;
    const t0 = c.currentTime + 0.02;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sawtooth";
    for (const [at, hz] of sirenSchedule()) osc.frequency.setValueAtTime(hz, t0 + at);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(VOLUME, t0 + 0.05);
    gain.gain.setValueAtTime(VOLUME, t0 + BURST_S - 0.1);
    gain.gain.linearRampToValueAtTime(0, t0 + BURST_S);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + BURST_S + 0.05);
  };

  return {
    start() {
      if (timer !== null) return;
      burst();
      timer = window.setInterval(burst, REPEAT_MS);
    },
    stop() {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    },
    async unlock() {
      const c = context();
      if (c && c.state === "suspended") await c.resume().catch(() => undefined);
    },
    state() {
      const c = context();
      if (!c) return "unsupported";
      return c.state === "running" ? "running" : "suspended";
    },
    dispose() {
      this.stop();
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}
