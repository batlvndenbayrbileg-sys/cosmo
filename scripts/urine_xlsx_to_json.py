"""
Urine panel workbook -> src/data/urine_panel.json (the dashboard's "Labs" tab reads the JSON; the .xlsx stays the source).

Source: data/urine/urine_panel_personal_results.xlsx, a teammate's derived analysis of the NASA OSDR OSD-656
Inspiration4 urine samples (Alamar NULISA panel, NPQ = log2 units). Sheets: README, Results_long, Flagged_only,
Person_summary.

Standard library only (no openpyxl): an .xlsx file is a zip of XML parts. Cells are read as shared strings
(t="s"), inline strings (t="inlineStr"), formula strings (t="str"), booleans (t="b") or numbers (no t / t="n").
Empty cells and empty strings become null. Floats are rounded to 3 decimals, as shown in the sheet.

The output groups Results_long by person and analyte (the baseline and the personal range are one value per
person and analyte; the script fails if that ever stops being true) and stores each time point as one short row
of numbers and indexes into small string tables, so no key or long text repeats per row. Flagged_only is checked
against Results_long and stored as [person, analyte, timepoint] references.

Run:  python -I scripts/urine_xlsx_to_json.py [path/to/workbook.xlsx] [path/to/output.json]
      (pnpm urine:json)
"""

import hashlib
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_XLSX = os.path.join(ROOT, "data", "urine", "urine_panel_personal_results.xlsx")
DEFAULT_OUT = os.path.join(ROOT, "src", "data", "urine_panel.json")

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PR = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"m": M}

RESULT_COLUMNS = [
    "Person", "Analyte", "Timepoint", "Day", "Phase", "NPQ", "Baseline_mean", "Normal_low", "Normal_high",
    "Change_log2", "Fold_change", "Z_score", "Change_log2_sample_adjusted", "Status", "Status_group", "Note",
    "N_baseline",
]
SUMMARY_COLUMNS = ["Person", "Timepoint", "Normal", "Borderline", "Abnormal", "Insufficient"]
# per time point row in the output, in this order (Timepoint, Status and Note as indexes into their tables)
POINT_COLUMNS = ["Timepoint", "NPQ", "Change_log2", "Fold_change", "Z_score", "Change_log2_sample_adjusted", "Status", "Note"]


def col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def text_of(el):
    """all <t> text inside a shared-string item or an inline string (rich text runs are joined)"""
    return "".join(t.text or "" for t in el.iter("{%s}t" % M))


def read_workbook(path):
    """{sheet name: list of rows (lists of cell values)}"""
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        shared = []
        if "xl/sharedStrings.xml" in names:
            sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
            shared = [text_of(si) for si in sst.findall("m:si", NS)]
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        targets = {r.get("Id"): r.get("Target") for r in rels.findall("{%s}Relationship" % PR)}
        sheets = {}
        for sh in wb.find("m:sheets", NS):
            target = targets[sh.get("{%s}id" % R)]
            part = target.lstrip("/") if target.startswith("/") else "xl/" + target
            root = ET.fromstring(z.read(part))
            rows = []
            for row in root.find("m:sheetData", NS):
                cells = {}
                for c in row.findall("m:c", NS):
                    t = c.get("t")
                    v = c.find("m:v", NS)
                    if t == "inlineStr":
                        inline = c.find("m:is", NS)
                        val = text_of(inline) if inline is not None else None
                    elif t == "s":
                        val = shared[int(v.text)]
                    elif t in ("str", "e"):
                        val = v.text if v is not None else None
                    elif t == "b":
                        val = v is not None and v.text == "1"
                    else:
                        val = float(v.text) if v is not None and v.text not in (None, "") else None
                    if val == "":
                        val = None
                    cells[col_index(c.get("r"))] = val
                width = max(cells) + 1 if cells else 0
                rows.append([cells.get(i) for i in range(width)])
            sheets[sh.get("name")] = rows
        return sheets


def num(v, digits=3):
    if v is None:
        return None
    if isinstance(v, str):
        raise ValueError("expected a number, got %r" % v)
    r = round(v, digits)
    if r == int(r) and abs(r) < 1e15:
        r = int(r)
    return 0 if r == 0 else r


def table(rows, columns, sheet):
    header = [h for h in rows[0] if h is not None]
    if header != columns:
        raise SystemExit("%s: unexpected columns %r" % (sheet, header))
    out = []
    for r in rows[1:]:
        r = (r + [None] * len(columns))[: len(columns)]
        if all(v is None for v in r):
            continue
        out.append(dict(zip(columns, r)))
    return out


def same(a, b, what):
    if a != b:
        raise SystemExit("inconsistent %s: %r vs %r" % (what, a, b))


