import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listEquipment, createEquipment, updateEquipment, deleteEquipment, type EquipmentInput } from "@/lib/equipment";
import { fetchEquipmentBookingSlots, computeEquipmentAvailability, type AvailabilityState, type EquipmentAvailability } from "@/lib/equipment-availability";
import { useSessionUser } from "@/lib/use-session";
import { isPrivileged } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/equipment/")({
  component: EquipmentListPage,
});

const PAGE_SIZE = 20;
const FETCH_LIMIT = 1000;

type EquipmentRow = EquipmentInput & { id: string };
type EnrichedRow = EquipmentRow & { availability: EquipmentAvailability };

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
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | AvailabilityState>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const qc = useQueryClient();

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
    const availability: EquipmentAvailability = e.status !== "active"
      ? { state: "unavailable", reasonLabel: e.status === "maintenance" ? "Under maintenance" : "Retired" }
      : computeEquipmentAvailability(bookingSlots.data?.[e.id] ?? [], e.total_quantity);
    return { ...e, availability };
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
          <h1 className="text-2xl font-semibold">Equipment</h1>
          <p className="text-sm text-muted-foreground">{query.data?.total ?? 0} items in inventory</p>
        </div>
        {canManage && <EquipmentDialog onDone={() => qc.invalidateQueries({ queryKey: ["equipment-list"] })} />}
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search by name, asset ID, model, serial…" className="pl-9" />
          </div>
          <Select value={category} onValueChange={(v) => { setCategory(v); setPage(0); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={availabilityFilter} onValueChange={(v) => { setAvailabilityFilter(v as typeof availabilityFilter); setPage(0); }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Availability" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All availability</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="booked">Booked</SelectItem>
              <SelectItem value="reserved">Reserved</SelectItem>
              <SelectItem value="unavailable">Under maintenance</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {query.isLoading ? (
          <div className="text-center text-sm text-muted-foreground py-10">Loading equipment…</div>
        ) : sorted.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10">No equipment matches your filters.</div>
        ) : (
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
                    const bookingDisabled = e.availability.state === "booked" || e.availability.state === "unavailable";
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
                        <td className="py-2.5 px-3 text-muted-foreground">—</td>
                        <td className="py-2.5 px-3 text-muted-foreground">—</td>
                        <td className="py-2.5 px-3">
                          <span className={cn("inline-flex items-center gap-1.5 font-medium whitespace-nowrap", cfg.text)}>
                            <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dot)} />
                            {cfg.label}
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
                            {bookingDisabled ? (
                              <Button size="sm" variant="outline" disabled>Book</Button>
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
        )}
      </Card>

      <div className="flex items-center justify-between text-sm">
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
  return { equipment_code: "", name: "", category: "", manufacturer: "", model: "", serial_number: "", lab_location: "", total_quantity: 1, remarks: "", status: "active" };
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
