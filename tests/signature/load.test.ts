import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { EXCLUDED_MARKERS, REFERENCE_CREW, TIMEPOINTS } from "@/lib/signature/config";
import { buildLabMatrix, parseCsv, parseLabTable, parseNumericCell } from "@/lib/signature/load";
import { SIGNATURE_REFERENCE } from "@/lib/signature/reference";
import { findLabFile, getLabData, readLabFiles } from "@/server/signature/files";

const files = readLabFiles();
const { matrix, qcLog } = getLabData();

describe("signature T1: CSV parsing", () => {
  it("parses quoted fields, a BOM and CRLF line endings like Python's csv module", () => {
    const text = '﻿Sample Name,a_value_x\r\n"C001_serum_L-3","1,5"\r\nC002_serum_L-3,2\r\n';
    expect(parseCsv(text)).toEqual([
      ["Sample Name", "a_value_x"],
      ["C001_serum_L-3", "1,5"],
      ["C002_serum_L-3", "2"],
    ]);
  });

  it("treats NA, N/A and empty cells as missing, never 0", () => {
    expect(parseNumericCell("NA")).toBeNull();
    expect(parseNumericCell("N/A")).toBeNull();
    expect(parseNumericCell("")).toBeNull();
    expect(parseNumericCell("  ")).toBeNull();
    expect(parseNumericCell("0")).toBe(0);
    expect(parseNumericCell("7.6")).toBe(7.6);
    expect(parseNumericCell("1e3")).toBe(1000);
  });

  it("finds the four files by name fragment", () => {
    expect(findLabFile("cbc")).toMatch(/CBC/);
    expect(findLabFile("cmp")).toMatch(/Metabolic_Panel/);
    expect(findLabFile("immune")).toMatch(/serum_immune/);
    expect(findLabFile("cardio")).toMatch(/cardiovascular/);
  });

  it("has 28 rows in each of the four files: crew C001..C004, 7 timepoints each", () => {
    for (const kind of ["cbc", "cmp", "immune", "cardio"] as const) {
      const table = parseLabTable(files[kind], kind);
      expect(table.rows, kind).toHaveLength(28);
      expect([...new Set(table.rows.map((r) => r.crew))].sort(), kind).toEqual([...REFERENCE_CREW]);
      for (const crew of REFERENCE_CREW) {
        const tps = table.rows.filter((r) => r.crew === crew).map((r) => r.timepoint);
        expect(new Set(tps).size, `${kind} ${crew}`).toBe(7);
        expect([...tps].sort(), `${kind} ${crew}`).toEqual([...TIMEPOINTS].sort());
      }
    }
  });

  it("keeps NA cells missing in the matrix", () => {
    const bili = matrix["cmp:total_bilirubin"].C001;
    expect(bili["R+45"]).toBeUndefined();
    expect("R+45" in bili).toBe(false);
    expect(bili["R+1"]).toBeTypeOf("number");
    expect(matrix["cmp:bun_to_creatinine_ratio"].C001["L-92"]).toBeUndefined();
    for (const [key, byCrew] of Object.entries(matrix)) {
      for (const series of Object.values(byCrew)) {
        for (const v of Object.values(series)) expect(Number.isFinite(v), key).toBe(true);
      }
    }
  });

  it("ignores the *_percent columns of the multiplex files", () => {
    expect(matrix["immune:il_6"]).toBeDefined();
    expect(Object.keys(matrix).some((k) => k.startsWith("immune:") && k.endsWith("_percent"))).toBe(false);
    expect(matrix["cbc:monocytes"]).toBeDefined(); // CBC monocytes_value_percent is a value column
  });
});

