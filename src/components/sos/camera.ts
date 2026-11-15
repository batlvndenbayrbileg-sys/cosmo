/**
 * One still of the face for an SOS alert. The front camera is opened (the browser asks for permission), one frame is
 * drawn to a canvas as a JPEG of at most SOS_PHOTO_MAX_SIDE px and SOS_PHOTO_MAX_BYTES, and the camera is stopped at
 * once, whatever happens. Nothing is kept: the caller uploads the blob to its own alert and drops it.
 *
 * The size loop (encodeUnder) and the scaling (fitWithin) are pure, so they are unit-tested in Node.
 */
import { SOS_PHOTO_MAX_BYTES, SOS_PHOTO_MAX_SIDE, SOS_PHOTO_QUALITY } from "@/lib/sos";

export type StillResult = { ok: true; blob: Blob } | { ok: false; reason: "denied" | "unavailable" };

/** the permission prompt may wait for the person; after this long the alert goes on without a photo */
const PERMISSION_TIMEOUT_MS = 30_000;
/** let exposure and focus settle before the frame is taken */
const WARM_UP_MS = 600;

/** width and height scaled down (never up) so the longer side is at most `max` */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Encodes with falling quality, then smaller sizes, until the JPEG is at most `maxBytes`. `encode(quality, scale)`
 * draws the frame at `scale` of the fitted size. Returns null when even the smallest attempt is too large.
 */
export async function encodeUnder(
  encode: (quality: number, scale: number) => Promise<Blob | null>,
  maxBytes: number = SOS_PHOTO_MAX_BYTES,
): Promise<Blob | null> {
  for (const scale of [1, 0.75, 0.5]) {
    for (const quality of [SOS_PHOTO_QUALITY, 0.55, 0.4]) {
      const blob = await encode(quality, scale);
      if (blob && blob.size > 0 && blob.size <= maxBytes) return blob;
    }
  }
  return null;
}

function failureReason(error: unknown): "denied" | "unavailable" {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  return name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError" ? "denied" : "unavailable";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function openStream(): Promise<MediaStream> {
  const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!media?.getUserMedia) throw Object.assign(new Error("camera not supported"), { name: "NotSupportedError" });
  const request = media.getUserMedia({
    audio: false,
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
  });
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(Object.assign(new Error("camera timeout"), { name: "TimeoutError" })), PERMISSION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([request, timeout]);
  } catch (error) {
    // a stream that arrives after the timeout is stopped straight away
    void request.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => undefined);
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function captureFaceStill(): Promise<StillResult> {
  let stream: MediaStream;
  try {
    stream = await openStream();
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  }

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("aria-hidden", "true");
  Object.assign(video.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
  video.srcObject = stream;
  document.body.appendChild(video);
  try {
    await video.play();
    const started = performance.now();
    while ((!video.videoWidth || video.readyState < 2) && performance.now() - started < 4000) await sleep(50);
    if (!video.videoWidth) return { ok: false, reason: "unavailable" };
    await sleep(WARM_UP_MS);

    const fitted = fitWithin(video.videoWidth, video.videoHeight, SOS_PHOTO_MAX_SIDE);
    const canvas = document.createElement("canvas");
    const blob = await encodeUnder(async (quality, scale) => {
      canvas.width = Math.max(1, Math.round(fitted.width * scale));
      canvas.height = Math.max(1, Math.round(fitted.height * scale));
      const g = canvas.getContext("2d");
      if (!g) return null;
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    });
    return blob ? { ok: true, blob } : { ok: false, reason: "unavailable" };
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  } finally {
    // the camera is off as soon as the frame is taken (or the attempt failed)
    for (const track of stream.getTracks()) track.stop();
    video.pause();
    video.srcObject = null;
    video.remove();
  }
}
