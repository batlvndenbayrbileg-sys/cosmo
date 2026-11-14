"use client";

import { createContext, useContext, type ReactNode } from "react";
import { motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/components/cosmo/usePrefersReducedMotion";
import { cn } from "@/lib/utils";
import { staggerDelay } from "./logic";

const AnimateContext = createContext(true);

/**
 * Wrap a DashboardView in `<DashboardMotionProvider animate={false}>` to skip the entrance animation
 * (used by /dashboard for reloads and deep links). The default is animated.
 */
export function DashboardMotionProvider({
  animate,
  children,
}: {
  animate: boolean;
  children: ReactNode;
}) {
  return <AnimateContext.Provider value={animate}>{children}</AnimateContext.Provider>;
}

/** true when the entrance animation should play: not disabled by the provider and no reduced-motion preference */
export function useDashboardAnimate(): boolean {
  const allowed = useContext(AnimateContext);
  const reduced = usePrefersReducedMotion();
  return allowed && !reduced;
}

/** Fade + slide-in wrapper. With animation off it renders its children in place without any initial state. */
export function Reveal({
  index = 0,
  className,
  children,
}: {
  /** position in the entrance order */
  index?: number;
  className?: string;
  children: ReactNode;
}) {
  const animate = useDashboardAnimate();
  return (
    <motion.div
      className={cn(className)}
      initial={animate ? { opacity: 0, y: 14 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: animate ? 0.4 : 0, delay: animate ? staggerDelay(index) : 0, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
