import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { labsStrings } from "@/i18n/strings/labs";
import type { Lang } from "@/lib/types";
import { batYellow } from "@/lib/fixtures/dashboard";
import { APP_CREW_REFERENCE_PANELS } from "@/lib/signature/config";
import { countAt, decodePerson, flaggedAt, formatDecimal, formatFold, noteKey, statusKey, type UrinePersonView } from "@/lib/labs/urine";
import { getUrinePanelFile, getUrinePersonSlice } from "@/server/labs/urine";
import { GET as getUrine } from "@/app/api/labs/urine/route";
import { UrinePanelView } from "@/components/labs/UrinePanelView";
import { LabsPanel } from "@/components/labs/LabsPanel";
import { NAV_ITEMS, TopBar } from "@/components/dashboard/TopBar";
import { readXlsx, sheetObjects } from "./helpers/xlsx";

const XLSX = path.join(process.cwd(), "data", "urine", "urine_panel_personal_results.xlsx");
const sheets = readXlsx(XLSX);
const results = sheetObjects(sheets.get("Results_long")!);
const flaggedSheet = sheetObjects(sheets.get("Flagged_only")!);
const summarySheet = sheetObjects(sheets.get("Person_summary")!);
const file = getUrinePanelFile();

const views = new Map<string, UrinePersonView>();
const view = (person: string): UrinePersonView => {
  if (!views.has(person)) views.set(person, decodePerson(getUrinePersonSlice(person)!));
  return views.get(person)!;
};
const round3 = (v: unknown) => (typeof v === "number" ? Math.round(v * 1000) / 1000 || 0 : null);
const sheetRow = (person: string, analyte: string, tp: string) =>
  results.find((r) => r.Person === person && r.Analyte === analyte && r.Timepoint === tp);
const point = (person: string, analyte: string, tp: string) =>
  view(person).analytes.find((a) => a.analyte === analyte)?.points.find((p) => p.timepoint === tp);

