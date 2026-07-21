import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import * as XLSX from "xlsx";
import { useServerFn } from "@tanstack/react-start";
import { adminBulkImportUsers } from "@/lib/admin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { UploadCloud, Loader2, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/import")({
  component: ImportPage,
});

interface RawRow { [k: string]: unknown }
interface ResultRow { row: number; email: string; status: "created" | "skipped" | "error"; message?: string }

const HEADER_MAP: Record<string, string> = {
  "employee name": "full_name",
  "name": "full_name",
  "full name": "full_name",
  "company email": "email",
  "email": "email",
  "password": "password",
  "employee id": "employee_id",
  "id": "employee_id",
  "department": "department",
  "designation": "designation",
  "dob": "dob",
  "date of birth": "dob",
  "phone": "phone",
  "phone number": "phone",
};

function normalizeRow(row: RawRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = HEADER_MAP[k.trim().toLowerCase()];
    if (!key) continue;
    if (key === "dob" && v instanceof Date) out[key] = v.toISOString().slice(0, 10);
    // Excel turns numeric-looking phone cells into JS numbers; normalize to a trimmed string
    // here (never a numeric operation) so a leading zero that's still present is preserved.
    else if (key === "phone") out[key] = v == null ? "" : String(v).trim();
    else out[key] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

function ImportPage() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [busy, setBusy] = useState(false);
  const importFn = useServerFn(adminBulkImportUsers);

  async function onFile(file: File) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: RawRow[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
    const normalized = raw.map(normalizeRow);
    setRows(normalized);
    setResults([]);
    toast.success(`Parsed ${normalized.length} rows`);
  }

  async function runImport() {
    setBusy(true);
    try {
      const res = await importFn({ data: { rows } });
      setResults(res.results);
      toast.success(`Imported ${res.results.filter((r) => r.status === "created").length} of ${res.results.length}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  function downloadReport() {
    const ws = XLSX.utils.json_to_sheet(results);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Import Report");
    XLSX.writeFile(wb, `import_report_${Date.now()}.xlsx`);
  }

  function downloadTemplate() {
    const template = [{
      "Employee Name": "Jane Doe",
      "Company Email": "jane.doe@sanlayan.com",
      "Password": "TempPass1234",
      "Employee ID": "SL-1001",
      "Department": "R&D",
      "Designation": "Scientist",
      "DOB": "1994-05-14",
      "Phone": "9000000000",
    }];
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Users");
    XLSX.writeFile(wb, "user_import_template.xlsx");
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div><h1 className="text-2xl font-semibold">Import users</h1><p className="text-sm text-muted-foreground">Bulk-create accounts from an Excel workbook.</p></div>

      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold flex items-center gap-2"><UploadCloud className="h-4 w-4" /> Upload Excel</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <Input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="max-w-sm" />
            <Button variant="outline" onClick={downloadTemplate}><Download className="h-4 w-4 mr-2" /> Download template</Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Columns: Employee Name, Company Email, Password, Employee ID, Department, Designation, DOB, Phone.
            Only <span className="font-medium">@sanlayan.com</span> emails are accepted. Duplicates are skipped.
            Phone is optional but must be a plain 10-digit mobile number (e.g. 9000000000) if provided — format the column as Text in Excel to keep a leading zero.
          </div>
          {rows.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="text-sm">{rows.length} rows ready</div>
              <Button onClick={runImport} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Run import</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Import report</CardTitle>
            <Button variant="outline" size="sm" onClick={downloadReport}><Download className="h-4 w-4 mr-2" /> Download</Button>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr><th className="text-left px-4 py-2">Row</th><th className="text-left px-4 py-2">Email</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Message</th></tr>
              </thead>
              <tbody className="divide-y">
                {results.map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">{r.row}</td>
                    <td className="px-4 py-2">{r.email}</td>
                    <td className="px-4 py-2"><Badge variant={r.status === "created" ? "default" : r.status === "skipped" ? "secondary" : "destructive"}>{r.status}</Badge></td>
                    <td className="px-4 py-2 text-muted-foreground">{r.message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
