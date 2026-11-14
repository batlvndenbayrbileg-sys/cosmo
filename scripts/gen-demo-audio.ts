/**
 * Pre-generates Cosmo's voice for the OFFLINE scripted demo (DEMO_MODE=scripted).
 *
 * It runs the real scripted conversation (same server code, same templates) for the chosen crew members on a
 * throw-away in-memory database seeded exactly like data/aegis.db, collects every sentence Cosmo says (greeting,
 * replies, read-back, summary, dashboard tour) and voices each unique sentence once with ElevenLabs. Files are written
 * to public/demo/audio/<lang>-<sha1(text) first 12 hex>.mp3, the name the audio route looks up (demoAudioFileName).
 *
 * Usage (from the repo root):
 *   pnpm gen:demo-audio -- --dry-run            count characters only (no ElevenLabs call)
 *   pnpm gen:demo-audio -- --crew bat,alex      generate for these crew members (default: bat,alex)
 *   pnpm gen:demo-audio -- --crew bat --force   re-generate files that already exist
 * Reads ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID_MN / ELEVENLABS_VOICE_ID_EN / ELEVENLABS_TTS_MODEL_* from .env.local.
 * Runs with the react-server condition so the server modules' `import "server-only"` resolves (see package.json).
 */
import fs from "node:fs";
import path from "node:path";

type Lang = "mn" | "en";

function loadDotEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const crewArg = args.find((a, i) => args[i - 1] === "--crew");
// commas or spaces (PowerShell turns "bat,alex" into "bat alex")
const crewIds = (crewArg ?? "bat,alex").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

const fileEnv = loadDotEnv(path.join(process.cwd(), ".env.local"));
// the conversation must be the scripted one (templates), on a private in-memory database
process.env.DEMO_MODE = "scripted";
process.env.AEGIS_DB_PATH = ":memory:";

async function main() {
  const { getDb } = await import("@/server/db/client");
  const { seedDatabase } = await import("@/server/db/seed");
  const { getCrewPublic } = await import("@/server/db/repos/crew");
  const { createOrResumeCheckIn, loadHistory, loadTodayValues } = await import("@/server/checkin/service");
  const { runTurn } = await import("@/server/agent/turn");
  const { DEMO_SCRIPTS } = await import("@/server/agent/scripts");
  const { buildResultsFacts } = await import("@/server/agent/resultsFacts");
  const { buildTour } = await import("@/server/agent/tour");
  const { getCheckIn } = await import("@/server/db/repos/checkin");
  const { demoAudioFileName } = await import("@/server/speech/tts");

  seedDatabase(getDb(), { today: new Date(), wipe: true });

  const sentences = new Map<string, { lang: Lang; text: string }>();
  const add = (lang: Lang, text: string) => {
    const t = text.trim();
    if (t) sentences.set(demoAudioFileName(t, lang), { lang, text: t });
  };

  for (const crewId of crewIds) {
    const crew = getCrewPublic(crewId);
    const lang = crew.preferredLanguage as Lang;
    const created = createOrResumeCheckIn(crewId, lang);
    add(lang, created.greeting.text);
    for (const line of DEMO_SCRIPTS[lang].lines) {
      for await (const ev of runTurn({ crewId, checkInId: created.checkInId, input: { kind: "typed", text: line.say } })) {
        if (ev.type === "assistant") add(lang, ev.text);
      }
    }
    const checkIn = getCheckIn(crewId, created.checkInId);
    if (checkIn.confirmedAt) {
      const facts = buildResultsFacts(loadTodayValues(crewId, checkIn.id).values, loadHistory(crewId, checkIn.localDate), lang);
      for (const step of buildTour(facts, lang)) add(lang, step.text);
    } else {
      console.warn(`[gen-demo-audio] ${crewId}: the scripted demo did not reach the summary - tour clips skipped`);
    }
  }

  const outDir = path.join(process.cwd(), "public", "demo", "audio");
  const todo = [...sentences.entries()].filter(([name]) => force || !fs.existsSync(path.join(outDir, name)));
  const chars = todo.reduce((n, [, s]) => n + s.text.length, 0);
  console.log(
    `[gen-demo-audio] crew ${crewIds.join(", ")}: ${sentences.size} unique sentences, ${todo.length} to generate, ${chars} characters`,
  );
  if (dryRun) {
    for (const [name, s] of todo) console.log(`  ${name}  (${s.text.length})  ${s.text.slice(0, 90)}`);
    return;
  }

  const key = fileEnv.ELEVENLABS_API_KEY;
  const voice: Record<Lang, string | undefined> = { mn: fileEnv.ELEVENLABS_VOICE_ID_MN, en: fileEnv.ELEVENLABS_VOICE_ID_EN };
  const model: Record<Lang, string> = {
    mn: fileEnv.ELEVENLABS_TTS_MODEL_MN || "eleven_v4_turbo",
    en: fileEnv.ELEVENLABS_TTS_MODEL_EN || "eleven_v4_turbo",
  };
  if (!key) throw new Error("ELEVENLABS_API_KEY is missing in .env.local");
  fs.mkdirSync(outDir, { recursive: true });

  let done = 0;
  for (const [name, s] of todo) {
    const v = voice[s.lang];
    if (!v) throw new Error(`ELEVENLABS_VOICE_ID_${s.lang.toUpperCase()} is missing in .env.local`);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(v)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: s.text, model_id: model[s.lang] }),
    });
    if (!res.ok) {
      console.error(`[gen-demo-audio] ${name}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
      continue;
    }
    fs.writeFileSync(path.join(outDir, name), Buffer.from(await res.arrayBuffer()));
    done += 1;
    console.log(`  ✓ ${name}  ${s.text.slice(0, 70)}`);
  }
  console.log(`[gen-demo-audio] wrote ${done}/${todo.length} clips to public/demo/audio`);
}

main().catch((err) => {
  console.error("[gen-demo-audio] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