const html = (el: ReactElement) => renderToStaticMarkup(el);
const Provider = I18nProvider as unknown as ComponentType<{ initialLang: Lang }>;
const mn = (el: ReactElement) => renderToStaticMarkup(createElement(Provider, { initialLang: "mn" }, el));
const textOf = (markup: string) =>
  markup
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("urine panel data: src/data/urine_panel.json against the workbook", () => {
  it("was generated from this exact workbook (sha-256) and keeps its row counts", () => {
    expect(file.source.sha256).toBe(createHash("sha256").update(readFileSync(XLSX)).digest("hex"));
    expect(results).toHaveLength(4246);
    expect(flaggedSheet).toHaveLength(226);
    expect(summarySheet).toHaveLength(11);
    expect(file.source.rows).toEqual({ results: 4246, flagged: 226, summary: 11 });
    expect(file.persons.reduce((n, p) => n + p.analytes.reduce((m, a) => m + a.points.length, 0), 0)).toBe(4246);
    expect(file.flagged).toHaveLength(226);
    expect(file.summary.rows).toHaveLength(11);
    expect(file.persons.map((p) => p.person)).toEqual(["C001", "C002", "C003", "C004"]);
  });

  it("spot values read from the sheet", () => {
    const cxcl8 = point("C002", "CXCL8", "R+1")!;
    expect(cxcl8).toMatchObject({ npq: 15.894, fold: 15.141, status: "Abnormal high", kind: "abnormal", direction: "up" });
    expect(sheetRow("C002", "CXCL8", "R+1")).toMatchObject({ NPQ: 15.894, Fold_change: 15.141, Status: "Abnormal high" });
    expect(point("C002", "S100A12", "R+1")!.fold).toBe(15.863);
    expect(point("C002", "BMP10", "R+1")).toMatchObject({ status: "Abnormal low", direction: "down", npq: 2.46 });
    const c2 = view("C002").analytes.find((a) => a.analyte === "CXCL8")!;
    expect({ baseline: c2.baseline, low: c2.low, high: c2.high, n: c2.nBaseline }).toEqual({ baseline: 11.974, low: 8.565, high: 15.383, n: 3 });
    const c3 = view("C003").post.find((p) => p.timepoint === "R+1")!;
    expect(c3.counts).toEqual({ normal: 157, borderline: 25, abnormal: 10, insufficient: 1 });
    const c4 = view("C004").post.find((p) => p.timepoint === "R+82")!;
    expect(c4.counts).toEqual({ normal: 154, borderline: 37, abnormal: 1, insufficient: 1 });
  });

  it("C001 has no R+1 (nor L-3) urine", () => {
    expect(results.some((r) => r.Person === "C001" && r.Timepoint === "R+1")).toBe(false);
    expect(summarySheet.some((r) => r.Person === "C001" && r.Timepoint === "R+1")).toBe(false);
    const c1 = view("C001");
    expect(c1.post.find((p) => p.timepoint === "R+1")).toMatchObject({ sampled: false, counts: null });
    expect(file.persons[0].timepoints).toEqual(["L-92", "L-44", "R+45", "R+82"]);
    expect(flaggedAt(c1, "R+1")).toEqual([]);
  });

  it("every Results_long row is in the JSON with the sheet's values (3 decimals)", () => {
    const tpDay = new Map(file.timepoints.map((t) => [t.id, t]));
    for (const r of results) {
      const a = view(String(r.Person)).analytes.find((x) => x.analyte === r.Analyte);
      const p = a?.points.find((x) => x.timepoint === r.Timepoint);
      const key = `${r.Person} ${r.Analyte} ${r.Timepoint}`;
      expect(p, key).toBeDefined();
      expect(
        [p!.day, tpDay.get(p!.timepoint)!.phase, p!.npq, a!.baseline, a!.low, a!.high, p!.change, p!.fold, p!.z, p!.adjusted, p!.status, p!.note, a!.nBaseline],
        key,
      ).toEqual([
        r.Day,
        r.Phase,
        round3(r.NPQ),
        round3(r.Baseline_mean),
        round3(r.Normal_low),
        round3(r.Normal_high),
        round3(r.Change_log2),
        round3(r.Fold_change),
        round3(r.Z_score),
        round3(r.Change_log2_sample_adjusted),
        r.Status,
        r.Note ?? "",
        r.N_baseline,
      ]);
    }
  }, 60_000);

  it("Person_summary matches the counts from the rows; Flagged_only is the Borderline / Abnormal rows", () => {
    for (const s of summarySheet) {
      const v = view(String(s.Person));
      const want = { normal: s.Normal, borderline: s.Borderline, abnormal: s.Abnormal, insufficient: s.Insufficient };
      expect(v.post.find((p) => p.timepoint === s.Timepoint)?.counts, `${s.Person} ${s.Timepoint}`).toEqual(want);
      expect(countAt(v, String(s.Timepoint)), `${s.Person} ${s.Timepoint} from rows`).toEqual(want);
    }
    const fromView = file.persons.flatMap((p) =>
      ["R+1", "R+45", "R+82"].flatMap((tp) => flaggedAt(view(p.person), tp).map((f) => `${p.person} ${f.analyte.analyte} ${tp}`)),
    );
    expect(fromView.sort()).toEqual(flaggedSheet.map((r) => `${r.Person} ${r.Analyte} ${r.Timepoint}`).sort());
  });

  it("every sheet Status and Note has a translation key", () => {
    for (const s of file.statuses) expect(statusKey(s.label), s.label).not.toBeNull();
    for (const n of file.notes.filter((x) => x !== "")) expect(noteKey(n), n).not.toBeNull();
    for (const lang of ["en", "mn"] as const) {
      for (const s of file.statuses) expect(labsStrings[lang][`dashboard.labs.status.${statusKey(s.label)}`]).toBeTruthy();
      for (const n of file.notes.filter((x) => x !== "")) expect(labsStrings[lang][`dashboard.labs.note.${noteKey(n)}`]).toBeTruthy();
    }
  });

  it("flagged order: Abnormal first, then by |sample-adjusted change|; fold shown with one decimal", () => {
    const list = flaggedAt(view("C002"), "R+1");
    expect(list).toHaveLength(15);
    expect(list.slice(0, 3).map((f) => f.analyte.analyte)).toEqual(["BMP10", "S100A12", "CXCL8"]);
    expect(list.slice(3).every((f) => f.point.kind === "borderline")).toBe(true);
    for (let i = 4; i < list.length; i++) {
      expect(Math.abs(list[i - 1].point.adjusted ?? 0)).toBeGreaterThanOrEqual(Math.abs(list[i].point.adjusted ?? 0));
    }
    expect(formatFold(15.141)).toBe("x15.1");
    expect(formatFold(0.143)).toBe("x0.14");
    expect(formatFold(null)).toBe("–");
  });

  it("folds and chart numbers round from the decimal value, not the binary float (2.55 is 2.5499... as a float)", () => {
    // half-way at the shown precision: decimal rounding, and the sheet's Change_log2 breaks the tie (fold = 2^change)
    expect(formatFold(2.55)).toBe("x2.6");
    expect(formatFold(0.495)).toBe("x0.50");
    expect(formatFold(0.075)).toBe("x0.08");
    expect(formatFold(2.55, 1.351)).toBe("x2.6"); // 2^1.351 = 2.5509
    expect(formatFold(0.495, -1.013)).toBe("x0.50"); // 2^-1.013 = 0.4955
    expect(formatFold(0.075, -3.736)).toBe("x0.08"); // 2^-3.736 = 0.07505
    expect(formatFold(2.55, 1.3495)).toBe("x2.5"); // 2^1.3495 = 2.5482: the change says the true fold is below half-way
    expect(formatFold(15.141, 3.92)).toBe("x15.1");
    expect(formatDecimal(2.55, 1)).toBe("2.6");
    expect(formatDecimal(2.65, 1)).toBe("2.7");
    expect(formatDecimal(-2.55, 1)).toBe("-2.6");
    expect(formatDecimal(-0.04, 1)).toBe("0.0");
    expect(formatDecimal(11.974, 1)).toBe("12.0");
    expect(formatDecimal(null, 1)).toBe("–");

    // the workbook rows the review named
    const c2 = point("C002", "S100A12", "R+82")!;
    expect([c2.fold, c2.change, c2.status]).toEqual([2.55, 1.351, "Borderline high"]);
    expect(formatFold(c2.fold, c2.change)).toBe("x2.6");
    expect(formatFold(point("C004", "IL17F", "R+82")!.fold, point("C004", "IL17F", "R+82")!.change)).toBe("x0.50");
    expect(formatFold(point("C003", "IL17B", "R+82")!.fold, point("C003", "IL17B", "R+82")!.change)).toBe("x0.08");
    const out = html(createElement(UrinePanelView, { view: view("C002"), initialTimepoint: "R+82" }));
    expect(out).toMatch(/data-analyte="S100A12"[\s\S]*?x2\.6[\s\S]*?Borderline high/);

    // every fold shown anywhere agrees with 2^Change_log2 to within half a shown step (plus the 3-decimal slack)
    for (const p of file.persons) {
      for (const a of view(p.person).analytes) {
        for (const x of a.points) {
          if (x.fold === null || x.change === null) continue;
          const shown = Number(formatFold(x.fold, x.change).slice(1));
          const exact = 2 ** x.change;
          const step = x.fold >= 1 ? 0.1 : 0.01;
          expect(Math.abs(shown - exact), `${p.person} ${a.analyte} ${x.timepoint}`).toBeLessThanOrEqual(step / 2 + exact * 4e-4 + 5e-4);
        }
      }
    }
  });
});

