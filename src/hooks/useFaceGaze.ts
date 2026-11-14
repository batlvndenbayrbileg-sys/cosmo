"use client";

/**
 * useFaceGaze: "Cosmo looks at you". While `enabled` (the person turned it on), `active` (the check-in
 * screen is showing) and the tab is visible, the camera runs and `gaze.current` holds where Cosmo should
 * look; otherwise the camera is off and `gaze.current` is null. The camera is released when any of the
 * three turns false and when the component unmounts.
 *
 * `gaze` is a ref, not state: it changes ~12 times a second and the mascot reads it from its own
 * animation loop, so nothing re-renders for it. `status` drives the toggle and the "camera on" dot.
 * A failure (permission denied, no camera, detector could not load) is reported once via `onFailure`.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Gaze } from "@/components/cosmo/gaze";
import { browserFaceTrackerEnv } from "@/components/checkin/face-camera";
import {
  createFaceTracker,
  type CameraHandle,
  type FaceTrackFailure,
  type FaceTrackStatus,
  type FaceTrackerEnv,
} from "@/components/checkin/face-tracker";

export interface UseFaceGazeOptions {
  enabled: boolean;
  active: boolean;
  onFailure?: (failure: FaceTrackFailure) => void;
  /** tests / storybooks: a fake camera and detector */
  env?: FaceTrackerEnv<CameraHandle>;
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const readVisible = () => document.visibilityState !== "hidden";
const serverVisible = () => true;

export function useFaceGaze({ enabled, active, onFailure, env }: UseFaceGazeOptions) {
  const gaze = useRef<Gaze | null>(null);
  const [status, setStatus] = useState<FaceTrackStatus>("off");
  const visible = useSyncExternalStore(subscribeVisibility, readVisible, serverVisible);
  const failureRef = useRef(onFailure);
  useEffect(() => {
    failureRef.current = onFailure;
  });

  const run = enabled && active && visible;
  const trackerEnv = (env ?? browserFaceTrackerEnv) as FaceTrackerEnv<CameraHandle>;

  useEffect(() => {
    if (!run) return;
    const tracker = createFaceTracker(trackerEnv, {
      onGaze: (g) => {
        gaze.current = g;
      },
      onStatus: (s) => {
        setStatus(s);
        if (s === "denied" || s === "unavailable" || s === "unsupported" || s === "error") failureRef.current?.(s);
      },
    });
    tracker.start();
    return () => {
      tracker.stop();
      gaze.current = null;
    };
  }, [run, trackerEnv]);

  return { gaze, status: run ? status : ("off" as FaceTrackStatus) };
}
