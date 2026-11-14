/**
 * The browser side of "Cosmo looks at you": the camera stream on a hidden <video> and the MediaPipe
 * FaceDetector (short-range BlazeFace), wired into face-tracker.ts.
 *
 * Privacy: frames go from the camera to the detector inside this tab and nowhere else. Nothing is drawn,
 * recorded, stored or uploaded; only the face box centre leaves the detector, and only as far as the
 * gaze maths. The network sees three things, none of them a frame or a face box, and only after the
 * person turns the feature on (@mediapipe/tasks-vision itself is a dynamic import, so the normal page
 * never loads any of it):
 *  - the MediaPipe WebAssembly runtime, from this app (MEDIAPIPE_WASM_URL, copied from the installed package);
 *  - the model from Google's MediaPipe model storage (a versioned path);
 *  - MediaPipe's built-in usage metrics, which the library cannot switch off: about once a minute it
 *    POSTs to https://odml.pa.googleapis.com/v1/log the task type, running mode, OS family, library
 *    version and processing-time statistics (package README, "Privacy Notice").
 * Google therefore sees the browser's IP address. The toggle's privacy text
 * (checkin.faceFollow.privacy, both languages) says all of this; tests/face-follow.test.ts keeps it so.
 */
import type { FaceBox } from "@/components/cosmo/gaze";
import type { CameraHandle, DetectFaces, FaceTrackerEnv } from "./face-tracker";

/** MUST equal the installed @mediapipe/tasks-vision version (package.json pins it; a test checks both) */
export const MEDIAPIPE_VISION_VERSION = "1.2.3";
/**
 * Same origin: scripts/copy-mediapipe-wasm.mjs copies the installed package's runtime to public/ before `next dev`
 * and `next build`, so the runtime is the one pnpm verified at install and no third-party script runs.
 */
export const MEDIAPIPE_WASM_URL = `/mediapipe/tasks-vision-${MEDIAPIPE_VISION_VERSION}/wasm`;
export const BLAZE_FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

/** a small selfie stream is plenty for one face box */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 30 } },
};

export interface BrowserCamera extends CameraHandle {
  video: HTMLVideoElement;
}

/** pixel bounding box of a detection -> FaceBox normalised to the frame; null for an unusable box */
export function faceBoxFromPixels(
  box: { originX: number; originY: number; width: number; height: number },
  frameWidth: number,
  frameHeight: number,
): FaceBox | null {
  if (!(frameWidth > 0) || !(frameHeight > 0)) return null;
  const f = { x: box.originX / frameWidth, y: box.originY / frameHeight, w: box.width / frameWidth, h: box.height / frameHeight };
  return [f.x, f.y, f.w, f.h].every(Number.isFinite) && f.w > 0 && f.h > 0 ? f : null;
}

export async function openBrowserCamera(): Promise<BrowserCamera> {
  const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!media?.getUserMedia) throw Object.assign(new Error("camera not supported"), { name: "NotSupportedError" });
  const stream = await media.getUserMedia(CAMERA_CONSTRAINTS);

  // hidden but in the document (some browsers stop decoding a detached or display:none video)
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.tabIndex = -1;
  video.setAttribute("aria-hidden", "true");
  video.dataset.slot = "face-follow-video";
  Object.assign(video.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });
  video.srcObject = stream;
  document.body.appendChild(video);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const track of stream.getTracks()) track.stop();
    video.pause();
    video.srcObject = null;
    video.remove();
  };
  try {
    await video.play();
  } catch (error) {
    stop();
    throw error;
  }
  return { video, stop };
}

interface VideoFaceDetector {
  detectForVideo(
    video: HTMLVideoElement,
    timestampMs: number,
  ): { detections: { boundingBox?: { originX: number; originY: number; width: number; height: number } }[] };
}

/** one detector per page, created on first use and kept (it holds no camera data, only the model) */
let detectorPromise: Promise<VideoFaceDetector> | null = null;
/** VIDEO mode needs strictly increasing timestamps, also across tracker restarts */
let lastTimestamp = Number.NEGATIVE_INFINITY;

async function createDetector(): Promise<VideoFaceDetector> {
  const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
  const make = (delegate: "GPU" | "CPU") =>
    FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: BLAZE_FACE_MODEL_URL, delegate },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5,
    });
  try {
    return await make("GPU");
  } catch {
    // no WebGL2 / GPU delegate: the CPU (WebAssembly) path is fast enough for 12 small frames a second
    return make("CPU");
  }
}

export function loadBrowserDetector(): Promise<DetectFaces<BrowserCamera>> {
  detectorPromise ??= createDetector().catch((error: unknown) => {
    detectorPromise = null; // a later attempt may succeed (e.g. back online)
    throw error;
  });
  return detectorPromise.then((detector) => (camera: BrowserCamera, timestampMs: number) => {
    const v = camera.video;
    if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) return null;
    const ts = Math.max(timestampMs, lastTimestamp + 1);
    lastTimestamp = ts;
    const result = detector.detectForVideo(v, ts);
    const faces: FaceBox[] = [];
    for (const d of result.detections) {
      const box = d.boundingBox ? faceBoxFromPixels(d.boundingBox, v.videoWidth, v.videoHeight) : null;
      if (box) faces.push(box);
    }
    return faces;
  });
}

export const browserFaceTrackerEnv: FaceTrackerEnv<BrowserCamera> = {
  openCamera: openBrowserCamera,
  loadDetector: loadBrowserDetector,
  now: () => performance.now(),
  setTimer: (cb, ms) => {
    const id = window.setTimeout(cb, ms);
    return () => window.clearTimeout(id);
  },
};
