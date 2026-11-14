/**
 * Next.js startup hook (runs once per server instance, before requests are served).
 * Logs the demo mode and which live capabilities are configured. Never logs keys, voice ids or
 * any other secret: only booleans and public model names.
 */
export async function register(): Promise<void> {
  // better-sqlite3 / node:crypto based modules are Node-only
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getEnv, liveReadiness } = await import("@/server/env");
  const env = getEnv();
  const ready = liveReadiness(env);
  const yesNo = (v: boolean) => (v ? "configured" : "missing");

  console.info(`[aegis] DEMO_MODE=${env.demoMode}`);
  if (env.demoMode === "scripted") {
    console.info("[aegis] scripted mode: STT, LLM and TTS are replaced by the scripted adapters (no network needed)");
  } else {
    console.info(
      `[aegis] live capabilities: llm ${yesNo(ready.llm)} (${env.anthropicModel}), ` +
        `stt ${yesNo(ready.stt)} (${env.sttModel}), ` +
        `tts mn ${yesNo(ready.ttsMn)} (${env.ttsModelMn}), ` +
        `tts en ${yesNo(ready.ttsEn)} (${env.ttsModelEn ?? "model chosen at startup"})`,
    );
    const missing = [
      !ready.llm && "ANTHROPIC_API_KEY",
      !ready.stt && "ELEVENLABS_API_KEY",
      !ready.ttsMn && "ELEVENLABS_VOICE_ID_MN",
      !ready.ttsEn && "ELEVENLABS_VOICE_ID_EN",
    ].filter(Boolean);
    if (missing.length > 0) {
      console.warn(`[aegis] live mode is missing: ${missing.join(", ")}; the app falls back to text where it can`);
    }
  }
  console.info(`[aegis] mission start date ${env.missionStartDate}, database ${env.dbPath}`);

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // HOOK (another lane): ElevenLabs model probe goes here.
  // In live mode with ELEVENLABS_API_KEY set, call GET /v1/models, log the chosen STT and TTS
  // models and whether Mongolian is supported. Must never throw and must not block startup for
  // long (use a short timeout); on any failure log one line and continue.
  // ───────────────────────────────────────────────────────────────────────────────────────────
}
