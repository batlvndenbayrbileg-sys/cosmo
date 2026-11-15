/**
 * Writes the simulated daily check-ins of the Signature Triage demo (beat b, addendum section 5) to
 * src/data/demo_checkins.json, from the build-prompt T5 rule (`simulatedCheckins` in src/lib/signature/demo.ts):
 * 14 calm days, then 3 strained days {sleep 5.0 h, sleep quality 2, resting HR 66, fatigue 4, mood 3}, the last one
 * 9 days after C001's R+82 panel. Simulated data, shown with the banner "Simulated check-ins".
 *
 * Usage (from the repo root): pnpm demo:checkins
 * tests/signature/demo.test.ts checks that the committed file equals what this script writes.
 */
import fs from "node:fs";
import path from "node:path";
import { simulatedCheckins } from "@/lib/signature/demo";

const out = path.join(process.cwd(), "src", "data", "demo_checkins.json");
const data = simulatedCheckins();
fs.writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`[demo:checkins] wrote ${data.days.length} simulated days (day ${data.days[0].day}-${data.today}, ${data.crew}) to ${path.relative(process.cwd(), out)}`);
