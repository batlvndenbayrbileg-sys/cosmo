import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One large frosted glass frame around a whole screen (docs/DESIGN_V2.md section 1): centred,
 * max 1360px, 32px outer margin on desktop and 12px on phones, with bottom room for the fixed
 * prototype ribbon.
 */
export function PageFrame({
  children,
  className,
  frameClassName,
  ...rest
}: {
  children: ReactNode;
  /** outer wrapper (margins) */
  className?: string;
  /** the glass frame itself (padding, gap) */
  frameClassName?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[1360px] px-3 pt-3 pb-16 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8 lg:pb-20",
        className,
      )}
      {...rest}
    >
      <div
        className={cn(
          "glass-frame flex flex-col gap-6 !p-4 sm:gap-8 sm:!p-6 lg:!p-8",
          "rounded-[26px] sm:rounded-[var(--cosmo-radius-frame)]",
          frameClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
