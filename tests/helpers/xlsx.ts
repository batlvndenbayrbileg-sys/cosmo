import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/**
 * A tiny, test-only .xlsx reader (zip central directory + raw inflate + regex over the sheet XML), independent of the
 * Python converter, so the urine tests can check src/data/urine_panel.json against the workbook itself. Handles inline
 * strings, shared strings and numbers; nothing else is needed for the urine workbook.
 */

type Cell = string | number | null;

function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx: no zip end-of-central-directory record");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("xlsx: bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** sheet name -> rows of cells (empty cells and empty strings are null) */
export function readXlsx(path: string): Map<string, Cell[][]> {
  const files = unzip(readFileSync(path));
  const xml = (name: string) => files.get(name)?.toString("utf8") ?? "";
  const shared = [...xml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rels = new Map(
    [...xml("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[0])![1],
      /Target="([^"]+)"/.exec(m[0])![1],
    ]),
  );
  const sheets = new Map<string, Cell[][]>();
  for (const m of xml("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(/name="([^"]+)"/.exec(m[0])![1]);
    const target = rels.get(/r:id="([^"]+)"/.exec(m[0])![1])!;
    const part = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const rows: Cell[][] = [];
    for (const r of xml(part).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: Cell[] = [];
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = /\bt="([^"]+)"/.exec(c[2])?.[1];
        const body = c[3] ?? "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val: Cell;
        if (type === "inlineStr") val = texts(body);
        else if (type === "s") val = shared[Number(v)];
        else if (type === "str") val = v === undefined ? null : decode(v);
        else val = v === undefined || v === "" ? null : Number(v);
        row[colIndex(c[1])] = val === "" ? null : val;
      }
      rows.push(Array.from(row, (x) => x ?? null));
    }
    sheets.set(name, rows);
  }
  return sheets;
}

/** a sheet as objects keyed by its header row */
export function sheetObjects(rows: Cell[][]): Record<string, Cell>[] {
  const [header, ...body] = rows;
  return body
    .filter((r) => r.some((v) => v !== null))
    .map((r) => Object.fromEntries(header.map((h, i) => [String(h), r[i] ?? null])));
}
