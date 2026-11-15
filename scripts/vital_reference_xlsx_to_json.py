"""
General vital-sign reference workbook -> src/data/vital_reference.json (Cosmo's "what is a normal heart rate?" answers
read the JSON through src/lib/health/vitalReference.ts; the .xlsx stays the source).

Source: data/reference/vital_signs_reference.xlsx, two sheets:
  "Vital signs": one row per vital sign: name, unit, normal range text, danger text, normal low / high, danger below /
                 above (numbers, empty when the sheet has none), and a free-text note on other units.
  "Notes":       the caveats, one per row in column A (resting adults only, danger = get urgent help, symptoms count more
                 than numbers, rules of thumb, general reference and not a diagnosis).

Standard library only (no openpyxl): an .xlsx file is a zip of XML parts. Cells are read as shared strings (t="s"),
inline strings (t="inlineStr"), formula strings (t="str") or numbers. Empty cells become null.

Run:  python -I -X utf8 scripts/vital_reference_xlsx_to_json.py [path/to/workbook.xlsx] [path/to/output.json]
"""

import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_XLSX = os.path.join(ROOT, "data", "reference", "vital_signs_reference.xlsx")
DEFAULT_OUT = os.path.join(ROOT, "src", "data", "vital_reference.json")

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PR = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"m": M}

# the sheet's row names -> the stable ids the TypeScript module uses
IDS = {
    "Heart rate": "heart_rate",
    "Blood pressure, systolic": "bp_systolic",
    "Blood pressure, diastolic": "bp_diastolic",
    "Breathing rate": "breathing_rate",
    "Oxygen saturation (SpO2)": "spo2",
    "Body temperature": "temperature",
    "Blood glucose (fasting)": "glucose",
}

HEADER = [
    "Vital sign",
    "Unit",
    "Normal range",
    "Danger threshold",
    "Normal low",
    "Normal high",
    "Danger below",
    "Danger above",
    "Alt. units / notes",
]


def col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def shared_strings(z):
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    return ["".join(t.text or "" for t in si.iter("{%s}t" % M)) for si in root.findall("m:si", NS)]


def sheet_paths(z):
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    target = {r.get("Id"): r.get("Target") for r in rels.findall("{%s}Relationship" % PR)}
    out = {}
    for s in wb.find("m:sheets", NS):
        t = target[s.get("{%s}id" % R)].lstrip("/")
        out[s.get("name")] = t if t.startswith("xl/") else "xl/" + t
    return out


def read_rows(z, path, ss):
    root = ET.fromstring(z.read(path))
    rows = []
    for row in root.iter("{%s}row" % M):
        cells = {}
        for c in row.findall("m:c", NS):
            t = c.get("t")
            v = c.find("m:v", NS)
            if t == "s" and v is not None:
                val = ss[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % M))
            elif v is None or v.text is None:
                val = None
            elif t == "str":
                val = v.text
            else:
                num = float(v.text)
                val = int(num) if num.is_integer() else round(num, 3)
            if isinstance(val, str):
                val = val.strip() or None
            cells[col_index(c.get("r"))] = val
        width = max(cells) + 1 if cells else 0
        rows.append([cells.get(i) for i in range(width)])
    return rows


def number(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    return float(v) if "." in v else int(v)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_XLSX
    out = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT
    with zipfile.ZipFile(src) as z:
        ss = shared_strings(z)
        sheets = sheet_paths(z)
        vitals = read_rows(z, sheets["Vital signs"], ss)
        notes = read_rows(z, sheets["Notes"], ss)

    header = vitals[0][: len(HEADER)]
    if header != HEADER:
        raise SystemExit(f"unexpected header in 'Vital signs': {header}")

    signs = []
    for row in vitals[1:]:
        row = row + [None] * (len(HEADER) - len(row))
        if not row[0]:
            continue
        if row[0] not in IDS:
            raise SystemExit(f"unknown vital sign row: {row[0]!r}")
        signs.append(
            {
                "id": IDS[row[0]],
                "name": row[0],
                "unit": row[1],
                "normalText": row[2],
                "dangerText": row[3],
                "normalLow": number(row[4]),
                "normalHigh": number(row[5]),
                "dangerBelow": number(row[6]),
                "dangerAbove": number(row[7]),
                "note": row[8],
            }
        )
    missing = sorted(set(IDS.values()) - {s["id"] for s in signs})
    if missing:
        raise SystemExit(f"rows missing from the workbook: {missing}")

    doc = {
        "source": "data/reference/vital_signs_reference.xlsx",
        "signs": signs,
        "notes": [r[0] for r in notes if r and r[0]],
    }
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"wrote {out}: {len(signs)} vital signs, {len(doc['notes'])} notes")


if __name__ == "__main__":
    main()
