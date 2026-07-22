import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listEquipment, createEquipment, updateEquipment, deleteEquipment, bulkImportEquipment,
  type EquipmentInput, type EquipmentImportRow, type EquipmentImportResult,
} from "@/lib/equipment";
import {
  fetchEquipmentBookingSlots, computeEquipmentAvailability, computeAvailableQuantity,
  type AvailabilityState, type EquipmentAvailability,
} from "@/lib/equipment-availability";
import {
  parseEquipmentWorkbook, validateEquipmentRows,
  type ParsedEquipmentRow, type RowValidationFailure,
} from "@/lib/equipment-excel";
import { listBookings, markReturned } from "@/lib/bookings";
import { invalidateBookingRelatedQueries } from "@/lib/query-invalidation";
import { extractSupabaseError } from "@/lib/supabase-errors";
import { useSessionUser } from "@/lib/use-session";
import { isPrivileged } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown,
  UploadCloud, Loader2, Download, SlidersHorizontal, CalendarClock, User as UserIcon,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { format, parseISO } from "date-fns";
import * as XLSX from "xlsx";

interface EquipmentSearch {
  availability?: "all" | AvailabilityState;
}

export const Route = createFileRoute("/_authenticated/equipment/")({
  validateSearch: (search: Record<string, unknown>): EquipmentSearch => ({
    availability: (["available", "booked", "reserved", "unavailable"] as const).includes(search.availability as AvailabilityState)
      ? (search.availability as AvailabilityState)
      : undefined,
  }),
  component: EquipmentListPage,
});

const PAGE_SIZE = 20;
const FETCH_LIMIT = 1000;

type EquipmentRow = EquipmentInput & { id: string };
type EnrichedRow = EquipmentRow & { availability: EquipmentAvailability; availableQty: number };

type SortKey = "category" | "name" | "manufacturer" | "model" | "serial_number" | "equipment_code" | "total_quantity" | "status";

const STATUS_CONFIG: Record<AvailabilityState, { dot: string; text: string; label: string }> = {
  available: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", label: "Available" },
  booked: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400", label: "Booked" },
  reserved: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", label: "Reserved" },
  unavailable: { dot: "bg-slate-400", text: "text-muted-foreground", label: "Under Maintenance" },
};

const STATUS_PRIORITY: Record<AvailabilityState, number> = { booked: 0, reserved: 1, available: 2, unavailable: 3 };

function compareRows(a: EnrichedRow, b: EnrichedRow, key: SortKey): number {
  if (key === "total_quantity") return a.total_quantity - b.total_quantity;
  if (key === "status") return STATUS_PRIORITY[a.availability.state] - STATUS_PRIORITY[b.availability.state];
  const av = (a[key] ?? "") as string;
  const bv = (b[key] ?? "") as string;
  return av.localeCompare(bv);
}

