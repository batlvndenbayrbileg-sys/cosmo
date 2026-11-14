import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";
import { statusClasses } from "./statusClasses";

/**
 * The shape language of the product, drawn inside an existing <svg>:
 * green = circle, yellow = triangle, red = diamond, no data = hollow dashed ring.
 * Status is never carried by colour alone.
 */
export function StatusShape({
  status,
  cx,
  cy,
  r,
  className,
}: {
  status: Status;
  cx: number;
  cy: number;
  /** nominal radius in the parent SVG's user units */
  r: number;
  className?: string;
}) {
  const c = statusClasses(status);

  switch (status) {
    case "green":
      return <circle cx={cx} cy={cy} r={r} className={cn(c.fill, className)} />;
    case "yellow": {
      const points = [
        [cx, cy - r * 1.05],
        [cx + r * 1.0, cy + r * 0.8],
        [cx - r * 1.0, cy + r * 0.8],
      ]
        .map(([x, y]) => `${round(x)},${round(y)}`)
        .join(" ");
      return <polygon points={points} className={cn(c.fill, className)} />;
    }
    case "red": {
      const d = r * 1.15;
      const points = [
        [cx, cy - d],
        [cx + d, cy],
        [cx, cy + d],
        [cx - d, cy],
      ]
        .map(([x, y]) => `${round(x)},${round(y)}`)
        .join(" ");
      return <polygon points={points} className={cn(c.fill, className)} />;
    }
    case "no_data":
      return (
        <circle
          cx={cx}
          cy={cy}
          r={r * 0.8}
          fill="none"
          strokeWidth={Math.max(r * 0.32, 0.5)}
          strokeDasharray={`${round(r * 0.55)} ${round(r * 0.55)}`}
          className={cn(c.stroke, className)}
        />
      );
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
