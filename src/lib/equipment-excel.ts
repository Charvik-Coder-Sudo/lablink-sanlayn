import * as XLSX from "xlsx";
import { format } from "date-fns";

export interface ParsedEquipmentRow {
  rowNumber: number; // 1-based Excel row number, for error reporting
  sl_no: string;
  category: string;
  description: string;
  make: string;
  model: string;
  device_serial_no: string;
  asset_id: string;
  qty: number | null;
  calibration_date: string | null; // yyyy-MM-dd or null
  calibration_due_date: string | null;
  remarks: string;
}

export interface ParsedEquipmentResult {
  rows: ParsedEquipmentRow[];
  sheetName: string;
}

export interface RowValidationFailure {
  row: number;
  description: string;
  reason: string;
}

const HEADER_MAP: Record<string, string> = {
  "sl no": "sl_no",
  "sl. no": "sl_no",
  "sl no.": "sl_no",
  "category": "category",
  "description": "description",
  "make": "make",
  "model": "model",
  "device sl no": "device_serial_no",
  "device sl no.": "device_serial_no",
  "device serial no": "device_serial_no",
  "device serial no.": "device_serial_no",
  "asset id": "asset_id",
  "qty": "qty",
  "quantity": "qty",
  "calibration date": "calibration_date",
  "cal due date": "calibration_due_date",
  "calibration due date": "calibration_due_date",
  "remarks": "remarks",
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function cellText(row: unknown[], idx: number | undefined): string {
  if (idx === undefined) return "";
  const v = row[idx];
  if (v === undefined || v === null) return "";
  if (v instanceof Date) return format(v, "yyyy-MM-dd");
  return String(v).trim();
}

function cellQty(row: unknown[], idx: number | undefined): number | null {
  if (idx === undefined) return null;
  const v = row[idx];
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Excel dates may arrive as a JS Date (when the workbook is read with cellDates: true and
 * the cell carries date formatting), a raw serial number (no date formatting applied), or a
 * plain text date. Blank or unparseable values return null rather than throwing.
 */
export function parseExcelDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : format(value, "yyyy-MM-dd");
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    return Number.isNaN(d.getTime()) ? null : format(d, "yyyy-MM-dd");
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : format(parsed, "yyyy-MM-dd");
  }

  return null;
}

interface SheetPick {
  sheetName: string;
  fields: Record<string, number>;
}

function pickEquipmentSheet(wb: XLSX.WorkBook): SheetPick | null {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (raw.length === 0) continue;
    const header = raw[0] as unknown[];
    const fields: Record<string, number> = {};
    header.forEach((h, colIdx) => {
      const key = HEADER_MAP[normalizeHeader(String(h ?? ""))];
      if (key && fields[key] === undefined) fields[key] = colIdx;
    });
    // "Category" only appears on the equipment sheet (the accessories sheet has no
    // Category/Asset ID columns), so this alone is enough to disambiguate.
    if (fields.description !== undefined && fields.qty !== undefined && fields.category !== undefined) {
      return { sheetName: name, fields };
    }
  }
  return null;
}

export async function parseEquipmentWorkbook(file: File): Promise<ParsedEquipmentResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const pick = pickEquipmentSheet(wb);
  if (!pick) {
    throw new Error("Could not find a sheet with Category, Description, and Qty columns");
  }

  const raw: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[pick.sheetName], { header: 1, defval: "" });
  const rows: ParsedEquipmentRow[] = [];

  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const description = cellText(r, pick.fields.description);
    const category = cellText(r, pick.fields.category);
    const deviceSerial = cellText(r, pick.fields.device_serial_no);
    const assetId = cellText(r, pick.fields.asset_id);
    const qty = cellQty(r, pick.fields.qty);
    const remarks = cellText(r, pick.fields.remarks);
    // Skip fully blank rows (common at the end of a sheet's used range).
    if (!description && !category && !deviceSerial && !assetId && qty === null && !remarks) continue;

    rows.push({
      rowNumber: i + 1,
      sl_no: cellText(r, pick.fields.sl_no),
      category,
      description,
      make: cellText(r, pick.fields.make),
      model: cellText(r, pick.fields.model),
      device_serial_no: deviceSerial,
      asset_id: assetId,
      qty,
      calibration_date: pick.fields.calibration_date !== undefined ? parseExcelDate(r[pick.fields.calibration_date]) : null,
      calibration_due_date: pick.fields.calibration_due_date !== undefined ? parseExcelDate(r[pick.fields.calibration_due_date]) : null,
      remarks,
    });
  }

  return { rows, sheetName: pick.sheetName };
}

/**
 * The existing `equipment` table has no calibration-date columns and we are not adding any
 * (per explicit "do not redesign the schema" instruction), so calibration dates are preserved
 * as readable text folded into Remarks rather than silently dropped.
 */
export function buildRemarksWithCalibration(row: ParsedEquipmentRow): string | null {
  const parts: string[] = [];
  if (row.remarks) parts.push(row.remarks);
  if (row.calibration_date || row.calibration_due_date) {
    const cal = row.calibration_date ? `Calibration: ${row.calibration_date}` : "Calibration: —";
    const due = row.calibration_due_date ? ` (due ${row.calibration_due_date})` : "";
    parts.push(`${cal}${due}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

const REQUIRED_ASSET_ID_REASON = "Asset ID (equipment_code is required and unique in the existing schema)";

export function validateEquipmentRows(rows: ParsedEquipmentRow[]): {
  valid: ParsedEquipmentRow[];
  invalid: RowValidationFailure[];
} {
  const valid: ParsedEquipmentRow[] = [];
  const invalid: RowValidationFailure[] = [];

  for (const row of rows) {
    const missing: string[] = [];
    if (!row.description) missing.push("Description");
    if (!row.category) missing.push("Category");
    if (!row.device_serial_no) missing.push("Device Serial Number");
    if (row.qty === null) missing.push("Qty");
    if (!row.asset_id) missing.push(REQUIRED_ASSET_ID_REASON);

    if (missing.length > 0) {
      invalid.push({ row: row.rowNumber, description: row.description || "(no description)", reason: `Missing ${missing.join(", ")}` });
    } else {
      valid.push(row);
    }
  }

  return { valid, invalid };
}
