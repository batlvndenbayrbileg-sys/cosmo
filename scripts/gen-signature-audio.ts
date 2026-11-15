/**
 * Pre-generates Cosmo's voice for the OFFLINE Signature Triage demo (/demo/signature, addendum section 5).
 *
 * Builds the demo beats exactly as the page does (same engine, same templates, same simulated check-ins) and voices
 * each Cosmo line once through the existing ElevenLabs helper (src/server/speech/tts.ts `synthesizeSpeech`). Files go
 * to public/demo/audio/signature/<beat>_<lang>.mp3 (own sub-folder, integration map section 4.11); the page plays a
 * clip when its file exists and shows captions only when it does not. Run once before the pitch and commit the files.
 *
 * Usage (from the repo root):
 *   pnpm demo:audio -- --dry-run      list the lines and count characters (no ElevenLabs call, no key needed)
 *   pnpm demo:audio                   voice the language each beat plays in (a: Mongolian, the others English)
 *   pnpm demo:audio -- --all-langs    voice every Cosmo beat in both languages
 *   pnpm demo:audio -- --force        re-generate files that already exist
 * Reads ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID_MN / ELEVENLABS_VOICE_ID_EN / ELEVENLABS_TTS_MODEL_* from .env.local
 * (or the shell). Without a key it does nothing and the demo stays captions-only. Spends ElevenLabs credits.
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
const allLangs = args.includes("--all-langs");

// .env.local fills what the shell does not set; the helper refuses to call ElevenLabs in scripted mode
for (const [k, v] of Object.entries(loadDotEnv(path.join(process.cwd(), ".env.local")))) {
  if (process.env[k] === undefined) process.env[k] = v;
}
process.env.DEMO_MODE = "live";

async function main() {
  const { getLabData, tryLoadSecondAssay } = await import("@/server/signature/files");
  const { buildSignatureView } = await import("@/lib/signature/view");
  const { buildDemoBeats, demoAudioFile, demoSpokenLines } = await import("@/lib/signature/demo");
  const { synthesizeSpeech } = await import("@/server/speech/tts");
  const checkins = (await import("@/data/demo_checkins.json")).default as unknown as import("@/lib/signature/demo").DemoCheckins;

  const view = buildSignatureView(getLabData(), tryLoadSecondAssay()?.matrix);
  const beats = buildDemoBeats(view, checkins);

  const lines: { file: string; lang: Lang; text: string }[] = [];
  for (const lang of ["mn", "en"] as const) {
    for (const l of demoSpokenLines(beats, lang, view, checkins)) {
      const plays = beats.find((b) => b.id === l.id)?.cosmo?.lang === lang;
      if (plays || allLangs) lines.push({ file: demoAudioFile(l.id, lang), lang, text: l.text });
    }
  }

  const outDir = path.join(process.cwd(), "public", "demo", "audio", "signature");
  const todo = lines.filter((l) => force || !fs.existsSync(path.join(outDir, l.file)));
  const chars = todo.reduce((n, l) => n + l.text.length, 0);
  console.log(`[demo:audio] ${lines.length} Cosmo lines, ${todo.length} to generate, ${chars} characters`);
  if (dryRun) {
    for (const l of todo) console.log(`  ${l.file}  (${l.text.length})  ${l.text.slice(0, 90)}`);
    return;
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    console.log("[demo:audio] no ELEVENLABS_API_KEY: nothing generated, the demo shows captions only");
    return;
  }
  fs.mkdirSync(outDir, { recursive: true });

  let done = 0;
  for (const l of todo) {
    try {
      const res = await synthesizeSpeech(l.text, l.lang);
      fs.writeFileSync(path.join(outDir, l.file), Buffer.from(await res.arrayBuffer()));
      done += 1;
      console.log(`  ok ${l.file}  ${l.text.slice(0, 70)}`);
    } catch (err) {
      console.error(`[demo:audio] ${l.file}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`[demo:audio] wrote ${done}/${todo.length} clips to public/demo/audio/signature`);
}

main().catch((err) => {
  console.error("[demo:audio] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
