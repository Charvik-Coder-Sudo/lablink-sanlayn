import { readFileSync } from "fs";
import * as XLSX from "xlsx";
import { format } from "date-fns";

const HEADER_MAP = {
  "sl no": "sl_no", "sl. no": "sl_no", "sl no.": "sl_no",
  "category": "category", "description": "description", "make": "make", "model": "model",
  "device sl no": "device_serial_no", "device sl no.": "device_serial_no",
  "device serial no": "device_serial_no", "device serial no.": "device_serial_no",
  "asset id": "asset_id", "qty": "qty", "quantity": "qty",
  "calibration date": "calibration_date", "cal due date": "calibration_due_date",
  "calibration due date": "calibration_due_date", "remarks": "remarks",
};
function normalizeHeader(h) { return h.trim().toLowerCase().replace(/\s+/g, " "); }
function cellText(row, idx) {
  if (idx === undefined) return "";
  const v = row[idx];
  if (v === undefined || v === null) return "";
  if (v instanceof Date) return format(v, "yyyy-MM-dd");
  return String(v).trim();
}
function cellQty(row, idx) {
  if (idx === undefined) return null;
  const v = row[idx];
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function parseExcelDate(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : format(value, "yyyy-MM-dd");
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
function pickEquipmentSheet(wb) {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (raw.length === 0) continue;
    const header = raw[0];
    const fields = {};
    header.forEach((h, colIdx) => {
      const key = HEADER_MAP[normalizeHeader(String(h ?? ""))];
      if (key && fields[key] === undefined) fields[key] = colIdx;
    });
    if (fields.description !== undefined && fields.qty !== undefined && fields.category !== undefined) {
      return { sheetName: name, fields };
    }
  }
  return null;
}

const buf = readFileSync("d:/Sanlayan Labmanagement/lablink-sanlayn/excel/LAB Equipment (1).xlsx");
const wb = XLSX.read(buf, { cellDates: true });
console.log("Sheet names:", wb.SheetNames);
const pick = pickEquipmentSheet(wb);
console.log("Picked sheet:", pick.sheetName, "fields:", pick.fields);

const raw = XLSX.utils.sheet_to_json(wb.Sheets[pick.sheetName], { header: 1, defval: "" });
const rows = [];
for (let i = 1; i < raw.length; i++) {
  const r = raw[i];
  const description = cellText(r, pick.fields.description);
  const category = cellText(r, pick.fields.category);
  const deviceSerial = cellText(r, pick.fields.device_serial_no);
  const assetId = cellText(r, pick.fields.asset_id);
  const qty = cellQty(r, pick.fields.qty);
  const remarks = cellText(r, pick.fields.remarks);
  if (!description && !category && !deviceSerial && !assetId && qty === null && !remarks) continue;
  rows.push({
    rowNumber: i + 1,
    sl_no: cellText(r, pick.fields.sl_no),
    category, description,
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

console.log("\nTotal rows parsed:", rows.length);
console.log("\nFirst 5 rows:");
console.log(rows.slice(0, 5));

// Validation pass (mirrors validateEquipmentRows)
let valid = 0, invalid = [];
for (const row of rows) {
  const missing = [];
  if (!row.description) missing.push("Description");
  if (!row.category) missing.push("Category");
  if (!row.device_serial_no) missing.push("Device Serial Number");
  if (row.qty === null) missing.push("Qty");
  if (!row.asset_id) missing.push("Asset ID");
  if (missing.length > 0) invalid.push({ row: row.rowNumber, description: row.description, reason: `Missing ${missing.join(", ")}` });
  else valid++;
}
console.log(`\nValidation: ${valid} valid, ${invalid.length} invalid`);
if (invalid.length) console.log("Invalid rows:", invalid);

// Duplicate check within the sheet itself
const codeCounts = new Map(), serialCounts = new Map();
for (const row of rows) {
  const c = row.asset_id.trim().toLowerCase();
  const s = row.device_serial_no.trim().toLowerCase();
  if (c) codeCounts.set(c, (codeCounts.get(c) ?? 0) + 1);
  if (s) serialCounts.set(s, (serialCounts.get(s) ?? 0) + 1);
}
const dupCodes = [...codeCounts.entries()].filter(([, n]) => n > 1);
const dupSerials = [...serialCounts.entries()].filter(([, n]) => n > 1);
console.log("\nDuplicate Asset IDs within sheet:", dupCodes);
console.log("Duplicate Device Serial Nos within sheet:", dupSerials);

// Date parsing sanity
const withCalDate = rows.filter(r => r.calibration_date);
const withDueDate = rows.filter(r => r.calibration_due_date);
const blankCalDate = rows.filter(r => !r.calibration_date);
console.log(`\nRows with calibration_date parsed: ${withCalDate.length} / ${rows.length}`);
console.log(`Rows with calibration_due_date parsed: ${withDueDate.length} / ${rows.length}`);
console.log(`Rows with blank calibration_date (should be fine, not crash): ${blankCalDate.length}`);
console.log("\nSample calibration dates (first 5 with a value):", withCalDate.slice(0, 5).map(r => ({ row: r.rowNumber, cal: r.calibration_date, due: r.calibration_due_date })));

// qty type check
const badQty = rows.filter(r => r.qty !== null && !Number.isInteger(r.qty));
console.log("\nNon-integer Qty values found:", badQty.length, badQty.slice(0, 5));
