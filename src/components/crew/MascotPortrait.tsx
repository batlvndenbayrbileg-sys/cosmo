"use client";

import { CosmoAvatar } from "@/components/cosmo/CosmoAvatar";
import type { CosmoEmotion, CosmoState } from "@/components/cosmo/types";
import { wrapVariantIndex } from "@/components/cosmo/variants";
import { cn } from "@/lib/utils";

/**
 * Pastel fill per mascot variant, chosen to sit next to that variant's neon hue
 * (0 cyan-violet, 1 mint-blue, 2 sky-pink, 3 orchid-coral). Literal class names for Tailwind.
 */
const VARIANT_TINT = [
  { fill: "bg-[#DCE9FF]", glow: "rgba(79,134,247,0.32)" },
  { fill: "bg-[#DDF7EA]", glow: "rgba(30,190,168,0.28)" },
  { fill: "bg-[#EDE3FF]", glow: "rgba(167,139,250,0.34)" },
  { fill: "bg-[#FFF5C7]", glow: "rgba(246,95,77,0.22)" },
] as const;

export function variantTint(variant: number) {
  return VARIANT_TINT[wrapVariantIndex(variant)];
}

/**
 * Round head-and-shoulders crop of the crew member's Cosmo render (front pose, variant hue) on a
 * soft pastel disc. The render is 822x900 and the visor sits at about (0.51, 0.28), so the avatar is
 * drawn at ~2.1x the disc and shifted to centre the head.
 */
export function MascotPortrait({
  variant,
  size = 56,
  label,
  state = "idle",
  emotion = "neutral",
  className,
}: {
  variant: number;
  /** disc diameter in px */
  size?: number;
  /** accessible name; omit to make the portrait decorative */
  label?: string;
  state?: CosmoState;
  emotion?: CosmoEmotion;
  className?: string;
}) {
  const tint = variantTint(variant);
  const inner = Math.round(size * 2.1);

  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-slot="mascot-portrait"
      className={cn(
        "relative inline-block shrink-0 overflow-hidden rounded-full ring-2 ring-white",
        "shadow-[0_6px_18px_-10px_rgba(40,80,160,0.5)]",
        tint.fill,
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: `radial-gradient(60% 60% at 50% 45%, ${tint.glow}, transparent 75%)` }}
      />
      <span
        aria-hidden="true"
        className="absolute"
        style={{ width: inner, height: inner, left: size / 2 - inner * 0.5, top: size * 0.56 - inner * 0.3 }}
      >
        <CosmoAvatar variant={variant} state={state} emotion={emotion} amplitude={0} pose="front" size={inner} />
      </span>
    </span>
  );
}
