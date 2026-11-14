import "server-only";

/**
 * The one place server code reads the current time when the result matters for behaviour
 * (Earth link delay, mission day). Tests inject a fixed or moving clock with setClockForTests so
 * "a check-in confirmed 5 minutes ago" is reproducible.
 */

type ClockSource = () => Date;

const CLOCK_KEY = Symbol.for("aegis.clockOverride");
type GlobalWithClock = typeof globalThis & { [CLOCK_KEY]?: ClockSource | null };

/** The current instant: the test override when set, otherwise the real clock. */
export function now(): Date {
  const override = (globalThis as GlobalWithClock)[CLOCK_KEY];
  return override ? new Date(override().getTime()) : new Date();
}

/**
 * Tests only. Pass a Date or epoch ms (frozen clock), a function (moving clock), or null to go
 * back to the real clock. The override lives on globalThis so route modules and the test see the
 * same one even if the module graph is instantiated twice.
 */
export function setClockForTests(source: Date | number | ClockSource | null): void {
  const g = globalThis as GlobalWithClock;
  if (source === null) {
    delete g[CLOCK_KEY];
    return;
  }
  if (typeof source === "function") {
    g[CLOCK_KEY] = source;
    return;
  }
  const frozen = new Date(source instanceof Date ? source.getTime() : source);
  g[CLOCK_KEY] = () => frozen;
}
