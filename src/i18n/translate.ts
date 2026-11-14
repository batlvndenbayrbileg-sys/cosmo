import type { Dict, TranslateVars } from "./types";

const warned = new Set<string>();

/** Test helper: forget which missing keys were already warned about. */
export function resetMissingKeyWarnings(): void {
  warned.clear();
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Replace `{name}` placeholders; a placeholder without a matching var is left as written. */
export function interpolate(template: string, vars: TranslateVars): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    hasOwn(vars, name) ? String(vars[name]) : whole,
  );
}

/**
 * Look up `key` in `dict` and interpolate `{name}` placeholders.
 * A missing key returns the key itself (visible, never a crash) and, in development only,
 * logs one console warning per key.
 */
export function translate(dict: Dict, key: string, vars?: TranslateVars): string {
  if (!hasOwn(dict, key)) {
    if (process.env.NODE_ENV === "development" && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing translation key: ${key}`);
    }
    return key;
  }
  const template = dict[key];
  return vars ? interpolate(template, vars) : template;
}
