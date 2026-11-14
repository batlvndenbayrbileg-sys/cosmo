/**
 * Serves the MediaPipe WebAssembly runtime from this app instead of a CDN (src/components/checkin/face-camera.ts):
 * copies node_modules/@mediapipe/tasks-vision/wasm/* to public/mediapipe/tasks-vision-<version>/wasm/, so the code
 * the browser runs for "Cosmo looks at you" is exactly the code pnpm installed (lockfile integrity), with no
 * third-party script tag. Runs before `next dev` and `next build`; the copy is git-ignored and skipped when it is
 * already in place. The versioned folder name keeps old copies from ever being served for a newer version.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** the public URL path of the runtime folder for a version (face-camera.ts builds the same one) */
export function mediapipeWasmPath(version) {
  return `/mediapipe/tasks-vision-${version}/wasm`;
}

/** copies the runtime into `<publicDir><mediapipeWasmPath(version)>`; returns the folder and the copied file names */
export function copyMediapipeWasm(publicDir = join(ROOT, "public"), packageDir = join(ROOT, "node_modules", "@mediapipe", "tasks-vision")) {
  const { version } = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const source = join(packageDir, "wasm");
  const target = join(publicDir, ...mediapipeWasmPath(version).split("/").filter(Boolean));
  mkdirSync(target, { recursive: true });
  const files = readdirSync(source).filter((name) => /\.(?:js|wasm)$/u.test(name));
  for (const name of files) {
    const from = join(source, name);
    const to = join(target, name);
    if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
    copyFileSync(from, to);
  }
  return { version, target, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { target, files } = copyMediapipeWasm();
  console.log(`[aegis] MediaPipe runtime ready in ${target} (${files.length} files)`);
}