describe("GET /api/labs/urine", () => {
  const get = (qs: string) => getUrine(new Request(`http://localhost/api/labs/urine${qs}`));

  it("returns one person's slice only", async () => {
    const res = await get("?person=C002");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.person.person).toBe("C002");
    expect(body.person.analytes).toHaveLength(193);
    expect(body.summary.map((r: unknown[]) => r[1])).toEqual(["R+1", "R+45", "R+82"]);
    expect(body).not.toHaveProperty("persons");
    const whole = JSON.stringify(file).length;
    expect(JSON.stringify(body).length).toBeLessThan(whole / 3);
  });

  it("rejects anything but C001..C004", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?person=bat")).status).toBe(400);
    expect((await get("?person=C005")).status).toBe(400);
  });
});

describe("Labs tab view (server render)", () => {
  it("C002 R+1: three Abnormal, CXCL8 x15.1 Abnormal high, honest caption and the dataset", () => {
    const out = html(createElement(UrinePanelView, { view: view("C002"), initialTimepoint: "R+1" }));
    const text = textOf(out);
    expect(text).toContain("3 Abnormal");
    expect(text).toContain("12 Borderline");
    expect(out.match(/data-slot="status-pill" data-status="red"/g)).toHaveLength(3);
    expect(out).toMatch(/data-analyte="CXCL8"[\s\S]*?x15\.1[\s\S]*?Abnormal high/);
    expect(out).toMatch(/data-analyte="S100A12"[\s\S]*?x15\.9/);
    expect(out).toMatch(/data-analyte="BMP10"[\s\S]*?x0\.14[\s\S]*?Abnormal low/);
    // the list order: the three Abnormal first
    const order = [...out.matchAll(/data-analyte="([^"]+)"/g)].map((m) => m[1]);
    expect(order.slice(0, 3)).toEqual(["BMP10", "S100A12", "CXCL8"]);
    expect(text).toContain("Outside personal range, also after sample-level adjustment");
    expect(text).toContain("Changes versus the person's own pre-flight urine. Not a clinical test or a diagnosis.");
    expect(text).not.toMatch(/\byour own\b/i);
    expect(text).toContain("Borderline means: confirm before acting");
    expect(text).toContain("NASA OSDR OSD-656");
    expect(text).toContain("Alamar NULISA");
    expect(text).toContain("reference crew member C002");
    // the top analyte's chart is open, with the personal range in text
    expect(text).toContain("BMP10 over time");
    expect(text).toContain("Personal range 2.7 to 7.8, baseline 5.3.");
    expect(out).toContain('aria-pressed="true" aria-label="R+1: 178 Normal, 12 Borderline, 3 Abnormal, 0 Insufficient"');
  });

  it("an analyte picked in the list drives the chart", () => {
    const out = textOf(html(createElement(UrinePanelView, { view: view("C002"), initialTimepoint: "R+1", initialAnalyte: "CXCL8" })));
    expect(out).toContain("CXCL8 over time");
    expect(out).toContain("Personal range 8.6 to 15.4, baseline 12.0.");
  });

  it("phones: the analyte name is never cut (wraps, pill on its own row); lg truncates with a title", () => {
    const out = html(createElement(UrinePanelView, { view: view("C003"), initialTimepoint: "R+1" }));
    const names = [...out.matchAll(/<span([^>]*data-slot="labs-analyte-name"[^>]*)>([^<]*)<\/span>/g)];
    expect(names.length).toBe(flaggedAt(view("C003"), "R+1").length);
    for (const [, attrs, name] of names) {
      expect(attrs).toContain(`title="${name}"`);
      const cls = /class="([^"]*)"/.exec(attrs)![1].split(/\s+/);
      expect(cls).not.toContain("truncate");
      expect(cls).toContain("lg:truncate");
      expect(cls).toContain("wrap-anywhere");
    }
    // the row is two columns below lg (pill under the name), three at lg
    expect(out).toMatch(/data-analyte="[^"]+"[^>]*class="grid w-full grid-cols-\[18px_minmax\(0,1fr\)\] [^"]*lg:grid-cols-\[18px_minmax\(0,1fr\)_auto\]/);
    expect(out).toContain('class="col-start-2 row-start-2 flex min-w-0 lg:col-start-3 lg:row-start-1 lg:justify-end"');
  });

  it("C001 R+1: no urine sample message", () => {
    const out = html(createElement(UrinePanelView, { view: view("C001"), initialTimepoint: "R+1" }));
    expect(textOf(out)).toContain("No urine sample at this time point.");
    expect(out).toContain('data-slot="labs-no-sample"');
    expect(out).toContain('aria-label="R+1: no urine sample"');
    expect(out).not.toContain("data-analyte=");
    // default time point is the first one with a sample
    expect(textOf(html(createElement(UrinePanelView, { view: view("C001") })))).toContain("Flagged at R+45");
  });

  it("renders in Mongolian", () => {
    const out = textOf(mn(createElement(UrinePanelView, { view: view("C002"), initialTimepoint: "R+1" })));
    expect(out).toContain("Шээсний шинжилгээ");
    expect(out).toContain("Хэвийн бус, өндөр");
    expect(out).toContain("x15.1");
    expect(textOf(mn(createElement(UrinePanelView, { view: view("C001"), initialTimepoint: "R+1" })))).toContain(
      "Энэ хугацаанд шээсний дээж аваагүй.",
    );
  });

  it("the tab loads lazily: loading state for a linked crew member, a note for an unlinked one", () => {
    expect(APP_CREW_REFERENCE_PANELS.saraa).toBe("C002");
    expect(textOf(html(createElement(LabsPanel, { crewId: "saraa" })))).toContain("Loading the urine panel...");
    expect(textOf(html(createElement(LabsPanel, { crewId: "nobody" })))).toContain("No reference urine panel is linked");
  });

  it("the Labs tab is in the dashboard tablist", () => {
    expect(NAV_ITEMS.map((n) => n.id)).toContain("labs");
    const bar = html(createElement(TopBar, { payload: batYellow, viewer: "crew", active: "labs", onNavigate: () => {} }));
    expect(bar).toMatch(/id="dashboard-tab-labs"[^>]*aria-selected="true"/);
    expect(textOf(bar)).toContain("Labs");
    expect(textOf(mn(createElement(TopBar, { payload: batYellow, viewer: "crew", active: "labs", onNavigate: () => {} })))).toContain(
      "Шинжилгээ",
    );
  });
});

describe("Labs strings", () => {
  it("EN and MN have identical key sets", () => {
    expect(Object.keys(labsStrings.mn).sort()).toEqual(Object.keys(labsStrings.en).sort());
  });

  it("no diagnosis wording and no disease names (the caption only says it is not one)", () => {
    for (const lang of ["en", "mn"] as const) {
      for (const [k, v] of Object.entries(labsStrings[lang])) {
        if (k === "dashboard.labs.caption") continue;
        expect(/diagnos|disease|infection|inflammat|kidney|онош|өвчин|үрэвс|бөөр/iu.test(v), `${lang} ${k}`).toBe(false);
      }
    }
  });
});
