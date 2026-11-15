/**
 * A very short, soft "got it" sound the moment an utterance is sent, so the person knows at once that Cosmo heard
 * the end of what they said (speech-to-text and the reply take a second or two after that). Synthesised with Web
 * Audio: no file, no network, about 120 ms. Never throws; a browser without Web Audio simply stays silent.
 */

let shared: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (shared && shared.state !== "closed") return shared;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    shared = new Ctor();
  } catch {
    shared = null;
  }
  return shared;
}

/** Two quick rising notes (A5, then E6), very quiet. */
export function playHeardEarcon(): void {
  const ctx = context();
  if (!ctx) return;
  try {
    void ctx.resume().catch(() => {});
    const now = ctx.currentTime + 0.01;
    const notes: Array<[hz: number, at: number]> = [
      [880, 0],
      [1318.5, 0.06],
    ];
    for (const [hz, at] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(0.045, now + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.09);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.1);
    }
  } catch {
    // no sound is fine
  }
}
