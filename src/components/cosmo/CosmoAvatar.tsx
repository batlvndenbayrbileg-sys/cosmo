"use client";

/**
 * <CosmoAvatar variant state emotion amplitude size? className? />
 *
 * Picks the implementation (see implementation.ts):
 *  1. the designer's Rive file when Rive is available (CosmoConfigProvider, or the `rive` prop);
 *  2. otherwise the team's PNG render with a drawn, animated face (ImageCosmo), the default;
 *  3. otherwise the original SVG placeholder (mascotMode 'placeholder', or the PNG failed to load).
 * While the Rive file loads, whatever would be shown without Rive stays on screen underneath, and
 * comes back if Rive fails to load.
 */
import dynamic from "next/dynamic";
import { useState } from "react";
import { useCosmoConfig, type MascotMode } from "./CosmoConfig";
import { ImageCosmo } from "./ImageCosmo";
import { PlaceholderCosmo } from "./PlaceholderCosmo";
import { resolveImplementation } from "./implementation";
import type { MascotPoseChoice } from "./mascot-poses";
import type { CosmoProps } from "./types";

// The dynamic import is only fetched when <RiveCosmo> is first rendered, which happens only when
// Rive is available. ssr: false keeps the canvas runtime out of the server render.
const RiveCosmo = dynamic(() => import("./RiveCosmo"), { ssr: false, loading: () => null });

export interface CosmoAvatarProps extends CosmoProps {
  /** overrides the CosmoConfigProvider value */
  rive?: boolean;
  /** overrides the CosmoConfigProvider value: 'image' (default) or 'placeholder' */
  mascotMode?: MascotMode;
  /** image mode: draw the animated face and glow overlays (default true); false = the render as it is */
  face?: boolean;
  /** image mode: force a render; 'auto' (default) follows state and emotion */
  pose?: MascotPoseChoice;
  /** image mode: draw the measured geometry over the picture (dev only) */
  debug?: boolean;
}

type RiveStatus = "loading" | "ready" | "failed";

export function CosmoAvatar({ rive, mascotMode, face, pose, debug, ...props }: CosmoAvatarProps) {
  const config = useCosmoConfig();
  const wantRive = rive ?? config.rive;
  const mode = mascotMode ?? config.mascotMode;
  const faceOverlay = face ?? config.faceOverlay;
  const [riveStatus, setRiveStatus] = useState<RiveStatus>("loading");
  const [imageFailed, setImageFailed] = useState(false);

  const impl = resolveImplementation({
    rive: wantRive,
    riveFailed: riveStatus === "failed",
    mascotMode: mode,
    imageFailed,
  });
  const base = resolveImplementation({ rive: false, riveFailed: false, mascotMode: mode, imageFailed });

  const renderBase = (p: CosmoProps) =>
    base === "image" ? (
      <ImageCosmo {...p} face={faceOverlay} pose={pose} debug={debug} onLoadError={() => setImageFailed(true)} />
    ) : (
      <PlaceholderCosmo {...p} />
    );

  if (impl !== "rive") return renderBase(props);

  const { size, className, ...rest } = props;
  return (
    <div
      className={["relative", className].filter(Boolean).join(" ")}
      style={{ width: size ?? "100%", height: size ?? "100%", pointerEvents: "none" }}
    >
      {riveStatus === "loading" ? renderBase({ ...rest, size: undefined }) : null}
      <div
        className="absolute inset-0"
        style={{ opacity: riveStatus === "ready" ? 1 : 0, pointerEvents: "none" }}
        aria-hidden={riveStatus !== "ready"}
      >
        <RiveCosmo
          {...rest}
          onLoaded={() => setRiveStatus("ready")}
          onLoadError={() => setRiveStatus("failed")}
        />
      </div>
    </div>
  );
}
