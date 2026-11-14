/**
 * pnpm db:seed — (re)creates the demo database: 4 crew members, 14 simulated confirmed check-ins
 * each. Writes to AEGIS_DB_PATH (default data/aegis.db) and prints the crew with their last day.
 * WARNING: wipes every existing row first.
 */
import { registerHooks } from "node:module";

// src/server modules start with `import "server-only"`, which throws outside Next's react-server
// condition. Outside Next (this script) resolve it WITH that condition, which maps to empty.js.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return nextResolve(specifier, {
        ...context,
        conditions: [...(context.conditions ?? []), "react-server"],
      });
    }
    return nextResolve(specifier, context);
  },
});

function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // file not present: fine, scripted mode needs no keys
    }
  }
}

function cell(v: unknown, width: number): string {
  return String(v ?? "-").padEnd(width);
}

async function main(): Promise<void> {
  loadEnvFiles();

  const { getDb } = await import("../src/server/db/client");
  const { seedDatabase } = await import("../src/server/db/seed");
  const { listCrewPublic } = await import("../src/server/db/repos/crew");
  const { latestConfirmedCheckIn } = await import("../src/server/db/repos/checkin");
  const { listMeasurements } = await import("../src/server/db/repos/measurement");
  const { listAlerts } = await import("../src/server/db/repos/alert");
  const { getEnv } = await import("../src/server/env");
  const { buildDashboardPayload } = await import("../src/server/dashboard/build");

  const db = getDb();
  const result = seedDatabase(db, { wipe: true });
  console.log(
    `Seeded ${getEnv().dbPath}: ${result.crew} crew, ${result.checkIns} check-ins, ` +
      `${result.measurements} measurements, ${result.alerts} alert(s); ` +
      `${result.dates[0]} .. ${result.dates[result.dates.length - 1]} (simulated)\n`,
  );

  const columns = [
    ["crew", 7],
    ["role", 19],
    ["lang", 5],
    ["date", 11],
    ["sleep", 6],
    ["mood", 5],
    ["BP", 8],
    ["HR", 4],
    ["temp", 5],
    ["gluc", 5],
    ["water", 6],
    ["ex", 4],
    ["hdc/diz/nau", 12],
    ["vis", 4],
    ["load", 5],
    ["alerts", 6],
    ["overall", 8],
  ] as const;
  console.log(columns.map(([name, w]) => cell(name, w)).join(" "));
  console.log(columns.map(([, w]) => "-".repeat(w)).join(" "));

  for (const crew of listCrewPublic()) {
    const latest = latestConfirmedCheckIn(crew.id);
    if (!latest) {
      console.log(cell(crew.id, 7), "(no confirmed check-in)");
      continue;
    }
    const v = Object.fromEntries(listMeasurements(crew.id, latest.id).map((m) => [m.key, m.value]));
    const row = [
      crew.id,
      crew.role,
      crew.preferredLanguage,
      latest.localDate,
      v.sleep_hours,
      v.mood,
      `${v.bp_systolic}/${v.bp_diastolic}`,
      v.heart_rate,
      v.temperature_c,
      v.glucose_mgdl,
      v.water_ml,
      v.exercise_min,
      `${v.symptom_headache}/${v.symptom_dizziness}/${v.symptom_nausea}`,
      v.vision_check,
      v.workload,
      listAlerts(crew.id).length,
      // computed by src/lib/health from the seeded values (and the stored summary, if any)
      buildDashboardPayload({ crewId: crew.id, viewer: "crew" })?.overall,
    ];
    console.log(row.map((x, i) => cell(x, columns[i][1])).join(" "));
  }
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
