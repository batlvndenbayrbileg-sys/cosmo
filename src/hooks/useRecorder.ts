"use client";

/**
 * useRecorder: microphone capture for the voice-first check-in.
 *
 *  - MediaRecorder with audio/webm;codecs=opus, falling back to the browser's default type.
 *  - Voice-activity detection: an AnalyserNode is sampled every 50 ms and fed to the pure state
 *    machine in components/checkin/vad.ts (900 ms of silence ends the utterance, 300 ms minimum
 *    speech, 30 s maximum). When VAD is off (push-to-talk) the caller ends the utterance.
 *  - Half-duplex: the microphone stream is opened per listen and released afterwards, so the mic is
 *    really closed while Cosmo speaks; the caller simply does not call start() until she is done.
 *  - Errors (permission denied, no device, unsupported browser) are reported through `onError`; the
 *    check-in screen then shows a FallbackBanner and stays in text mode.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { StartGate, capReached, recordingCapMs } from "@/components/checkin/recording";
import { pickRecorderMimeType } from "@/components/checkin/speech";
import {
  DEFAULT_VAD_CONFIG,
  createVadState,
  rmsFromSamples,
  stepVad,
  voicingFromSpectrum,
  type VadConfig,
  type VadState,
} from "@/components/checkin/vad";

export type MicPermission = "unknown" | "granted" | "denied" | "unsupported";

export interface RecorderError {
  kind: "denied" | "unsupported" | "device" | "failed";
  message?: string;
}

export interface UseRecorderOptions {
  /** a finished utterance (never called for discarded blips or cancelled recordings) */
  onUtterance: (blob: Blob) => void;
  onError?: (error: RecorderError) => void;
  /** VAD found nothing but silence for the no-speech timeout; the mic is already closed */
  onNoSpeech?: () => void;
  /** fired when recording starts or stops, in the same tick as `onUtterance` for a finished one */
  onRecordingChange?: (recording: boolean) => void;
  vad?: Partial<VadConfig>;
}

export interface StartOptions {
  /** true (default): the utterance ends by itself after silence. false: push-to-talk, call stop(). */
  vad?: boolean;
}

/** Tiny external store so the 20 Hz mic level re-renders only the component that draws it. */
export interface LevelStore {
  get: () => number;
  subscribe: (listener: () => void) => () => void;
}

export interface RecorderApi {
  /** the browser can record at all (getUserMedia + MediaRecorder) */
  supported: boolean;
  permission: MicPermission;
  recording: boolean;
  /** true when the current recording ends by itself (VAD), false for push-to-talk */
  autoStop: boolean;
  level: LevelStore;
  start: (options?: StartOptions) => Promise<boolean>;
  /** end the recording and send what was captured */
  stop: () => void;
  /** end the recording and throw it away */
  cancel: () => void;
}

const SAMPLE_MS = 50;
const TIMESLICE_MS = 250;

function createLevelStore(): LevelStore & { set: (value: number) => void } {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      // quantise to 1/10 so listeners only wake for visible changes
      const q = Math.round(Math.min(Math.max(next, 0), 1) * 10) / 10;
      if (q === value) return;
      value = q;
      listeners.forEach((l) => l());
    },
  };
}

function detectSupport(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}
const subscribeNever = () => () => {};

interface Session {
  stream: MediaStream;
  context: AudioContext | null;
  recorder: MediaRecorder;
  timer: ReturnType<typeof setInterval> | undefined;
  vad: VadState | null;
  mimeType: string | undefined;
  /** recorder.onstop of the current recorder reads these */
  send: boolean;
  ended: boolean;
  /** performance.now() when the recording started, for the hard cap */
  startedAt: number;
  /** hard cap of this recording in ms (see recordingCapMs) */
  capMs: number;
}

function errorKind(error: unknown): RecorderError["kind"] {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") {
    return "device";
  }
  return "failed";
}

