import "server-only";
import fs from "node:fs";
import path from "node:path";

/** public path of the Signature Triage demo clips (integration map section 4.11) */
export const SIGNATURE_DEMO_AUDIO_URL = "/demo/audio/signature";

/**
 * The pre-generated demo clips that exist (file names `<beat>_<lang>.mp3` in public/demo/audio/signature, written by
 * `pnpm demo:audio`). Decided on the server at render / build time, like the Rive file check in the root layout, so
 * the page never requests a clip that is not there; a missing folder means captions only.
 */
export function listSignatureDemoAudio(): string[] {
  try {
    return fs
      .readdirSync(path.join(process.cwd(), "public", "demo", "audio", "signature"))
      .filter((f) => /^[a-z0-9]+_(?:mn|en)\.mp3$/u.test(f))
      .sort();
  } catch {
    return [];
  }
}
