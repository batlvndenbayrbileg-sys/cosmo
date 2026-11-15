import "server-only";

/**
 * Server-side access to the NASA OSDR lab files of Signature Triage (data/nasa, read-only; integration map
 * section 4.5). Files are found by name fragment (spec section 3), read once and parsed + QC'd by the pure loader in
 * src/lib/signature/load.ts. The result is memoised per process: the files never change at run time.
 * next.config.ts `outputFileTracingIncludes` puts the CSVs into the server trace of the routes that use this.
 */

import fs from "node:fs";
import path from "node:path";
import { FILE_HINTS } from "@/lib/signature/config";
import { buildLabMatrix, type LabData, type LabFiles } from "@/lib/signature/load";
import { SECOND_ASSAY_FILE_HINT, parseSecondAssay, type SecondAssayTable } from "@/lib/signature/secondAssay";
import type { LabFileKind } from "@/lib/signature/types";

/** default data folder: <project root>/data/nasa */
export function labDataDir(): string {
  return path.join(process.cwd(), "data", "nasa");
}

/** first `.csv` (case-insensitive) whose name contains the kind's fragment, walking `dir` (sorted, files first) */
export function findLabFile(kind: LabFileKind, dir: string = labDataDir()): string {
  const hint = FILE_HINTS[kind].toLowerCase();
  const walk = (d: string): string | null => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
    for (const f of files) {
      const lower = f.toLowerCase();
      if (lower.endsWith(".csv") && lower.includes(hint)) return path.join(d, f);
    }
    for (const sub of entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      const hit = walk(path.join(d, sub));
      if (hit) return hit;
    }
    return null;
  };
  const hit = walk(dir);
  if (!hit) throw new Error(`signature: no CSV containing "${FILE_HINTS[kind]}" under ${dir}`);
  return hit;
}

/** the four lab files as UTF-8 text */
export function readLabFiles(dir: string = labDataDir()): LabFiles {
  const read = (kind: LabFileKind) => fs.readFileSync(findLabFile(kind, dir), "utf8");
  return { cbc: read("cbc"), cmp: read("cmp"), cardio: read("cardio"), immune: read("immune") };
}

let cached: LabData | null = null;

/** parsed + QC'd matrix of the default data folder, memoised per process. Callers must not mutate it. */
export function getLabData(): LabData {
  cached ??= buildLabMatrix(readLabFiles());
  return cached;
}

/* ───────────── second assay (addendum T11) ───────────── */

/** first `.csv` (case-insensitive) whose name contains "Alamar", walking `dir` (sorted, files first) */
export function findSecondAssayFile(dir: string = labDataDir()): string {
  const hint = SECOND_ASSAY_FILE_HINT.toLowerCase();
  const walk = (d: string): string | null => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
    for (const f of files) {
      const lower = f.toLowerCase();
      if (lower.endsWith(".csv") && lower.includes(hint)) return path.join(d, f);
    }
    for (const sub of entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      const hit = walk(path.join(d, sub));
      if (hit) return hit;
    }
    return null;
  };
  const hit = walk(dir);
  if (!hit) throw new Error(`signature: no CSV containing "${SECOND_ASSAY_FILE_HINT}" under ${dir}`);
  return hit;
}

let cachedSecond: SecondAssayTable | null = null;

/**
 * `loadSecondAssay()` (addendum T11): the second-assay CSV of the default data folder, parsed, memoised per process.
 * Callers must not mutate it. The main loader (getLabData) is independent of it.
 */
export function loadSecondAssay(): SecondAssayTable {
  cachedSecond ??= parseSecondAssay(fs.readFileSync(findSecondAssayFile(), "utf8"));
  return cachedSecond;
}
