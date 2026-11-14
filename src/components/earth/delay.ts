/**
 * Simulated Earth-link delay options (Live / 3 min / 20 min). Pure module, shared by the Earth console
 * (where the delay is sent as ?delayMs= and hides recent check-ins) and by the crew dashboard's link card
 * (where it only changes what is displayed). These are simulation settings, not NASA figures.
 */

export const DELAY_OPTIONS = [
  { id: "live", ms: 0, labelKey: "earth.delay.live" },
  { id: "3min", ms: 180_000, labelKey: "earth.delay.3min" },
  { id: "20min", ms: 1_200_000, labelKey: "earth.delay.20min" },
] as const;

export type DelayId = (typeof DELAY_OPTIONS)[number]["id"];

export const DEFAULT_DELAY_ID: DelayId = "live";

export function isDelayId(value: unknown): value is DelayId {
  return DELAY_OPTIONS.some((o) => o.id === value);
}

/** unknown / missing input falls back to Live */
export function parseDelayId(value: string | string[] | null | undefined): DelayId {
  const raw = Array.isArray(value) ? value[0] : value;
  return isDelayId(raw) ? raw : DEFAULT_DELAY_ID;
}

export function delayMsFor(id: DelayId): number {
  const option = DELAY_OPTIONS.find((o) => o.id === id);
  return option ? option.ms : 0;
}

/** exact match by milliseconds; anything else maps to Live */
export function delayIdFor(ms: number): DelayId {
  const option = DELAY_OPTIONS.find((o) => o.ms === ms);
  return option ? option.id : DEFAULT_DELAY_ID;
}

export function delayLabelKey(id: DelayId): string {
  const option = DELAY_OPTIONS.find((o) => o.id === id);
  return option ? option.labelKey : "earth.delay.live";
}
