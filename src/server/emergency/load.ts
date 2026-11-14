import "server-only";
import fs from "node:fs";
import path from "node:path";
import {
  BUILTIN_CALL_FOR_HELP,
  SCENARIO_ID_RE,
  STEP_IMAGE_RE,
  scenarioSchema,
  type EmergencyScenario,
} from "@/lib/emergency";

/**
 * Reads the team's emergency guidance from AEGIS_EMERGENCY_DIR (default: the sibling folder
 * ../aegis-assets/emergency next to the repo, i.e. C:/dev/aegis-assets/emergency). Read on every request (a handful of
 * small files) so the team can drop in new content without restarting the app. Invalid folders are skipped and
 * reported in `problems`, never shown half-broken.
 */

export function emergencyDir(): string {
  const fromEnv = process.env.AEGIS_EMERGENCY_DIR?.trim();
  return fromEnv ? path.resolve(fromEnv) : path.resolve(process.cwd(), "..", "aegis-assets", "emergency");
}

export interface EmergencyLibrary {
  scenarios: EmergencyScenario[];
  /** folders that were skipped, with the reason (for the logs and the team) */
  problems: string[];
  dir: string;
}

export function loadEmergencyLibrary(dir = emergencyDir()): EmergencyLibrary {
  const scenarios: EmergencyScenario[] = [];
  const problems: string[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // no folder yet: only the built-in card
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    if (!SCENARIO_ID_RE.test(entry.name)) {
      problems.push(`${entry.name}: folder name must be lowercase letters, digits and dashes`);
      continue;
    }
    const file = path.join(dir, entry.name, "scenario.json");
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    } catch (err) {
      problems.push(`${entry.name}: scenario.json is missing or not valid JSON (${err instanceof Error ? err.message : err})`);
      continue;
    }
    const parsed = scenarioSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push(`${entry.name}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      continue;
    }
    if (parsed.data.id !== entry.name) {
      problems.push(`${entry.name}: "id" must equal the folder name`);
      continue;
    }
    scenarios.push({
      ...parsed.data,
      builtIn: false,
      steps: parsed.data.steps.map((step) => {
        const exists = step.image ? fs.existsSync(path.join(dir, entry.name, step.image)) : false;
        if (step.image && !exists) problems.push(`${entry.name}: ${step.image} is listed but not found`);
        return {
          text: step.text,
          image: step.image,
          imageUrl: step.image && exists ? `/api/emergency/${entry.name}/image/${step.image}` : null,
        };
      }),
    });
  }
  return { scenarios: [...scenarios, BUILTIN_CALL_FOR_HELP], problems, dir };
}

/** absolute path of a step image, or null when the id/file is not allowed or does not exist (no path traversal) */
export function emergencyImagePath(id: string, file: string, dir = emergencyDir()): string | null {
  if (!SCENARIO_ID_RE.test(id) || !STEP_IMAGE_RE.test(file)) return null;
  const full = path.resolve(dir, id, file);
  if (!full.startsWith(path.resolve(dir) + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

export function findScenario(id: string, dir = emergencyDir()): EmergencyScenario | null {
  return loadEmergencyLibrary(dir).scenarios.find((s) => s.id === id) ?? null;
}
