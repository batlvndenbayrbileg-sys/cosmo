/**
 * Face tracker for "Cosmo looks at you": opens the camera, runs a face detector on it ~12 times a second
 * and turns the faces into a smoothed gaze (components/cosmo/gaze.ts).
 *
 * Every browser API sits behind the injected FaceTrackerEnv (face-camera.ts has the real one), so the
 * start / stop / failure rules are unit-tested without a camera (tests/face-follow.test.ts, "face tracker"):
 *  - stop() always releases the camera, also when it is called while the camera is still being opened
 *    (the late stream is stopped the moment it arrives);
 *  - a denied permission, a missing camera, a browser or page that cannot use the camera at all (no
 *    navigator.mediaDevices, e.g. plain http on a LAN address) or a detector that fails to load ends in a
 *    failure status ("denied" / "unavailable" / "unsupported" / "error") with the camera released and the
 *    gaze cleared, so Cosmo falls back to her usual look;
 *  - frames are only handed to the detector function; nothing is stored or sent anywhere.
 */
import { initialGazeState, stepGaze, DEFAULT_GAZE_OPTIONS, type FaceBox, type Gaze, type GazeOptions, type GazeState } from "@/components/cosmo/gaze";

export type FaceTrackFailure = "denied" | "unavailable" | "unsupported" | "error";
export type FaceTrackStatus = "off" | "starting" | "on" | FaceTrackFailure;

export interface CameraHandle {
  /** stops every track of the stream and drops the video element */
  stop(): void;
}

/** detects faces on the camera's current frame; null when no frame is ready yet */
export type DetectFaces<C extends CameraHandle> = (camera: C, timestampMs: number) => FaceBox[] | null;

export interface FaceTrackerEnv<C extends CameraHandle = CameraHandle> {
  openCamera(): Promise<C>;
  loadDetector(): Promise<DetectFaces<C>>;
  now(): number;
  /** runs `cb` once after `ms`; returns a cancel function */
  setTimer(cb: () => void, ms: number): () => void;
}

export interface FaceTrackerCallbacks {
  /** the smoothed gaze after every detection; null when tracking stops or fails */
  onGaze(gaze: Gaze | null): void;
  onStatus(status: FaceTrackStatus): void;
}

export interface FaceTrackerOptions {
  /** detections per second (10 to 15 is plenty for eyes) */
  fps?: number;
  gaze?: GazeOptions;
}

export const FACE_TRACK_FPS = 12;

/** getUserMedia / play() errors, by DOMException name */
export function classifyCameraError(error: unknown): FaceTrackFailure {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "NotReadableError":
    case "TrackStartError":
      return "unavailable";
    // no camera API here (an insecure page or an old browser): a camera may well be attached
    case "NotSupportedError":
      return "unsupported";
    default:
      return "error";
  }
}

export interface FaceTracker {
  start(): void;
  stop(): void;
  readonly status: FaceTrackStatus;
}

export function createFaceTracker<C extends CameraHandle>(
  env: FaceTrackerEnv<C>,
  callbacks: FaceTrackerCallbacks,
  options: FaceTrackerOptions = {},
): FaceTracker {
  const interval = 1000 / Math.min(30, Math.max(1, options.fps ?? FACE_TRACK_FPS));
  const gazeOpts = options.gaze ?? DEFAULT_GAZE_OPTIONS;
  /** bumped by every start and stop: work belonging to an older generation is dropped */
  let generation = 0;
  let status: FaceTrackStatus = "off";
  let camera: C | null = null;
  let cancelTimer: (() => void) | null = null;
  let lastTs = Number.NEGATIVE_INFINITY;

  const setStatus = (next: FaceTrackStatus) => {
    if (next === status) return;
    status = next;
    callbacks.onStatus(next);
  };

  const release = () => {
    cancelTimer?.();
    cancelTimer = null;
    const cam = camera;
    camera = null;
    if (cam) {
      try {
        cam.stop();
      } catch {
        // already stopped
      }
    }
  };

  const fail = (failure: FaceTrackFailure) => {
    generation++;
    release();
    callbacks.onGaze(null);
    setStatus(failure);
  };

  const start = () => {
    if (status === "starting" || status === "on") return;
    const gen = ++generation;
    setStatus("starting");
    const detectorPromise = env.loadDetector();
    // a failure is handled below once the camera is open; never an unhandled rejection
    detectorPromise.catch(() => {});

    void (async () => {
      let cam: C;
      try {
        cam = await env.openCamera();
      } catch (error) {
        if (gen === generation) fail(classifyCameraError(error));
        return;
      }
      if (gen !== generation) {
        // stopped while the permission prompt was open: release the late stream at once
        try {
          cam.stop();
        } catch {
          // ignore
        }
        return;
      }
      camera = cam;
      setStatus("on");

      let detect: DetectFaces<C>;
      try {
        detect = await detectorPromise;
      } catch {
        if (gen === generation) fail("error");
        return;
      }
      if (gen !== generation) return;

      let state: GazeState = initialGazeState();
      const tick = () => {
        cancelTimer = null;
        if (gen !== generation || camera === null) return;
        const now = env.now();
        const ts = Math.max(now, lastTs + 1);
        lastTs = ts;
        let faces: FaceBox[] | null;
        try {
          faces = detect(camera, ts);
        } catch {
          fail("error");
          return;
        }
        if (faces !== null) {
          state = stepGaze(state, faces, now, gazeOpts);
          callbacks.onGaze(state.gaze);
        }
        cancelTimer = env.setTimer(tick, interval);
      };
      tick();
    })();
  };

  const stop = () => {
    generation++;
    const wasActive = status === "starting" || status === "on";
    release();
    if (wasActive) {
      callbacks.onGaze(null);
      setStatus("off");
    }
  };

  return {
    start,
    stop,
    get status() {
      return status;
    },
  };
}
