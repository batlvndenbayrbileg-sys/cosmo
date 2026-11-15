import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimVoice,
  registerPlayer,
  setChannelEnvForTests,
  speakOnChannel,
  stopSideVoices,
  type ChannelAudio,
  type ChannelEnv,
} from "@/components/voice/channel";

/**
 * One voice at a time (src/components/voice/channel.ts): the SOS line, the emergency guide steps, the summary replay
 * and Cosmo's main player never talk over each other, and the browser voice is a fallback used once at most.
 */

interface FakeAudio extends ChannelAudio {
  url: string;
  paused: boolean;
  ended: () => void;
  error: () => void;
  resolvePlay: () => void;
  rejectPlay: (name: string) => void;
}

function fakeChannel() {
  const audios: FakeAudio[] = [];
  /** what the browser voice said, and whether it is still talking */
  const browser: Array<{ text: string; talking: boolean; end: () => void }> = [];
  const env: ChannelEnv = {
    audio: (url) => {
      let onEnded = () => {};
      let onError = () => {};
      let resolvePlay = () => {};
      let rejectPlay: (name: string) => void = () => {};
      const a: FakeAudio = {
        url,
        paused: true,
        play: () =>
          new Promise<void>((resolve, reject) => {
            a.paused = false;
            resolvePlay = resolve;
            rejectPlay = (name) => reject(Object.assign(new Error(name), { name }));
          }),
        pause: () => {
          // as in browsers: pausing before play() settled rejects it with AbortError
          a.paused = true;
          rejectPlay("AbortError");
        },
        onEnded: (cb) => {
          onEnded = cb;
        },
        onError: (cb) => {
          onError = cb;
        },
        ended: () => onEnded(),
        error: () => onError(),
        resolvePlay: () => resolvePlay(),
        rejectPlay: (name) => rejectPlay(name),
      };
      audios.push(a);
      return a;
    },
    browserVoice: (text, _lang, onEnd) => {
      const entry = { text, talking: true, end: () => onEnd() };
      browser.push(entry);
      return () => {
        entry.talking = false;
      };
    },
  };
  return { env, audios, browser };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

let f: ReturnType<typeof fakeChannel>;
beforeEach(() => {
  f = fakeChannel();
  setChannelEnvForTests(f.env);
});
afterEach(() => setChannelEnvForTests(null));

/** how many voices are making a sound right now */
const voicesNow = () => f.audios.filter((a) => !a.paused).length + f.browser.filter((b) => b.talking).length;

describe("the voice channel: exactly one voice at a time", () => {
  it("a new line silences the one before (the SOS line, then a guide step)", async () => {
    speakOnChannel("I've sent an urgent alert to Earth.", "en", "/sos.mp3");
    expect(voicesNow()).toBe(1);
    speakOnChannel("Check that the area is safe.", "en", "/step0.mp3");
    await tick();
    expect(f.audios[0].paused).toBe(true);
    expect(f.audios[1].paused).toBe(false);
    expect(voicesNow()).toBe(1);
    // the first line was stopped before it started: never voiced by the browser afterwards (AbortError)
    expect(f.browser).toEqual([]);
  });

  it("falls back to the browser voice once when the server voice fails, never twice", async () => {
    speakOnChannel("Step one.", "en", "/step.mp3");
    const a = f.audios[0];
    a.error(); // the element reports an error ...
    a.rejectPlay("NotSupportedError"); // ... and play() rejects too
    await tick();
    expect(f.browser.map((b) => b.text)).toEqual(["Step one."]);
    expect(a.paused).toBe(true);
    expect(voicesNow()).toBe(1);
  });

  it("a blocked or failed play() uses the browser voice; no URL goes straight to it", async () => {
    speakOnChannel("Offline line.", "mn", null);
    expect(f.audios).toEqual([]);
    expect(f.browser.map((b) => b.text)).toEqual(["Offline line."]);
    speakOnChannel("Blocked line.", "en", "/x.mp3");
    f.audios[0].rejectPlay("NotAllowedError");
    await tick();
    // the offline line was cancelled when the next one claimed the channel
    expect(f.browser.map((b) => [b.text, b.talking])).toEqual([
      ["Offline line.", false],
      ["Blocked line.", true],
    ]);
  });

  it("a stopped line stays silent: no browser voice after stop, even if the audio errors later", async () => {
    const line = speakOnChannel("Press hard and fast.", "en", "/cpr.mp3");
    line.stop();
    f.audios[0].error();
    await tick();
    expect(f.browser).toEqual([]);
    expect(voicesNow()).toBe(0);
  });

  it("stopping an old line leaves the newer one alone (a guide closing does not cut the next voice)", async () => {
    const first = speakOnChannel("First.", "en", "/1.mp3");
    speakOnChannel("Second.", "en", "/2.mp3");
    first.stop();
    await tick();
    expect(f.audios[1].paused).toBe(false);
  });

  it("a side voice stops Cosmo's main player; Cosmo starting stops the side voice", async () => {
    const cosmo = vi.fn();
    const unregister = registerPlayer(cosmo);
    speakOnChannel("Guide step.", "en", "/g.mp3");
    expect(cosmo).toHaveBeenCalledTimes(1);
    // Cosmo speaks (useSpeechPlayer.speak calls stopSideVoices first)
    stopSideVoices();
    await tick();
    expect(f.audios[0].paused).toBe(true);
    expect(f.browser).toEqual([]);
    unregister();
    speakOnChannel("Another step.", "en", "/h.mp3");
    expect(cosmo).toHaveBeenCalledTimes(1);
  });

  it("claimVoice: the replay of the summary is stopped by the next voice, and its release is harmless later", () => {
    const stopReplay = vi.fn();
    const release = claimVoice(stopReplay);
    speakOnChannel("SOS line.", "en", "/sos.mp3");
    expect(stopReplay).toHaveBeenCalledTimes(1);
    release(); // the replay ended by itself afterwards: the SOS line keeps the channel
    expect(f.audios[0].paused).toBe(false);
    stopSideVoices();
    expect(f.audios[0].paused).toBe(true);
    expect(stopReplay).toHaveBeenCalledTimes(1);
  });

  it("a line that ended frees the channel (stopping afterwards touches nothing)", () => {
    const line = speakOnChannel("Done soon.", "en", "/d.mp3");
    f.audios[0].resolvePlay();
    f.audios[0].ended();
    const replay = vi.fn();
    claimVoice(replay);
    line.stop();
    expect(replay).not.toHaveBeenCalled();
  });
});
