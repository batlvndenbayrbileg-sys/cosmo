import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { findLabFile, findSecondAssayFile, readLabFiles } from "@/server/signature/files";

/**
 * T10 fix: `pnpm build` warned "Dynamic filesystem access causes tracing of the whole project" at
 * src/server/signature/files.ts (readLabFiles, loadSecondAssay): Turbopack cannot scope a path built while walking a
 * folder, so it traced the whole project into the server bundle. Every file-system call there now carries
 * `/*turbopackIgnore: true*\/` (the remedy Turbopack names), and the CSVs reach the server trace only through
 * next.config.ts `outputFileTracingIncludes`, which must keep listing them for every route that reads them.
 */

const src = fs.readFileSync(path.join(process.cwd(), "src/server/signature/files.ts"), "utf8");

describe("signature T10 fix: no whole-project trace from the lab-file reader", () => {
  it("every fs call in files.ts is marked turbopackIgnore", () => {
    const calls = [...src.matchAll(/\bfs\.(\w+)\(([^)]*)/g)];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const [, fn, args] of calls) {
      expect(args.trimStart().startsWith("/*turbopackIgnore: true*/"), `fs.${fn}(${args}`).toBe(true);
    }
  });

  it("outputFileTracingIncludes still carries data/nasa/*.csv for every route that reads it", () => {
    const inc = nextConfig.outputFileTracingIncludes ?? {};
    for (const route of ["/signature", "/demo/signature", "/api/signature/**", "/api/checkins/**"]) {
      expect(inc[route], route).toEqual(["./data/nasa/**/*.csv"]);
    }
  });

  it("the reader still finds and reads the files", () => {
    expect(path.basename(findLabFile("cbc"))).toContain("CBC");
    expect(path.basename(findSecondAssayFile())).toContain("Alamar");
    const files = readLabFiles();
    for (const k of ["cbc", "cmp", "cardio", "immune"] as const) expect(files[k].length, k).toBeGreaterThan(1000);
  });
});