describe("signature T1: QC", () => {
  it("qcLog has exactly the 12 entries of the fixture", () => {
    expect(qcLog).toHaveLength(12);
    expect(qcLog).toEqual(SIGNATURE_REFERENCE.qc_log);
  });

  it("QC-1 rebuilds the five C003 L-92 absolute counts from percent x WBC x 10", () => {
    const qc1 = qcLog.filter((e) => e.rule === "QC1_cbc_row_shift");
    expect(qc1.every((e) => e.crew === "C003" && e.timepoint === "L-92")).toBe(true);
    const abs = qc1.filter((e) => e.analyte.startsWith("absolute_")).map((e) => [e.analyte, e.old, e.new]);
    expect(abs).toEqual([
      ["absolute_neutrophils", 10.1, 6826],
      ["absolute_lymphocytes", 6826, 1997],
      ["absolute_monocytes", 1997, 614],
      ["absolute_eosinophils", 614, 125],
      ["absolute_basophils", 125, 38],
    ]);
    expect(matrix["cbc:absolute_neutrophils"].C003["L-92"]).toBe(6826);
    expect(matrix["cbc:absolute_lymphocytes"].C003["L-92"]).toBe(1997);
    expect(matrix["cbc:absolute_monocytes"].C003["L-92"]).toBe(614);
  });

  it("QC-1 deletes mchc, mpv, platelet_count and rdw of that row", () => {
    const nulled = qcLog
      .filter((e) => e.rule === "QC1_cbc_row_shift" && !e.analyte.startsWith("absolute_"))
      .map((e) => [e.analyte, e.old, e.new]);
    expect(nulled).toEqual([
      ["mchc", 29.6, null],
      ["mpv", 330, null],
      ["platelet_count", 12.9, null],
      ["rdw", 32.4, null],
    ]);
    for (const a of ["mch", "mchc", "mpv", "platelet_count", "rdw"]) {
      expect(matrix[`cbc:${a}`].C003["L-92"], a).toBeUndefined();
      expect(matrix[`cbc:${a}`].C003["L-44"], a).toBeTypeOf("number");
    }
  });

  it("QC-2 removes glucose at R+45 for C002 (44), C003 (36), C004 (43); C001 keeps 84", () => {
    const qc2 = qcLog.filter((e) => e.rule === "QC2_glucose_artifact").map((e) => [e.crew, e.timepoint, e.old, e.new]);
    expect(qc2).toEqual([
      ["C002", "R+45", 44, null],
      ["C003", "R+45", 36, null],
      ["C004", "R+45", 43, null],
    ]);
    const g = matrix["cmp:glucose"];
    expect(g.C001["R+45"]).toBe(84);
    expect(g.C002["R+45"]).toBeUndefined();
    expect(g.C003["R+45"]).toBeUndefined();
    expect(g.C004["R+45"]).toBeUndefined();
  });

  it("reads immune:il_6 C003 R+1 = 7.6", () => {
    expect(matrix["immune:il_6"].C003["R+1"]).toBe(7.6);
  });

  it("excluded analytes are loaded (for context) and named exactly as in the files", () => {
    expect([...EXCLUDED_MARKERS].sort()).toEqual([
      "cardio:haptoglobin",
      "cbc:absolute_basophils",
      "cbc:absolute_eosinophils",
      "cbc:basophils",
      "cbc:eosinophils",
      "cmp:bun_to_creatinine_ratio",
      "cmp:egfr_african_american",
      "cmp:egfr_non_african_american",
    ]);
    for (const key of EXCLUDED_MARKERS) expect(matrix[key], key).toBeDefined();
  });

  it("the server trace of the signature routes includes the CSVs (Vercel)", () => {
    const includes = nextConfig.outputFileTracingIncludes ?? {};
    for (const route of ["/signature", "/demo/signature", "/api/signature/**", "/api/checkins/**"]) {
      expect(includes[route], route).toEqual(["./data/nasa/**/*.csv"]);
    }
  });

  it("is deterministic and does not mutate between loads", () => {
    const again = buildLabMatrix(files);
    expect(again.qcLog).toEqual(qcLog);
    expect(again.matrix["cmp:glucose"]).toEqual(matrix["cmp:glucose"]);
    expect(getLabData()).toBe(getLabData()); // memoised per process
  });
});
