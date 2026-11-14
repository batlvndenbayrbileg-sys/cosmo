"use client";

/**
 * <CosmoAvatar variant state emotion amplitude size? className? />
 *
 * Renders the designer's Rive file when Rive is available (CosmoConfigProvider, or the `rive` prop
 * which overrides it) and the original SVG placeholder otherwise. The placeholder also stays on
 * screen while the Rive file loads, and comes back if Rive fails to load.
 */
import dynamic from "next/dynamic";
import { useState } from "react";
import { useCosmoConfig } from "./CosmoConfig";
import { PlaceholderCosmo } from "./PlaceholderCosmo";
import type { CosmoProps } from "./types";

// The dynamic import is only fetched when <RiveCosmo> is first rendered, which happens only when
// Rive is available. ssr: false keeps the canvas runtime out of the server render.
const RiveCosmo = dynamic(() => import("./RiveCosmo"), { ssr: false, loading: () => null });

export interface CosmoAvatarProps extends CosmoProps {
  /** overrides the CosmoConfigProvider value */
  rive?: boolean;
}

type RiveStatus = "loading" | "ready" | "failed";

export function CosmoAvatar({ rive, ...props }: CosmoAvatarProps) {
  const config = useCosmoConfig();
  const wantRive = rive ?? config.rive;
  const [status, setStatus] = useState<RiveStatus>("loading");

  if (!wantRive || status === "failed") {
    return <PlaceholderCosmo {...props} />;
  }

  const { size, className, ...rest } = props;
  return (
    <div
      className={["relative", className].filter(Boolean).join(" ")}
      style={{ width: size ?? "100%", height: size ?? "100%", pointerEvents: "none" }}
    >
      {status === "loading" ? <PlaceholderCosmo {...rest} size={undefined} /> : null}
      <div
        className="absolute inset-0"
        style={{ opacity: status === "ready" ? 1 : 0, pointerEvents: "none" }}
        aria-hidden={status !== "ready"}
      >
        <RiveCosmo
          {...rest}
          onLoaded={() => setStatus("ready")}
          onLoadError={() => setStatus("failed")}
        />
      </div>
    </div>
  );
}
