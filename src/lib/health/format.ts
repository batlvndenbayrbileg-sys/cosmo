/**
 * Number formatting shared by the registry, the findings and the tasks.
 * Pure, locale-independent: one helper so every number the product shows is rendered the same way.
 */

/** Rounds to `digits` decimals and drops trailing zeros: 7.20 -> "7.2", 6.0 -> "6", -0.01 -> "0". */
export function formatNumber(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "-";
  const fixed = n.toFixed(Math.max(0, digits));
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  return trimmed === "-0" ? "0" : trimmed;
}
