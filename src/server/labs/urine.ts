import "server-only";

/**
 * Server-side access to the urine panel (src/data/urine_panel.json, generated from
 * data/urine/urine_panel_personal_results.xlsx by scripts/urine_xlsx_to_json.py). The JSON is imported here only, so it
 * is part of the server bundle of the routes that use it and never of the dashboard's client bundle: the Labs tab asks
 * GET /api/labs/urine for one person's slice when it opens.
 */

import fixture from "@/data/urine_panel.json";
import { sliceForPerson, type UrinePanelFile, type UrinePersonSlice } from "@/lib/labs/urine";

const FILE = fixture as unknown as UrinePanelFile;

export function getUrinePanelFile(): UrinePanelFile {
  return FILE;
}

/** one Inspiration4 reference crew member's slice (C001..C004), or null */
export function getUrinePersonSlice(person: string): UrinePersonSlice | null {
  return sliceForPerson(FILE, person);
}