def main(argv):
    xlsx = argv[1] if len(argv) > 1 else DEFAULT_XLSX
    out_path = argv[2] if len(argv) > 2 else DEFAULT_OUT
    with open(xlsx, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    sheets = read_workbook(xlsx)
    for s in ("README", "Results_long", "Flagged_only", "Person_summary"):
        if s not in sheets:
            raise SystemExit("missing sheet " + s)

    method = [[r[0], r[1]] for r in sheets["README"][1:] if r and r[0]]
    results = table(sheets["Results_long"], RESULT_COLUMNS, "Results_long")
    flagged = table(sheets["Flagged_only"], RESULT_COLUMNS, "Flagged_only")
    summary = table(sheets["Person_summary"], SUMMARY_COLUMNS, "Person_summary")

    # string tables in first-seen order; the time points sorted by day
    tp_day, tp_phase = {}, {}
    statuses, status_group, notes = [], {}, []
    for r in results:
        tp = r["Timepoint"]
        if tp in tp_day:
            same(tp_day[tp], num(r["Day"]), "day of " + tp)
            same(tp_phase[tp], r["Phase"], "phase of " + tp)
        tp_day[tp], tp_phase[tp] = num(r["Day"]), r["Phase"]
        if r["Status"] not in statuses:
            statuses.append(r["Status"])
        if r["Status"] in status_group:
            same(status_group[r["Status"]], r["Status_group"], "group of " + r["Status"])
        status_group[r["Status"]] = r["Status_group"]
        note = r["Note"] or ""
        if note not in notes:
            notes.append(note)
    timepoints = sorted(tp_day, key=lambda tp: tp_day[tp])
    tp_ix = {tp: i for i, tp in enumerate(timepoints)}

    persons = {}
    for r in results:
        p = persons.setdefault(r["Person"], {"person": r["Person"], "analytes": {}})
        a = p["analytes"].get(r["Analyte"])
        head = {
            "analyte": r["Analyte"],
            "baseline": num(r["Baseline_mean"]),
            "low": num(r["Normal_low"]),
            "high": num(r["Normal_high"]),
            "nBaseline": num(r["N_baseline"]),
        }
        if a is None:
            a = dict(head, points=[])
            p["analytes"][r["Analyte"]] = a
        else:
            same({k: a[k] for k in head}, head, "baseline / range of %s %s" % (r["Person"], r["Analyte"]))
        a["points"].append([
            tp_ix[r["Timepoint"]],
            num(r["NPQ"]),
            num(r["Change_log2"]),
            num(r["Fold_change"]),
            num(r["Z_score"]),
            num(r["Change_log2_sample_adjusted"]),
            statuses.index(r["Status"]),
            notes.index(r["Note"] or ""),
        ])

    person_list = []
    for pid in sorted(persons):
        p = persons[pid]
        analytes = sorted(p["analytes"].values(), key=lambda a: a["analyte"])
        for a in analytes:
            a["points"].sort(key=lambda pt: pt[0])
        present = sorted({pt[0] for a in analytes for pt in a["points"]})
        person_list.append({"person": pid, "timepoints": [timepoints[i] for i in present], "analytes": analytes})

    # Flagged_only must be exactly the Borderline / Abnormal rows of Results_long
    by_key = {(r["Person"], r["Analyte"], r["Timepoint"]): r for r in results}
    for f in flagged:
        k = (f["Person"], f["Analyte"], f["Timepoint"])
        same(by_key.get(k), f, "Flagged_only row %r" % (k,))
    flagged_keys = [[f["Person"], f["Analyte"], f["Timepoint"]] for f in flagged]
    expected = [[r["Person"], r["Analyte"], r["Timepoint"]] for r in results if r["Status_group"] in ("Borderline", "Abnormal")]
    same(sorted(flagged_keys), sorted(expected), "Flagged_only vs Results_long Borderline / Abnormal rows")

    data = {
        "source": {
            "file": "data/urine/urine_panel_personal_results.xlsx",
            "sha256": sha,
            "dataset": "NASA OSDR OSD-656 (Inspiration4 urine)",
            "assay": "Alamar NULISA",
            "unit": "NPQ (log2)",
            "rows": {"results": len(results), "flagged": len(flagged), "summary": len(summary)},
            "generatedBy": "scripts/urine_xlsx_to_json.py",
        },
        "method": method,
        "timepoints": [{"id": tp, "day": tp_day[tp], "phase": tp_phase[tp]} for tp in timepoints],
        "statuses": [{"label": s, "group": status_group[s]} for s in statuses],
        "notes": notes,
        "pointColumns": POINT_COLUMNS,
        "persons": person_list,
        "flagged": flagged_keys,
        "summary": {
            "columns": SUMMARY_COLUMNS,
            "rows": [[r["Person"], r["Timepoint"]] + [num(r[c]) for c in SUMMARY_COLUMNS[2:]] for r in summary],
        },
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    # one person / table per line keeps diffs readable without repeating keys
    text = text.replace(',"persons":[', ',\n"persons":[\n').replace('},{"person":', '},\n{"person":')
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text + "\n")
    print(
        "wrote %s: %d result rows, %d flagged, %d summary rows, %d persons, %d analytes, %d bytes"
        % (os.path.relpath(out_path, ROOT), len(results), len(flagged), len(summary), len(person_list),
           len({a["analyte"] for p in person_list for a in p["analytes"]}), len(text) + 1)
    )


if __name__ == "__main__":
    main(sys.argv)
