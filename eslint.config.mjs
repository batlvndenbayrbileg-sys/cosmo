import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // lil cosmo's Electron main process and preload (docs/lil-cosmo.md) are plain CommonJS run by Node / Electron
  {
    files: ["electron/**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // MediaPipe WASM glue copied in by scripts/copy-mediapipe-wasm.mjs (git-ignored, minified vendor code)
    "public/mediapipe/**",
    // lil cosmo build output (`pnpm pet:build`, git-ignored)
    "dist-electron/**",
  ]),
]);

export default eslintConfig;
