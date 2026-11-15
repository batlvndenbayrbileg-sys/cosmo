import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POST_TIMEPOINTS, PRE_TIMEPOINTS, REFERENCE_CREW, TIMEPOINTS } from "@/lib/signature/config";
import { scorePanel } from "@/lib/signature/engine";
import { parseSecondAssay } from "@/lib/signature/secondAssay";
import { SECOND_ASSAY_REFERENCE, SIGNATURE_REFERENCE } from "@/lib/signature/reference";
import { findLabFile, findSecondAssayFile, getLabData, loadSecondAssay } from "@/server/signature/files";

const second = loadSecondAssay();

describe("signature T11: second assay loader", () => {
  it("finds the CSV whose name contains Alamar, and the main loader does not pick it", () => {
    expect(path.basename(findSecondAssayFile())).toBe("OSD-575_LSDS-8_Alamar_NULISA_serum_TRANSFORMED.csv");
    for (const kind of ["cbc", "cmp", "cardio", "immune"] as const) expect(findLabFile(kind)).not.toMatch(/Alamar/);
  });

  it("the app's second fixture is a byte copy of docs/signature_reference/expected_second_assay.json", () => {
    const a = fs.readFileSync(path.join(process.cwd(), "src", "data", "signature_second_assay.json"));
    const b = fs.readFileSync(path.join(process.cwd(), "docs", "signature_reference", "expected_second_assay.json"));
    expect(a.equals(b)).toBe(true);
    expect(SECOND_ASSAY_REFERENCE.CONFIRM_LOG2).toBe(0.5);
  });

  it("27 rows, 203 analytes", () => {
    expect(second.rows).toHaveLength(27);
    expect(Object.keys(second.matrix)).toHaveLength(203);
    expect(Object.keys(second.matrix)).toHaveLength(SECOND_ASSAY_REFERENCE.second_assay_analytes);
    expect([...new Set(second.rows.map((r) => r.crew))].sort()).toEqual([...REFERENCE_CREW]);
  });

  it("C003 has no L-44; every other crew member has all seven draws", () => {
    const missing = REFERENCE_CREW.flatMap((c) => TIMEPOINTS.filter((t) => !second.rows.some((r) => r.crew === c && r.timepoint === t)).map((t) => `${c}_${t}`));
    expect(missing).toEqual(["C003_L-44"]);
    expect(missing).toEqual(SECOND_ASSAY_REFERENCE.missing_second_assay_samples);
    expect(second.matrix.il6.C003["L-44"]).toBeUndefined();
    expect(Object.keys(second.matrix.il6.C003).sort()).toEqual(["L-3", "L-92", "R+1", "R+194", "R+45", "R+82"]);
  });

  it("il6 C004 R+1 = 14.53 (2 decimals); the pairs used by the cross-check are present", () => {
    expect(Math.round(second.matrix.il6.C004["R+1"]! * 100) / 100).toBe(14.53);
    for (const a of ["il6", "cxcl8", "ccl2", "il10", "il27"]) {
      expect(second.matrix[a], a).toBeDefined();
      for (const c of REFERENCE_CREW) expect(Object.keys(second.matrix[a][c]).length, `${a} ${c}`).toBeGreaterThanOrEqual(6);
    }
    // only the *_concentration_npq columns are read
    expect(Object.keys(second.matrix).some((k) => k.includes("percent"))).toBe(false);
  });

  it("C003's second-assay baseline has two pre-flight draws (L-92, L-3)", () => {
    const pre = PRE_TIMEPOINTS.filter((t) => second.matrix.il6.C003[t] !== undefined);
    expect(pre).toEqual(["L-92", "L-3"]);
  });

  it("parses a BOM and missing cells like Python's csv + float()", () => {
    const t = parseSecondAssay("﻿Sample ID,il6_concentration_npq,il6_percent_normalized_value\r\nC001_serum_L-92,12.5,99\r\nC002_serum_R+1,NA,98\r\n");
    expect(t.rows).toHaveLength(2);
    expect(t.matrix.il6.C001["L-92"]).toBe(12.5);
    expect(t.matrix.il6.C002["R+1"]).toBeUndefined();
    expect(Object.keys(t.matrix)).toEqual(["il6"]);
  });

  it("is memoised, and the main loader still returns the same matrix (FRI of all 16 panels unchanged)", () => {
    expect(loadSecondAssay()).toBe(loadSecondAssay());
    const { matrix, qcLog } = getLabData();
    expect(qcLog).toHaveLength(12);
    expect(Object.keys(matrix).some((k) => k.includes("npq"))).toBe(false);
    for (const c of REFERENCE_CREW) {
      for (const t of POST_TIMEPOINTS) {
        const f = SIGNATURE_REFERENCE.panels[`${c}_${t}`];
        const p = scorePanel(matrix, c, t);
        expect(p.cls, `${c} ${t}`).toBe(f.class);
        if (f.fri !== null) expect(p.fri!, `${c} ${t}`).toBeCloseTo(f.fri, 1);
      }
    }
  });
});
