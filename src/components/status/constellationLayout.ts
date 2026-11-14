import { KPI_KEYS, type KpiKey, type Status } from "@/lib/types";

export type ConstellationStar = { key: KpiKey; status: Status };

export const MAX_STARS = 16;

export interface PlacedStar extends ConstellationStar {
  x: number;
  y: number;
  /** angle in radians, 0 = top, clockwise */
  angle: number;
}

/** Stars ordered by KPI_KEYS (slot order), unknown keys and repeats dropped, at most MAX_STARS. */
export function orderStars(stars: readonly ConstellationStar[]): ConstellationStar[] {
  const byKey = new Map<KpiKey, ConstellationStar>();
  for (const star of stars) if (!byKey.has(star.key)) byKey.set(star.key, star);
  const ordered: ConstellationStar[] = [];
  for (const key of KPI_KEYS) {
    const star = byKey.get(key);
    if (star) ordered.push(star);
  }
  return ordered.slice(0, MAX_STARS);
}

/**
 * Deterministic ring layout: star i of n sits at angle = 2*PI * i / n, starting at 12 o'clock
 * and going clockwise. The same input always gives the same positions.
 */
export function placeStars(
  stars: readonly ConstellationStar[],
  cx: number,
  cy: number,
  radius: number,
): PlacedStar[] {
  const ordered = orderStars(stars);
  const n = ordered.length;
  return ordered.map((star, i) => {
    const angle = (2 * Math.PI * i) / n;
    return {
      ...star,
      angle,
      x: Math.round((cx + radius * Math.sin(angle)) * 100) / 100,
      y: Math.round((cy - radius * Math.cos(angle)) * 100) / 100,
    };
  });
}

export function countByStatus(stars: readonly ConstellationStar[]): Record<Status, number> {
  const counts: Record<Status, number> = { green: 0, yellow: 0, red: 0, no_data: 0 };
  for (const star of stars) counts[star.status] += 1;
  return counts;
}