function EquipmentListPage() {
  const { data: user } = useSessionUser();
  const canManage = user ? isPrivileged(user.roles) : false;
  const todayStr = new Date().toISOString().slice(0, 10);
  const routeSearch = Route.useSearch();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | AvailabilityState>(routeSearch.availability ?? "all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const qc = useQueryClient();
  const activeFilterCount = (category !== "all" ? 1 : 0) + (availabilityFilter !== "all" ? 1 : 0);

  const query = useQuery({
    queryKey: ["equipment-list", search],
    queryFn: () => listEquipment({ search, limit: FETCH_LIMIT, offset: 0 }),
  });

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.category));
    return Array.from(set).sort();
  }, [rows]);

  const equipmentIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const bookingSlots = useQuery({
    queryKey: ["equipment-booking-slots", equipmentIds],
    queryFn: () => fetchEquipmentBookingSlots(equipmentIds),
    enabled: equipmentIds.length > 0,
    refetchInterval: 60_000,
  });

  const enriched: EnrichedRow[] = useMemo(() => rows.map((e) => {
    const slots = bookingSlots.data?.[e.id] ?? [];
    const availability: EquipmentAvailability = e.status !== "active"
      ? { state: "unavailable", reasonLabel: e.status === "maintenance" ? "Under maintenance" : "Retired" }
      : computeEquipmentAvailability(slots, e.total_quantity);
    const availableQty = e.status !== "active" ? 0 : computeAvailableQuantity(slots, e.total_quantity);
    return { ...e, availability, availableQty };
  }), [rows, bookingSlots.data]);

  const filtered = useMemo(() => enriched.filter((e) => {
    if (category !== "all" && e.category !== category) return false;
    if (availabilityFilter !== "all" && e.availability.state !== availabilityFilter) return false;
    return true;
  }), [enriched, category, availabilityFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered].sort((a, b) => compareRows(a, b, sortKey));
    if (sortDir === "desc") arr.reverse();
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  }

  function SortableHeader({ label, sortKeyValue, align = "left" }: { label: string; sortKeyValue: SortKey; align?: "left" | "right" }) {
    const active = sortKeyValue === sortKey;
    return (
      <th
        className={cn("py-2.5 px-3 font-medium cursor-pointer select-none whitespace-nowrap hover:text-foreground", align === "right" && "text-right")}
        onClick={() => toggleSort(sortKeyValue)}
      >
        <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
          {label}
          {active ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-30" />}
        </span>
      </th>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Equipment</h1>
          <p className="text-sm text-muted-foreground">{query.data?.total ?? 0} items in inventory</p>
        </div>
        {canManage && (
          <div className="flex gap-2 w-full sm:w-auto">
            <EquipmentImportDialog onDone={() => qc.invalidateQueries({ queryKey: ["equipment-list"] })} />
            <EquipmentDialog onDone={() => qc.invalidateQueries({ queryKey: ["equipment-list"] })} />
          </div>
        )}
      </div>

      <MyActiveBookingsWidget />

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3">
          <div className="flex gap-2 w-full sm:w-auto sm:flex-1">
            <div className="relative flex-1 min-w-0 sm:min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search equipment…" className="pl-9" />
            </div>
            <Button
              variant="outline"
              className="sm:hidden shrink-0 relative"
              size="icon"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-label="Toggle filters"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] grid place-items-center">{activeFilterCount}</span>}
            </Button>
          </div>
          <div className={cn("w-full flex flex-wrap gap-3 sm:w-auto sm:contents", !filtersOpen && "hidden sm:flex")}>
            <Select value={category} onValueChange={(v) => { setCategory(v); setPage(0); }}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={availabilityFilter} onValueChange={(v) => { setAvailabilityFilter(v as typeof availabilityFilter); setPage(0); }}>
              <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Availability" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All availability</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="booked">Booked</SelectItem>
                <SelectItem value="reserved">Reserved</SelectItem>
                <SelectItem value="unavailable">Under maintenance</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <Card><div className="text-center text-sm text-muted-foreground py-10">Loading equipment…</div></Card>
      ) : sorted.length === 0 ? (
        <Card><div className="text-center text-sm text-muted-foreground py-10">No equipment matches your filters.</div></Card>
      ) : (
        <>
          {/* Mobile: card list (no horizontal scrolling) */}
          <div className="md:hidden space-y-3">
            {pageRows.map((e, i) => {
              const cfg = STATUS_CONFIG[e.availability.state];
              const isMine = e.availability.state === "booked" && e.availability.bookedBy?.userId === user?.id;
              const bookingDisabled = (e.availability.state === "booked" && !isMine) || e.availability.state === "unavailable";
              return (
                <Card key={e.id}>
                  <CardContent className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] text-muted-foreground">#{page * PAGE_SIZE + i + 1} · {e.category}</div>
                        <Link to="/equipment/$id" params={{ id: e.id }} className="font-medium hover:text-primary block truncate">{e.name}</Link>
                        <div className="text-xs text-muted-foreground truncate">{e.manufacturer || "—"} {e.model || ""}</div>
                      </div>
                      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0", cfg.text)}>
                        <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dot)} />
                        {isMine ? "My Booking" : cfg.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <div><span className="text-foreground font-medium">Asset ID:</span> {e.equipment_code}</div>
                      <div><span className="text-foreground font-medium">Available:</span> {e.availableQty} / {e.total_quantity}</div>
                      <div className="col-span-2 truncate"><span className="text-foreground font-medium">Serial:</span> {e.serial_number || "—"}</div>
                      {e.calibration_due_date && (
                        <div className={cn("col-span-2", e.calibration_due_date < todayStr ? "text-destructive font-medium" : "")}>
                          <span className="text-foreground font-medium">Cal. due:</span> {e.calibration_due_date}
                        </div>
                      )}
                      {e.availability.state === "booked" && e.availability.bookedBy && !isMine && (
                        <>
                          <div className="col-span-2 truncate"><span className="text-foreground font-medium">Booked by:</span> {e.availability.bookedBy.name}</div>
                          {e.availability.bookedBy.department && <div className="col-span-2"><span className="text-foreground font-medium">Department:</span> {e.availability.bookedBy.department}</div>}
                          {e.availability.availableAtLabel && <div className="col-span-2"><span className="text-foreground font-medium">Available again:</span> {e.availability.availableAtLabel}</div>}
                        </>
                      )}
                      {e.availability.state === "reserved" && e.availability.reservedFromLabel && (
                        <div className="col-span-2"><span className="text-foreground font-medium">Reserved from:</span> {e.availability.reservedFromLabel}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Link to="/equipment/$id" params={{ id: e.id }} className="flex-1">
                        <Button size="sm" variant="ghost" className="w-full">Details</Button>
                      </Link>
                      {isMine && e.availability.bookedBy ? (
                        <ReturnEarlyButton bookingId={e.availability.bookedBy.bookingId} className="flex-1" />
                      ) : bookingDisabled ? (
                        <Button size="sm" variant="outline" className="flex-1" disabled>{e.availability.state === "unavailable" ? "Unavailable" : "Booked"}</Button>
                      ) : (
                        <Link to="/equipment/$id" params={{ id: e.id }} className="flex-1">
                          <Button size="sm" variant="outline" className="w-full">Book</Button>
                        </Link>
                      )}
                      {canManage && <EquipmentRowActions equipment={e} onDone={() => qc.invalidateQueries({ queryKey: ["equipment-list"] })} />}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Tablet/desktop: full table */}
          <Card className="hidden md:block overflow-hidden">
          <div className="overflow-x-auto">
            <div className="max-h-[65vh] overflow-y-auto">
              <table className="w-full text-sm border-collapse min-w-[1500px]">
                <thead className="sticky top-0 z-10 bg-card text-xs uppercase text-muted-foreground border-b shadow-sm">
                  <tr>
                    <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">Sl. No.</th>
                    <SortableHeader label="Category" sortKeyValue="category" />
                    <SortableHeader label="Description" sortKeyValue="name" />
                    <SortableHeader label="Make" sortKeyValue="manufacturer" />
                    <SortableHeader label="Model" sortKeyValue="model" />
                    <SortableHeader label="Device Serial No." sortKeyValue="serial_number" />
                    <SortableHeader label="Asset ID" sortKeyValue="equipment_code" />
                    <SortableHeader label="Qty" sortKeyValue="total_quantity" align="right" />
                    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Available</th>
                    <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">Calibration Date</th>
                    <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">Calibration Due</th>
                    <SortableHeader label="Status" sortKeyValue="status" />
                    <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">Booked By</th>
                    <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">Next Available</th>
                    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pageRows.map((e, i) => {
                    const cfg = STATUS_CONFIG[e.availability.state];
                    const isMine = e.availability.state === "booked" && e.availability.bookedBy?.userId === user?.id;
                    const bookingDisabled = (e.availability.state === "booked" && !isMine) || e.availability.state === "unavailable";
                    return (
                      <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 px-3 text-muted-foreground">{page * PAGE_SIZE + i + 1}</td>
                        <td className="py-2.5 px-3">{e.category}</td>
                        <td className="py-2.5 px-3 font-medium">
                          <Link to="/equipment/$id" params={{ id: e.id }} className="hover:text-primary">{e.name}</Link>
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground">{e.manufacturer || "—"}</td>
                        <td className="py-2.5 px-3 text-muted-foreground">{e.model || "—"}</td>
                        <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{e.serial_number || "—"}</td>
                        <td className="py-2.5 px-3 font-mono text-xs">{e.equipment_code}</td>
                        <td className="py-2.5 px-3 text-right">{e.total_quantity}</td>
                        <td className="py-2.5 px-3 text-right font-medium">{e.availableQty}</td>
                        <td className="py-2.5 px-3 text-muted-foreground">{e.calibration_date || "—"}</td>
                        <td className={cn("py-2.5 px-3", e.calibration_due_date && e.calibration_due_date < todayStr ? "text-destructive font-medium" : "text-muted-foreground")}>
                          {e.calibration_due_date || "—"}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={cn("inline-flex items-center gap-1.5 font-medium whitespace-nowrap", cfg.text)}>
                            <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dot)} />
                            {isMine ? "My Booking" : cfg.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                          {e.availability.state === "booked" && e.availability.bookedBy
                            ? `${e.availability.bookedBy.name}${e.availability.bookedBy.department ? ` (${e.availability.bookedBy.department})` : ""}`
                            : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                          {e.availability.state === "booked" && e.availability.availableAtLabel
                            ? e.availability.availableAtLabel
                            : e.availability.state === "reserved" && e.availability.reservedFromLabel
                              ? e.availability.reservedFromLabel
                              : "—"}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                            <Link to="/equipment/$id" params={{ id: e.id }}>
                              <Button size="sm" variant="ghost">Details</Button>
                            </Link>
                            {isMine && e.availability.bookedBy ? (
                              <ReturnEarlyButton bookingId={e.availability.bookedBy.bookingId} />
                            ) : bookingDisabled ? (
                              <Button size="sm" variant="outline" disabled>{e.availability.state === "unavailable" ? "Unavailable" : "Booked"}</Button>
                            ) : (
                              <Link to="/equipment/$id" params={{ id: e.id }}>
                                <Button size="sm" variant="outline">Book</Button>
                              </Link>
                            )}
                            {canManage && <EquipmentRowActions equipment={e} onDone={() => qc.invalidateQueries({ queryKey: ["equipment-list"] })} />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </Card>
        </>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
        <div className="text-muted-foreground">Showing {sorted.length === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min(sorted.length, page * PAGE_SIZE + PAGE_SIZE)} of {sorted.length} · Page {page + 1} of {totalPages}</div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

function emptyEq(): EquipmentInput {
  return { equipment_code: "", name: "", category: "", manufacturer: "", model: "", serial_number: "", lab_location: "", total_quantity: 1, remarks: "", status: "active", calibration_date: null, calibration_due_date: null };
}

function EquipmentDialog({ initial, onDone, trigger }: { initial?: EquipmentInput & { id?: string }; onDone: () => void; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EquipmentInput>(() => ({ ...emptyEq(), ...(initial ?? {}) }));
  const isEdit = !!initial?.id;

  const mut = useMutation({
    mutationFn: async () => {
      if (isEdit && initial?.id) return updateEquipment(initial.id, form);
      return createEquipment(form);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Equipment updated" : "Equipment added");
      setOpen(false); setForm(emptyEq()); onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button><Plus className="h-4 w-4 mr-2" /> Add equipment</Button>}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "Edit equipment" : "Add equipment"}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Equipment code</Label><Input required value={form.equipment_code} onChange={(e) => setForm({ ...form, equipment_code: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Name</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Category</Label><Input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Lab location</Label><Input required value={form.lab_location} onChange={(e) => setForm({ ...form, lab_location: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Manufacturer</Label><Input value={form.manufacturer ?? ""} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Model</Label><Input value={form.model ?? ""} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Serial number</Label><Input value={form.serial_number ?? ""} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Total quantity</Label><Input type="number" min={0} required value={form.total_quantity} onChange={(e) => setForm({ ...form, total_quantity: parseInt(e.target.value || "0", 10) })} /></div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as EquipmentInput["status"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="retired">Retired</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Calibration date</Label><Input type="date" value={form.calibration_date ?? ""} onChange={(e) => setForm({ ...form, calibration_date: e.target.value || null })} /></div>
          <div className="space-y-1.5"><Label>Calibration due date</Label><Input type="date" value={form.calibration_due_date ?? ""} onChange={(e) => setForm({ ...form, calibration_due_date: e.target.value || null })} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Remarks</Label><Textarea rows={2} value={form.remarks ?? ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={mut.isPending}>{isEdit ? "Save changes" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EquipmentRowActions({ equipment, onDone }: { equipment: EquipmentInput & { id: string }; onDone: () => void }) {
  const del = useMutation({
    mutationFn: () => deleteEquipment(equipment.id),
    onSuccess: () => { toast.success("Equipment deleted"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <EquipmentDialog
        initial={equipment}
        onDone={onDone}
        trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
      />
      <AlertDialog>
        <AlertDialogTrigger asChild><Button size="sm" variant="ghost"><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {equipment.name}?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the equipment. Existing bookings referencing it will prevent deletion.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ReturnEarlyButton({ bookingId, className }: { bookingId: string; className?: string }) {
  const qc = useQueryClient();
  const ret = useMutation({
    mutationFn: () => markReturned(bookingId),
    onSuccess: () => { toast.success("Marked returned — equipment is now available"); invalidateBookingRelatedQueries(qc); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" className={className} disabled={ret.isPending}>Return Early</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Return this booking now?</AlertDialogTitle>
          <AlertDialogDescription>
            This ends your booking before its scheduled time and frees the equipment for others immediately. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => ret.mutate()}>Return now</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MyActiveBookingsWidget() {
  const { data: user } = useSessionUser();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["my-active-bookings", user?.id],
    queryFn: () => listBookings({ scope: "mine", status: "booked", limit: 100 }),
    enabled: !!user,
  });

  const now = new Date();
  const active = (q.data?.rows ?? []).filter((b) => new Date(`${b.booking_date}T${b.start_time}`) <= now);

  const ret = useMutation({
    mutationFn: (id: string) => markReturned(id),
    onSuccess: () => { toast.success("Marked returned — equipment is now available"); invalidateBookingRelatedQueries(qc); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (active.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4" /> My Active Bookings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {active.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium truncate">{b.equipment?.name ?? "—"}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                <UserIcon className="h-3 w-3" />
                {format(parseISO(b.booking_date), "d MMM yyyy")} {b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)} · Qty {b.quantity}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {b.equipment_id && (
                <Link to="/equipment/$id" params={{ id: b.equipment_id }}>
                  <Button size="sm" variant="ghost">View</Button>
                </Link>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={ret.isPending}>Return Early</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Return this booking now?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This ends your booking before its scheduled time and frees the equipment for others immediately. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => ret.mutate(b.id)}>Return now</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type ImportPhase = "idle" | "reading" | "parsing" | "validating" | "ready" | "uploading" | "completed";

const PHASE_LABEL: Record<ImportPhase, string> = {
  idle: "",
  reading: "Reading Excel…",
  parsing: "Parsing…",
  validating: "Validating…",
  ready: "",
  uploading: "Uploading…",
  completed: "Completed",
};

// Let React flush the phase label to the DOM before the next (synchronous, CPU-bound) step runs.
function paint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function EquipmentImportDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [sheetName, setSheetName] = useState("");
  const [previewRows, setPreviewRows] = useState<ParsedEquipmentRow[]>([]);
  const [validRows, setValidRows] = useState<ParsedEquipmentRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<RowValidationFailure[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<EquipmentImportResult[]>([]);

  function reset() {
    setPhase("idle"); setSheetName(""); setPreviewRows([]); setValidRows([]); setInvalidRows([]);
    setProgress({ done: 0, total: 0 }); setResults([]);
  }

  async function onFile(file: File) {
    reset();
    try {
      setPhase("reading");
      await paint();
      const parsed = await parseEquipmentWorkbook(file);

      setPhase("parsing");
      await paint();
      setSheetName(parsed.sheetName);
      setPreviewRows(parsed.rows);

      setPhase("validating");
      await paint();
      const { valid, invalid } = validateEquipmentRows(parsed.rows);
      setValidRows(valid);
      setInvalidRows(invalid);

      setPhase("ready");
      toast.success(`Parsed ${parsed.rows.length} rows from "${parsed.sheetName}"`);
    } catch (err) {
      const info = extractSupabaseError(err);
      toast.error(info.message);
      console.error("[equipment import] parse failed:", info, err);
      setPhase("idle");
    }
  }

  async function runImport() {
    setPhase("uploading");
    setProgress({ done: 0, total: validRows.length });
    await paint();

    const payload: EquipmentImportRow[] = validRows.map((row) => ({
      rowNumber: row.rowNumber,
      equipment_code: row.asset_id,
      name: row.description,
      category: row.category,
      manufacturer: row.make || null,
      model: row.model || null,
      serial_number: row.device_serial_no,
      lab_location: "",
      total_quantity: row.qty ?? 0,
      remarks: row.remarks || null,
      calibration_date: row.calibration_date,
      calibration_due_date: row.calibration_due_date,
    }));

    const res = await bulkImportEquipment(payload, (done, total) => setProgress({ done, total }));
    setResults(res);
    setPhase("completed");
    const imported = res.filter((r) => r.status === "imported").length;
    toast.success(`Imported ${imported} of ${res.length} rows`);
    onDone();
  }

  function downloadReport() {
    const invalidAsResults = invalidRows.map((r) => ({ row: r.row, description: r.description, status: "skipped", reason: r.reason }));
    const combined = [...results, ...invalidAsResults].sort((a, b) => a.row - b.row);
    const ws = XLSX.utils.json_to_sheet(combined);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Import Report");
    XLSX.writeFile(wb, `equipment_import_report_${Date.now()}.xlsx`);
  }

  const imported = results.filter((r) => r.status === "imported").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length + invalidRows.length;
  const duplicates = results.filter((r) => r.duplicate).length;
  const busy = phase === "reading" || phase === "parsing" || phase === "validating" || phase === "uploading";

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild><Button variant="outline"><UploadCloud className="h-4 w-4 mr-2" /> Import Excel</Button></DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Import equipment from Excel</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Expected columns: SL NO, Category, Description, Make, Model, Device SL No, Asset ID, Qty, Calibration date, Cal due date, Remarks.
            The sheet is matched by header name, not column position. Calibration dates are recorded in Remarks — the equipment table has no dedicated calibration columns.
          </div>
          <div className="space-y-1.5">
            <Label>Excel file</Label>
            <Input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </div>

          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {PHASE_LABEL[phase]}
              {phase === "uploading" && progress.total > 0 && <span>— {progress.done} of {progress.total} rows</span>}
            </div>
          )}

          {phase === "ready" && (
            <>
              <div className="flex items-center gap-3 text-sm">
                <div>
                  {previewRows.length} rows from <span className="font-medium">{sheetName}</span>
                  {" · "}<span className="text-emerald-600 dark:text-emerald-400">{validRows.length} ready</span>
                  {invalidRows.length > 0 && <> · <span className="text-destructive">{invalidRows.length} invalid</span></>}
                </div>
                <Button onClick={runImport} disabled={validRows.length === 0}>Run import</Button>
              </div>

              {invalidRows.length > 0 && (
                <div className="max-h-40 overflow-y-auto border rounded-md border-destructive/40">
                  <table className="w-full text-sm">
                    <thead className="bg-destructive/10 text-xs uppercase text-muted-foreground sticky top-0">
                      <tr><th className="text-left px-3 py-1.5">Row</th><th className="text-left px-3 py-1.5">Description</th><th className="text-left px-3 py-1.5">Reason</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {invalidRows.map((r, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1">{r.row}</td>
                          <td className="px-3 py-1">{r.description}</td>
                          <td className="px-3 py-1 text-destructive">{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="text-xs font-medium text-muted-foreground">Preview</div>
              <div className="max-h-72 overflow-auto border rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 uppercase text-muted-foreground sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5">SL NO</th>
                      <th className="text-left px-2 py-1.5">Category</th>
                      <th className="text-left px-2 py-1.5">Description</th>
                      <th className="text-left px-2 py-1.5">Make</th>
                      <th className="text-left px-2 py-1.5">Model</th>
                      <th className="text-left px-2 py-1.5">Device SL No</th>
                      <th className="text-left px-2 py-1.5">Asset ID</th>
                      <th className="text-right px-2 py-1.5">Qty</th>
                      <th className="text-left px-2 py-1.5">Calibration Date</th>
                      <th className="text-left px-2 py-1.5">Calibration Due Date</th>
                      <th className="text-left px-2 py-1.5">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {previewRows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="px-2 py-1">{r.sl_no}</td>
                        <td className="px-2 py-1">{r.category || "—"}</td>
                        <td className="px-2 py-1 max-w-[220px] truncate">{r.description || "—"}</td>
                        <td className="px-2 py-1">{r.make || "—"}</td>
                        <td className="px-2 py-1">{r.model || "—"}</td>
                        <td className="px-2 py-1 font-mono">{r.device_serial_no || "—"}</td>
                        <td className="px-2 py-1 font-mono">{r.asset_id || "—"}</td>
                        <td className="px-2 py-1 text-right">{r.qty ?? "—"}</td>
                        <td className="px-2 py-1" title={r.dateWarnings.find((w) => w.startsWith("Calibration date"))}>
                          {r.calibration_date ?? (r.dateWarnings.some((w) => w.startsWith("Calibration date")) ? <span className="text-destructive">invalid</span> : "—")}
                        </td>
                        <td className="px-2 py-1" title={r.dateWarnings.find((w) => w.startsWith("Calibration due"))}>
                          {r.calibration_due_date ?? (r.dateWarnings.some((w) => w.startsWith("Calibration due")) ? <span className="text-destructive">invalid</span> : "—")}
                        </td>
                        <td className="px-2 py-1 max-w-[160px] truncate">{r.remarks || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {phase === "completed" && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-sm">
                <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Total</div><div className="text-lg font-semibold">{previewRows.length}</div></div>
                <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Imported</div><div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{imported}</div></div>
                <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Skipped</div><div className="text-lg font-semibold text-amber-600 dark:text-amber-400">{skipped}</div></div>
                <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Failed</div><div className="text-lg font-semibold text-destructive">{failed}</div></div>
                <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Duplicates</div><div className="text-lg font-semibold">{duplicates}</div></div>
              </div>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={downloadReport}><Download className="h-4 w-4 mr-2" /> Download report</Button>
              </div>
              <div className="max-h-72 overflow-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2">Row</th>
                      <th className="text-left px-3 py-2">Description</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="text-left px-3 py-2">Error Code</th>
                      <th className="text-left px-3 py-2">Message</th>
                      <th className="text-left px-3 py-2">Details</th>
                      <th className="text-left px-3 py-2">Hint</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {invalidRows.map((r, i) => (
                      <tr key={`invalid-${i}`}>
                        <td className="px-3 py-1.5">{r.row}</td>
                        <td className="px-3 py-1.5">{r.description}</td>
                        <td className="px-3 py-1.5"><Badge variant="destructive">skipped</Badge></td>
                        <td className="px-3 py-1.5" />
                        <td className="px-3 py-1.5 text-muted-foreground">{r.reason}</td>
                        <td className="px-3 py-1.5" />
                        <td className="px-3 py-1.5" />
                      </tr>
                    ))}
                    {results.map((r, i) => (
                      <tr key={`result-${i}`}>
                        <td className="px-3 py-1.5">{r.row}</td>
                        <td className="px-3 py-1.5">{r.description}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant={r.status === "imported" ? "default" : r.status === "skipped" ? "secondary" : "destructive"}>{r.status}</Badge>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{r.code ?? ""}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.reason ?? r.message ?? ""}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.details ?? ""}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.hint ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
