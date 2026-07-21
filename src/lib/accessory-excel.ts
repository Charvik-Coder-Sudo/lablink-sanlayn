import * as XLSX from "xlsx";
import JSZip from "jszip";

export interface ParsedAccessoryRow {
  rowNumber: number; // 1-based row number in the source sheet, for error reporting
  description: string;
  make: string;
  model: string;
  serial_number: string;
  quantity: number;
  remarks: string;
  photoBlob: Blob | null;
}

export interface ParsedAccessoriesResult {
  rows: ParsedAccessoryRow[];
  sheetName: string;
  photosFound: number;
}

export interface RowValidationFailure {
  row: number;
  description: string;
  reason: string;
}

const HEADER_MAP: Record<string, string> = {
  "description": "description",
  "make": "make",
  "model": "model",
  "device sl no": "serial_number",
  "device sl no.": "serial_number",
  "device serial no": "serial_number",
  "device serial no.": "serial_number",
  "serial no": "serial_number",
  "serial no.": "serial_number",
  "qty": "quantity",
  "quantity": "quantity",
  "remarks": "remarks",
  "accessories photo": "photo",
  "accessory photo": "photo",
  "photo": "photo",
  // Equipment-only columns: never map to an accessory field, only used to disqualify
  // the equipment sheet from being mistaken for the accessories sheet below.
  "category": "category",
  "asset id": "assetId",
  "calibration date": "calibrationDate",
  "cal due date": "calibrationDate",
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function cell(row: unknown[], idx: number | undefined): string {
  if (idx === undefined) return "";
  const v = row[idx];
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

interface SheetPick {
  sheetName: string;
  sheetIndex: number;
  fields: Record<string, number>;
}

function pickAccessorySheet(wb: XLSX.WorkBook): SheetPick | null {
  let best: (SheetPick & { score: number }) | null = null;

  for (let i = 0; i < wb.SheetNames.length; i++) {
    const name = wb.SheetNames[i];
    const ws = wb.Sheets[name];
    const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (raw.length === 0) continue;
    const header = raw[0] as unknown[];
    const fields: Record<string, number> = {};
    header.forEach((h, colIdx) => {
      const key = HEADER_MAP[normalizeHeader(String(h ?? ""))];
      if (key && fields[key] === undefined) fields[key] = colIdx;
    });
    const qualifies = fields.description !== undefined && fields.quantity !== undefined && (fields.make !== undefined || fields.model !== undefined);
    if (!qualifies) continue;

    // "Photo" is accessories-only; "Category"/"Asset ID"/calibration dates are equipment-only.
    // Score sheets so the accessories sheet wins even though the equipment sheet also has
    // description/make/model/qty columns.
    let score = 0;
    if (fields.photo !== undefined) score += 3;
    if (fields.category !== undefined) score -= 3;
    if (fields.assetId !== undefined) score -= 3;
    if (fields.calibrationDate !== undefined) score -= 1;

    if (!best || score > best.score) best = { sheetName: name, sheetIndex: i, fields, score };
  }

  return best ? { sheetName: best.sheetName, sheetIndex: best.sheetIndex, fields: best.fields } : null;
}

/**
 * Best-effort extraction of embedded row-anchored images (xl/media/*) from the workbook's
 * OOXML drawing parts, mapped by the 0-indexed sheet row each image is anchored to. A parse
 * failure here must never block importing the row data itself, so all errors are swallowed.
 */
async function extractPhotosByRow(arrayBuffer: ArrayBuffer, sheetIndex: number): Promise<Map<number, Blob>> {
  const photos = new Map<number, Blob>();
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const parser = new DOMParser();

    const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
    const workbookRelsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
    if (!workbookXml || !workbookRelsXml) return photos;

    const wbDoc = parser.parseFromString(workbookXml, "application/xml");
    const sheetEl = Array.from(wbDoc.getElementsByTagName("sheet"))[sheetIndex];
    const rId = sheetEl?.getAttribute("r:id");
    if (!rId) return photos;

    const wbRelsDoc = parser.parseFromString(workbookRelsXml, "application/xml");
    const sheetTarget = Array.from(wbRelsDoc.getElementsByTagName("Relationship"))
      .find((r) => r.getAttribute("Id") === rId)?.getAttribute("Target");
    if (!sheetTarget) return photos;
    const sheetFileName = sheetTarget.split("/").pop()!;

    const sheetRelsXml = await zip.file(`xl/worksheets/_rels/${sheetFileName}.rels`)?.async("string");
    if (!sheetRelsXml) return photos;
    const sheetRelsDoc = parser.parseFromString(sheetRelsXml, "application/xml");
    const drawingTarget = Array.from(sheetRelsDoc.getElementsByTagName("Relationship"))
      .find((r) => r.getAttribute("Type")?.endsWith("/drawing"))?.getAttribute("Target");
    if (!drawingTarget) return photos;
    const drawingFileName = drawingTarget.split("/").pop()!;
    const drawingPath = `xl/drawings/${drawingFileName}`;

    const drawingXml = await zip.file(drawingPath)?.async("string");
    const drawingRelsXml = await zip.file(`xl/drawings/_rels/${drawingFileName}.rels`)?.async("string");
    if (!drawingXml || !drawingRelsXml) return photos;

    const drawingDoc = parser.parseFromString(drawingXml, "application/xml");
    const drawingRelsDoc = parser.parseFromString(drawingRelsXml, "application/xml");
    const relMap = new Map<string, string>();
    Array.from(drawingRelsDoc.getElementsByTagName("Relationship")).forEach((r) => {
      const id = r.getAttribute("Id");
      const target = r.getAttribute("Target");
      if (id && target) relMap.set(id, target);
    });

    const anchors = [
      ...Array.from(drawingDoc.getElementsByTagName("xdr:twoCellAnchor")),
      ...Array.from(drawingDoc.getElementsByTagName("xdr:oneCellAnchor")),
    ];

    for (const anchor of anchors) {
      const rowText = anchor.getElementsByTagName("xdr:from")[0]?.getElementsByTagName("xdr:row")[0]?.textContent;
      const rowIdx = rowText ? parseInt(rowText, 10) : NaN;
      if (Number.isNaN(rowIdx)) continue;

      const embedId = anchor.getElementsByTagName("a:blip")[0]?.getAttribute("r:embed");
      if (!embedId) continue;
      const mediaTarget = relMap.get(embedId);
      if (!mediaTarget) continue;
      const mediaFileName = mediaTarget.split("/").pop()!;
      const file = zip.file(`xl/media/${mediaFileName}`);
      if (!file) continue;

      photos.set(rowIdx, await file.async("blob"));
    }
  } catch {
    return photos;
  }
  return photos;
}

export async function parseAccessoriesWorkbook(file: File): Promise<ParsedAccessoriesResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const pick = pickAccessorySheet(wb);
  if (!pick) {
    throw new Error("Could not find a sheet with Description, Make/Model, and Qty columns");
  }

  const raw: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[pick.sheetName], { header: 1, defval: "" });
  const photosByXmlRow = await extractPhotosByRow(buf, pick.sheetIndex);

  const rows: ParsedAccessoryRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const description = cell(r, pick.fields.description);
    if (!description) continue;
    rows.push({
      rowNumber: i + 1,
      description,
      make: cell(r, pick.fields.make),
      model: cell(r, pick.fields.model),
      serial_number: cell(r, pick.fields.serial_number),
      quantity: Number(cell(r, pick.fields.quantity)) || 0,
      remarks: cell(r, pick.fields.remarks),
      photoBlob: photosByXmlRow.get(i) ?? null,
    });
  }

  return { rows, sheetName: pick.sheetName, photosFound: photosByXmlRow.size };
}

export function validateAccessoryRows(rows: ParsedAccessoryRow[]): {
  valid: ParsedAccessoryRow[];
  invalid: RowValidationFailure[];
} {
  const valid: ParsedAccessoryRow[] = [];
  const invalid: RowValidationFailure[] = [];

  for (const row of rows) {
    const missing: string[] = [];
    if (!row.description) missing.push("Description");
    if (!Number.isFinite(row.quantity) || row.quantity <= 0) missing.push("Qty");

    if (missing.length > 0) {
      invalid.push({ row: row.rowNumber, description: row.description || "(no description)", reason: `Missing ${missing.join(", ")}` });
    } else {
      valid.push(row);
    }
  }

  return { valid, invalid };
}
