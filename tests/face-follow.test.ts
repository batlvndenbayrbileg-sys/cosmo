import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  FACE_FOLLOW_STORAGE_KEY,
  createFaceFollowPref,
  parseFaceFollow,
  type StorageLike,
} from "@/components/checkin/face-follow-pref";
import {
  classifyCameraError,
  createFaceTracker,
  type CameraHandle,
  type FaceTrackStatus,
  type FaceTrackerEnv,
} from "@/components/checkin/face-tracker";
import {
  BLAZE_FACE_MODEL_URL,
  MEDIAPIPE_VISION_VERSION,
  MEDIAPIPE_WASM_URL,
  faceBoxFromPixels,
} from "@/components/checkin/face-camera";
import { checkinStrings } from "@/i18n/strings/checkin";
import type { FaceBox, Gaze } from "@/components/cosmo/gaze";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

describe("face-follow preference (localStorage)", () => {
  it("is off by default and remembers the choice", () => {
    const storage = memoryStorage();
    const pref = createFaceFollowPref(() => storage);
    expect(pref.read()).toBe(false);
    pref.write(true);
    expect(storage.data[FACE_FOLLOW_STORAGE_KEY]).toBe("1");
    expect(pref.read()).toBe(true);
    // a fresh page load sees the stored choice
    expect(createFaceFollowPref(() => storage).read()).toBe(true);
    pref.write(false);
    expect(createFaceFollowPref(() => storage).read()).toBe(false);
  });

  it("only '1' / 'true' mean on; anything else is off", () => {
    expect(parseFaceFollow("1")).toBe(true);
    expect(parseFaceFollow("true")).toBe(true);
    for (const raw of ["0", "false", "", "yes", null, undefined]) expect(parseFaceFollow(raw)).toBe(false);
  });

  it("survives storage that is missing or throws, keeping the choice for this tab", () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    for (const getStorage of [() => throwing, () => null, () => { throw new Error("no window"); }]) {
      const pref = createFaceFollowPref(getStorage);
      expect(pref.read()).toBe(false);
      expect(() => pref.write(true)).not.toThrow();
      expect(pref.read()).toBe(true);
    }
  });

  it("notifies subscribers on every write and stops after unsubscribe", () => {
    const pref = createFaceFollowPref(() => memoryStorage());
    const seen = vi.fn();
    const off = pref.subscribe(seen);
    pref.write(true);
    pref.write(false);
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    pref.write(true);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

/* ───────────── tracker with a fake camera and detector ───────────── */

interface FakeCamera extends CameraHandle {
  stopped: boolean;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeEnv(opts: {
  camera?: Promise<FakeCamera>;
  detector?: Promise<(cam: FakeCamera, ts: number) => FaceBox[] | null>;
  faces?: () => FaceBox[] | null;
}) {
  let now = 0;
  const timers: { cb: () => void; at: number; cancelled: boolean }[] = [];
  const cameras: FakeCamera[] = [];
  const timestamps: number[] = [];
  const makeCamera = (): FakeCamera => {
    const cam: FakeCamera = {
      stopped: false,
      stop() {
        cam.stopped = true;
      },
    };
    cameras.push(cam);
    return cam;
  };
  const env: FaceTrackerEnv<FakeCamera> = {
    openCamera: () => opts.camera ?? Promise.resolve(makeCamera()),
    loadDetector: () =>
      opts.detector ??
      Promise.resolve((_cam: FakeCamera, ts: number) => {
        timestamps.push(ts);
        return opts.faces ? opts.faces() : [{ x: 0.1, y: 0.35, w: 0.2, h: 0.2 }];
      }),
    now: () => now,
    setTimer: (cb, ms) => {
      const t = { cb, at: now + ms, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
  };
  /** advances the fake clock, running due timers */
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      await Promise.resolve();
      const due = timers.filter((t) => !t.cancelled && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.cancelled = true;
      now = due.at;
      due.cb();
    }
    now = end;
  };
  const pendingTimers = () => timers.filter((t) => !t.cancelled).length;
  return { env, advance, cameras, makeCamera, timestamps, pendingTimers };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function track(env: FaceTrackerEnv<FakeCamera>) {
  const statuses: FaceTrackStatus[] = [];
  const gazes: (Gaze | null)[] = [];
  const tracker = createFaceTracker(env, {
    onGaze: (g) => gazes.push(g),
    onStatus: (s) => statuses.push(s),
  });
  return { tracker, statuses, gazes };
}

describe("face tracker", () => {
  it("starts the camera, follows the face at ~12 fps and releases the camera on stop", async () => {
    const f = fakeEnv({});
    const { tracker, statuses, gazes } = track(f.env);
    tracker.start();
    await flush();
    expect(statuses).toEqual(["starting", "on"]);
    expect(f.cameras).toHaveLength(1);
    await f.advance(1000);
    // one detection right away plus ~12 per second
    expect(f.timestamps.length).toBeGreaterThanOrEqual(11);
    expect(f.timestamps.length).toBeLessThanOrEqual(14);
    // timestamps strictly increase (MediaPipe VIDEO mode needs that)
    for (let i = 1; i < f.timestamps.length; i++) expect(f.timestamps[i]).toBeGreaterThan(f.timestamps[i - 1]);
    // face on the left of the raw frame = right of the screen
    const last = gazes[gazes.length - 1];
    expect(last && last.x).toBeGreaterThan(0.3);

    tracker.stop();
    expect(f.cameras[0].stopped).toBe(true);
    expect(gazes[gazes.length - 1]).toBeNull();
    expect(statuses[statuses.length - 1]).toBe("off");
    expect(f.pendingTimers()).toBe(0);
    const count = f.timestamps.length;
    await f.advance(1000);
    expect(f.timestamps.length).toBe(count);
  });

  it("stop() while the permission prompt is open releases the stream as soon as it arrives", async () => {
    const cam = deferred<FakeCamera>();
    const f = fakeEnv({ camera: cam.promise });
    const { tracker, statuses } = track(f.env);
    tracker.start();
    tracker.stop();
    const late = f.makeCamera();
    cam.resolve(late);
    await flush();
    expect(late.stopped).toBe(true);
    expect(statuses).toEqual(["starting", "off"]);
    await f.advance(500);
    expect(f.timestamps).toHaveLength(0);
  });

  it("a denied permission ends in 'denied' with nothing running", async () => {
    const f = fakeEnv({ camera: Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" })) });
    const { tracker, statuses, gazes } = track(f.env);
    tracker.start();
    await flush();
    expect(statuses).toEqual(["starting", "denied"]);
    expect(gazes).toEqual([null]);
    expect(f.pendingTimers()).toBe(0);
  });

  it("a detector that cannot load ends in 'error' and stops the camera", async () => {
    const f = fakeEnv({ detector: Promise.reject(new Error("offline")) });
    const { tracker, statuses } = track(f.env);
    tracker.start();
    await flush();
    expect(statuses).toEqual(["starting", "on", "error"]);
    expect(f.cameras[0].stopped).toBe(true);
  });

  it("a detector that throws mid-run ends in 'error' and stops the camera", async () => {
    let calls = 0;
    const f = fakeEnv({
      faces: () => {
        calls++;
        if (calls > 3) throw new Error("context lost");
        return [];
      },
    });
    const { tracker, statuses } = track(f.env);
    tracker.start();
    await flush();
    await f.advance(1000);
    expect(statuses[statuses.length - 1]).toBe("error");
    expect(f.cameras[0].stopped).toBe(true);
    expect(f.pendingTimers()).toBe(0);
  });

  it("frames that are not ready yet are skipped without moving the gaze", async () => {
    const f = fakeEnv({ faces: () => null });
    const { tracker, gazes } = track(f.env);
    tracker.start();
    await flush();
    await f.advance(500);
    expect(gazes).toEqual([]);
    tracker.stop();
  });

  it("can be restarted after a stop (tab hidden, then visible again)", async () => {
    const f = fakeEnv({});
    const { tracker, statuses } = track(f.env);
    tracker.start();
    await flush();
    tracker.stop();
    tracker.start();
    await flush();
    expect(statuses).toEqual(["starting", "on", "off", "starting", "on"]);
    expect(f.cameras).toHaveLength(2);
    expect(f.cameras[0].stopped).toBe(true);
    expect(f.cameras[1].stopped).toBe(false);
    tracker.stop();
    expect(f.cameras[1].stopped).toBe(true);
  });

  it("classifies camera errors", () => {
    expect(classifyCameraError({ name: "NotAllowedError" })).toBe("denied");
    expect(classifyCameraError({ name: "SecurityError" })).toBe("denied");
    expect(classifyCameraError({ name: "NotFoundError" })).toBe("unavailable");
    expect(classifyCameraError({ name: "NotReadableError" })).toBe("unavailable");
    // no navigator.mediaDevices (plain http on a LAN address, an old browser): a camera may well be attached
    expect(classifyCameraError({ name: "NotSupportedError" })).toBe("unsupported");
    expect(classifyCameraError(new Error("boom"))).toBe("error");
    expect(classifyCameraError(null)).toBe("error");
  });
});

describe("browser detector glue", () => {
  it("normalises pixel boxes and drops unusable ones", () => {
    expect(faceBoxFromPixels({ originX: 160, originY: 120, width: 64, height: 48 }, 640, 480)).toEqual({
      x: 0.25,
      y: 0.25,
      w: 0.1,
      h: 0.1,
    });
    expect(faceBoxFromPixels({ originX: 0, originY: 0, width: 0, height: 10 }, 640, 480)).toBeNull();
    expect(faceBoxFromPixels({ originX: 0, originY: 0, width: 10, height: 10 }, 0, 480)).toBeNull();
  });

  it("loads the WASM runtime for the EXACT installed package version, and the official short-range model", () => {
    const root = path.resolve(__dirname, "..");
    const installed = JSON.parse(
      readFileSync(path.join(root, "node_modules/@mediapipe/tasks-vision/package.json"), "utf8"),
    ) as { version: string };
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(MEDIAPIPE_VISION_VERSION).toBe(installed.version);
    expect(pkg.dependencies["@mediapipe/tasks-vision"]).toBe(installed.version);
    // same origin, from the installed package (no third-party script tag)
    expect(MEDIAPIPE_WASM_URL).toBe(`/mediapipe/tasks-vision-${installed.version}/wasm`);
    expect(BLAZE_FACE_MODEL_URL).toMatch(
      /^https:\/\/storage\.googleapis\.com\/mediapipe-models\/face_detector\/blaze_face_short_range\/float16\/1\//,
    );
  });

  it("the runtime is copied from node_modules to the same-origin folder before dev and build", async () => {
    const root = path.resolve(__dirname, "..");
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toMatch(/^node scripts\/copy-mediapipe-wasm\.mjs && next dev/);
    expect(pkg.scripts.build).toMatch(/^node scripts\/copy-mediapipe-wasm\.mjs && next build/);
    const script = (await import(pathToFileURL(path.join(root, "scripts/copy-mediapipe-wasm.mjs")).href)) as {
      mediapipeWasmPath(version: string): string;
      copyMediapipeWasm(publicDir: string): { target: string; files: string[] };
    };
    expect(script.mediapipeWasmPath(MEDIAPIPE_VISION_VERSION)).toBe(MEDIAPIPE_WASM_URL);
    const out = mkdtempSync(path.join(tmpdir(), "cosmo-mp-"));
    try {
      const { target, files } = script.copyMediapipeWasm(out);
      expect(files.sort()).toEqual([
        "vision_wasm_internal.js",
        "vision_wasm_internal.wasm",
        "vision_wasm_module_internal.js",
        "vision_wasm_module_internal.wasm",
      ]);
      for (const f of files) {
        expect(readFileSync(path.join(target, f)).equals(readFileSync(path.join(root, "node_modules/@mediapipe/tasks-vision/wasm", f)))).toBe(true);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("the library is only ever loaded with a dynamic import", () => {
    const root = path.resolve(__dirname, "..");
    for (const file of [
      "src/components/checkin/face-camera.ts",
      "src/components/checkin/face-tracker.ts",
      "src/hooks/useFaceGaze.ts",
      "src/components/checkin/CheckInExperience.tsx",
    ]) {
      const src = readFileSync(path.join(root, file), "utf8");
      expect(src, file).not.toMatch(/^import[^;]*from\s+["']@mediapipe\/tasks-vision["']/m);
    }
    expect(readFileSync(path.join(root, "src/components/checkin/face-camera.ts"), "utf8")).toContain(
      'await import("@mediapipe/tasks-vision")',
    );
  });
});

describe("face-follow strings", () => {
  it("exist in both languages and the privacy text says the video stays in the browser", () => {
    const keys = ["toggle", "privacy", "on", "denied", "unavailable", "unsupported", "error"].map((k) => `checkin.faceFollow.${k}`);
    for (const key of keys) {
      expect(checkinStrings.en[key], `en ${key}`).toBeTruthy();
      expect(checkinStrings.mn[key], `mn ${key}`).toBeTruthy();
    }
    expect(checkinStrings.en["checkin.faceFollow.privacy"]).toMatch(/never uploaded/);
  });

  it("the privacy text discloses what does reach the network: the model download and MediaPipe's usage metrics", () => {
    // @mediapipe/tasks-vision POSTs usage metrics to Google (odml.pa.googleapis.com) and cannot be switched off
    const bundle = readFileSync(path.resolve(__dirname, "../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs"), "utf8");
    expect(bundle).toContain("odml.pa.googleapis.com/v1/log");
    expect(checkinStrings.en["checkin.faceFollow.privacy"]).toMatch(/model from Google/);
    expect(checkinStrings.en["checkin.faceFollow.privacy"]).toMatch(/sends Google anonymous usage statistics \(never video or images\)/);
    expect(checkinStrings.mn["checkin.faceFollow.privacy"]).toMatch(/Google-ээс татаж/u);
    expect(checkinStrings.mn["checkin.faceFollow.privacy"]).toMatch(/Google руу нэргүй хэрэглээний статистик/u);
    // the only third-party host left is Google's model storage
    expect(BLAZE_FACE_MODEL_URL.startsWith("https://storage.googleapis.com/")).toBe(true);
  });

  it("an insecure page or a browser without a camera API is not called 'no camera found'", () => {
    expect(checkinStrings.en["checkin.faceFollow.unsupported"]).toMatch(/https/);
    expect(checkinStrings.en["checkin.faceFollow.unsupported"]).not.toBe(checkinStrings.en["checkin.faceFollow.unavailable"]);
    expect(checkinStrings.mn["checkin.faceFollow.unsupported"]).toMatch(/https/);
  });
});