export function useRecorder(options: UseRecorderOptions): RecorderApi {
  const supported = useSyncExternalStore(subscribeNever, detectSupport, () => true);
  const [permission, setPermission] = useState<MicPermission>("unknown");
  const [recording, setRecording] = useState(false);
  const [autoStop, setAutoStop] = useState(true);
  const [level] = useState(createLevelStore);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const session = useRef<Session | null>(null);
  /** a stop()/cancel() that arrives while getUserMedia is still pending is remembered here */
  const [gate] = useState(() => new StartGate());

  const emitRecording = useCallback((value: boolean) => {
    setRecording(value);
    optionsRef.current.onRecordingChange?.(value);
  }, []);

  // reflect an already granted / denied permission without prompting (not available everywhere)
  useEffect(() => {
    if (!detectSupport()) return;
    let cancelled = false;
    const permissions = navigator.permissions;
    if (!permissions?.query) return;
    permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        if (cancelled) return;
        if (status.state === "granted") setPermission("granted");
        else if (status.state === "denied") setPermission("denied");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const release = useCallback(
    (s: Session) => {
      clearInterval(s.timer);
      s.stream.getTracks().forEach((track) => track.stop());
      s.context?.close().catch(() => {});
      if (session.current === s) session.current = null;
      level.set(0);
    },
    [level],
  );

  /** A recorder whose chunks are private to it, so a restart can drop them cleanly. */
  const createRecorder = useCallback(
    (s: { stream: MediaStream; mimeType: string | undefined }, owner: () => Session | null): MediaRecorder => {
      const recorder = new MediaRecorder(s.stream, s.mimeType ? { mimeType: s.mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const current = owner();
        if (!current) return;
        const send = current.send;
        const type = recorder.mimeType || s.mimeType || "audio/webm";
        release(current);
        const blob = new Blob(chunks, { type });
        // recording flag and utterance are published in the same tick: no idle flicker in between
        setRecording(false);
        optionsRef.current.onRecordingChange?.(false);
        if (send && blob.size > 0) optionsRef.current.onUtterance(blob);
      };
      return recorder;
    },
    [release],
  );

  const finish = useCallback((s: Session, send: boolean) => {
    if (s.ended) return;
    s.ended = true;
    s.send = send;
    clearInterval(s.timer);
    if (s.recorder.state !== "inactive") {
      try {
        s.recorder.stop(); // onstop publishes the result
        return;
      } catch {
        // fall through to a plain release
      }
    }
    release(s);
    setRecording(false);
    optionsRef.current.onRecordingChange?.(false);
  }, [release]);

  const start = useCallback(
    async (startOptions?: StartOptions): Promise<boolean> => {
      if (session.current || gate.starting) return true;
      if (!detectSupport()) {
        setPermission("unsupported");
        optionsRef.current.onError?.({ kind: "unsupported" });
        return false;
      }
      gate.begin();
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (error) {
        gate.settle();
        const kind = errorKind(error);
        if (kind === "denied") setPermission("denied");
        optionsRef.current.onError?.({
          kind,
          message: error instanceof Error ? error.message : undefined,
        });
        return false;
      }
      setPermission("granted");

      // The button was released (or the screen left) before the stream existed: nothing was heard, so
      // there is nothing to send. Close the microphone again; the next press starts instantly because
      // the permission is now granted.
      if (gate.settle() !== null) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }

      try {
        const useVad = startOptions?.vad !== false;
        const mimeType = pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t));
        const config: VadConfig = { ...DEFAULT_VAD_CONFIG, ...optionsRef.current.vad };

        // analysis graph: source -> analyser only (never to the speakers, that would echo)
        let context: AudioContext | null = null;
        let analyser: AnalyserNode | null = null;
        try {
          const Ctor =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctor) {
            context = new Ctor();
            void context.resume().catch(() => {});
            analyser = context.createAnalyser();
            // 2048 points: ~23 Hz bins at 48 kHz, fine enough to see the harmonics of a voice (voicingFromSpectrum)
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.5;
            context.createMediaStreamSource(stream).connect(analyser);
          }
        } catch {
          context?.close().catch(() => {});
          context = null;
          analyser = null;
        }

        const holder: { current: Session | null } = { current: null };
        const recorder = createRecorder({ stream, mimeType }, () => holder.current);
        const s: Session = {
          stream,
          context,
          recorder,
          timer: undefined, // assigned once the sampling loop below is defined
          vad: useVad && analyser ? createVadState() : null,
          mimeType,
          send: true,
          ended: false,
          startedAt: performance.now(),
          capMs: recordingCapMs(config, useVad && analyser !== null),
        };
        holder.current = s;
        session.current = s;

        const buffer = analyser ? new Uint8Array(analyser.fftSize) : null;
        const spectrum = analyser ? new Float32Array(analyser.frequencyBinCount) : null;
        const sampleRate = context?.sampleRate ?? 48_000;
        let last = performance.now();
        s.timer = setInterval(() => {
          const now = performance.now();
          const dtMs = now - last;
          last = now;
          // hard cap, enforced here so push-to-talk and the no-AudioContext path are limited too
          if (!s.ended && capReached(now - s.startedAt, s.capMs)) {
            finish(s, true);
            return;
          }
          if (!analyser || !buffer) return;
          analyser.getByteTimeDomainData(buffer);
          const rms = rmsFromSamples(buffer);
          level.set(Math.min(1, rms * 4));
          if (!s.vad || s.ended) return;
          // does this frame sound like a voice, or like the fan / traffic / keyboard? (noise never opens the mic)
          let voiced: boolean | undefined;
          if (spectrum) {
            analyser.getFloatFrequencyData(spectrum);
            voiced = voicingFromSpectrum(spectrum, sampleRate, analyser.fftSize).voiced;
          }
          const step = stepVad(s.vad, { rms, dtMs, voiced }, config);
          s.vad = step.state;
          switch (step.signal) {
            case "utterance_end":
            case "max_length":
              finish(s, true);
              break;
            case "too_short": {
              // a click or a cough: drop the audio so far and keep listening with a fresh recorder
              const old = s.recorder;
              old.ondataavailable = null;
              old.onstop = null;
              try {
                if (old.state !== "inactive") old.stop();
              } catch {
                // already stopped
              }
              s.recorder = createRecorder({ stream, mimeType }, () => holder.current);
              s.recorder.start(TIMESLICE_MS);
              break;
            }
            case "no_speech":
              finish(s, false);
              optionsRef.current.onNoSpeech?.();
              break;
            default:
              break;
          }
        }, SAMPLE_MS);

        recorder.start(TIMESLICE_MS);
        setAutoStop(s.vad !== null);
        emitRecording(true);
        return true;
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        optionsRef.current.onError?.({
          kind: "failed",
          message: error instanceof Error ? error.message : undefined,
        });
        return false;
      }
    },
    [createRecorder, emitRecording, finish, gate, level],
  );

  const stop = useCallback(() => {
    if (session.current) finish(session.current, true);
    else gate.defer("stop");
  }, [finish, gate]);

  const cancel = useCallback(() => {
    if (session.current) finish(session.current, false);
    else gate.defer("cancel");
  }, [finish, gate]);

  // release the microphone if the screen goes away mid-recording
  useEffect(() => {
    return () => {
      gate.defer("cancel"); // a getUserMedia still pending must not open the mic after we are gone
      const s = session.current;
      if (!s) return;
      s.ended = true;
      s.send = false;
      clearInterval(s.timer);
      s.recorder.ondataavailable = null;
      s.recorder.onstop = null;
      try {
        if (s.recorder.state !== "inactive") s.recorder.stop();
      } catch {
        // already stopped
      }
      release(s);
    };
  }, [gate, release]);

  return { supported, permission, recording, autoStop, level, start, stop, cancel };
}
