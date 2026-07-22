import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listAccessories, createAccessory, updateAccessory, deleteAccessory, uploadAccessoryPhoto,
  bulkCreateAccessories, type AccessoryInput, type BulkImportResult,
} from "@/lib/accessories";
import { extractSupabaseError } from "@/lib/supabase-errors";
import { fetchAccessoryBookingSlots, computeAccessoryAvailability } from "@/lib/accessory-availability";
import { markAccessoryBookingReturned } from "@/lib/accessory-bookings";
import { invalidateBookingRelatedQueries } from "@/lib/query-invalidation";
import { parseAccessoriesWorkbook, validateAccessoryRows, type ParsedAccessoryRow, type RowValidationFailure } from "@/lib/accessory-excel";
import type { AvailabilityState, EquipmentAvailability } from "@/lib/equipment-availability";
import { AVAILABILITY_CONFIG } from "@/components/equipment-availability-badge";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight, UploadCloud, Loader2, ImageOff, SlidersHorizontal } from "lucide-react";

export const Route = createFileRoute("/_authenticated/accessories/")({
  component: AccessoriesListPage,
});

const PAGE_SIZE = 20;
const FETCH_LIMIT = 1000;

type AccessoryRow = AccessoryInput & { id: string; photo_url: string | null };
type EnrichedRow = AccessoryRow & { availability: EquipmentAvailability };

function AccessoriesListPage() {
  const { data: user } = useSessionUser();
  const canManage = user ? isPrivileged(user.roles) : false;
  const [search, setSearch] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | AvailabilityState>("all");
  const [page, setPage] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["accessories-list", search],
    queryFn: () => listAccessories({ search, limit: FETCH_LIMIT, offset: 0 }),
  });

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const accessoryIds = useMemo(() => rows.map((r) => r.id), [rows]);

  const bookingSlots = useQuery({
    queryKey: ["accessory-booking-slots", accessoryIds],
    queryFn: () => fetchAccessoryBookingSlots(accessoryIds),
    enabled: accessoryIds.length > 0,
    refetchInterval: 60_000,
  });

  const enriched: EnrichedRow[] = useMemo(() => rows.map((a) => {
    const availability: EquipmentAvailability = a.status !== "active"
      ? { state: "unavailable", totalQty: a.quantity, availableQty: 0, currentBookings: [], bookedQty: 0, reasonLabel: a.status === "maintenance" ? "Under maintenance" : "Retired" }
      : computeAccessoryAvailability(bookingSlots.data?.[a.id] ?? [], a.quantity);
    return { ...a, availability };
  }), [rows, bookingSlots.data]);

  const filtered = useMemo(() => availabilityFilter === "all"
    ? enriched
    : enriched.filter((a) => a.availability.state === availabilityFilter), [enriched, availabilityFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["accessories-list"] });
    qc.invalidateQueries({ queryKey: ["accessory-booking-slots"] });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Accessories</h1>
          <p className="text-sm text-muted-foreground">{query.data?.total ?? 0} accessories in inventory</p>
        </div>
        {canManage && (
          <div className="flex gap-2 w-full sm:w-auto">
            <AccessoryImportDialog onDone={invalidate} />
            <AccessoryDialog onDone={invalidate} />
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3">
          <div className="flex gap-2 w-full sm:w-auto sm:flex-1">
            <div className="relative flex-1 min-w-0 sm:min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search accessories…" className="pl-9" />
            </div>
            <Button
              variant="outline"
              size="icon"
              className="sm:hidden shrink-0 relative"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-label="Toggle filters"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {availabilityFilter !== "all" && <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] grid place-items-center">1</span>}
            </Button>
          </div>
          <div className={cn("w-full sm:w-auto sm:contents", !filtersOpen && "hidden sm:block")}>
            <Select value={availabilityFilter} onValueChange={(v) => { setAvailabilityFilter(v as typeof availabilityFilter); setPage(0); }}>
              <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Availability" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All availability</SelectItem>
                <SelectItem value="available">🟢 Available</SelectItem>
                <SelectItem value="limited">🟡 Partially Available</SelectItem>
                <SelectItem value="fully_booked">🔴 Unavailable</SelectItem>
                <SelectItem value="unavailable">⚫ Under maintenance</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <Card><div className="text-center text-sm text-muted-foreground py-10">Loading accessories…</div></Card>
      ) : filtered.length === 0 ? (
        <Card><div className="text-center text-sm text-muted-foreground py-10">No accessories match your filters.</div></Card>
      ) : (
        <>
          {/* Mobile: card list (no horizontal scrolling) */}
          <div className="md:hidden space-y-3">
            {pageRows.map((a, i) => {
              const cfg = AVAILABILITY_CONFIG[a.availability.state];
              const mine = a.availability.currentBookings.find((b) => b.userId === user?.id);
              const bookingDisabled = (a.availability.state === "fully_booked" && !mine) || a.availability.state === "unavailable";
              const othersBooked = a.availability.currentBookings.filter((b) => b.userId !== user?.id);
              return (
                <Card key={a.id}>
                  <CardContent className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        {a.photo_url ? (
                          <img src={a.photo_url} alt={a.description} className="h-12 w-12 rounded object-cover border shrink-0" />
                        ) : (
                          <div className="h-12 w-12 rounded border bg-muted grid place-items-center text-muted-foreground shrink-0">
                            <ImageOff className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-[11px] text-muted-foreground">#{page * PAGE_SIZE + i + 1}</div>
                          <div className="font-medium truncate">{a.description}</div>
                          <div className="text-xs text-muted-foreground truncate">{a.make || "—"} {a.model || ""}</div>
                        </div>
                      </div>
                      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0", cfg.text)}>
                        <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dot)} />
                        {mine ? "My Booking" : cfg.label(a.availability)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <div className="truncate"><span className="text-foreground font-medium">Serial:</span> {a.serial_number || "—"}</div>
                      <div><span className="text-foreground font-medium">Qty:</span> {a.quantity}</div>
                      {othersBooked.length > 0 && (
                        <div className="col-span-2 truncate"><span className="text-foreground font-medium">Booked by:</span> {othersBooked[0].name}{othersBooked.length > 1 ? ` +${othersBooked.length - 1} more` : ""} · Returns {othersBooked[0].returnsAtLabel}</div>
                      )}
                      {a.availability.nextReservation && (
                        <div className="col-span-2"><span className="text-foreground font-medium">Next reservation:</span> {a.availability.nextReservation.fromLabel}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      {mine ? (
                        <AccessoryReturnEarlyButton bookingId={mine.bookingId} className="flex-1" />
                      ) : bookingDisabled ? (
                        <Button size="sm" variant="outline" className="flex-1" disabled>{a.availability.state === "unavailable" ? "Unavailable" : "Fully Booked"}</Button>
                      ) : (
                        <Link to="/accessories/$id" params={{ id: a.id }} className="flex-1">
                          <Button size="sm" variant="outline" className="w-full">Book</Button>
                        </Link>
                      )}
                      {canManage && <AccessoryRowActions accessory={a} onDone={invalidate} />}
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
              <table className="w-full text-sm border-collapse min-w-[1100px]">
                <thead className="sticky top-0 z-10 bg-card text-xs uppercase text-muted-foreground border-b shadow-sm">
                  <tr>
                    <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">Sl No</th>
                    <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">Photo</th>
                    <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">Description</th>
                    <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">Make</th>
                    <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">Model</th>
                    <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">Device Serial No.</th>
                    <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Qty</th>
                    <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">Remarks</th>
                    <th className="py-2.5 px-3 font-medium text-left whitespace-nowrap">Booking</th>
                    {canManage && <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">Manage</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pageRows.map((a, i) => {
                    const cfg = AVAILABILITY_CONFIG[a.availability.state];
                    const mine = a.availability.currentBookings.find((b) => b.userId === user?.id);
                    const bookingDisabled = (a.availability.state === "fully_booked" && !mine) || a.availability.state === "unavailable";
                    const othersBooked = a.availability.currentBookings.filter((b) => b.userId !== user?.id);
                    return (
                      <tr key={a.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 px-3 text-muted-foreground">{page * PAGE_SIZE + i + 1}</td>
                        <td className="py-2.5 px-3">
                          {a.photo_url ? (
                            <img src={a.photo_url} alt={a.description} className="h-10 w-10 rounded object-cover border" />
                          ) : (
                            <div className="h-10 w-10 rounded border bg-muted grid place-items-center text-muted-foreground">
                              <ImageOff className="h-4 w-4" />
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-medium max-w-[280px]">{a.description}</td>
                        <td className="py-2.5 px-3 text-muted-foreground">{a.make || "—"}</td>
                        <td className="py-2.5 px-3 text-muted-foreground">{a.model || "—"}</td>
                        <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{a.serial_number || "—"}</td>
                        <td className="py-2.5 px-3 text-right">{a.quantity}</td>
                        <td className="py-2.5 px-3 text-muted-foreground max-w-[200px] truncate">{a.remarks || "—"}</td>
                        <td className="py-2.5 px-3">
                          <div className="space-y-1.5">
                            <span className={cn("inline-flex items-center gap-1.5 font-medium whitespace-nowrap", cfg.text)}>
                              <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dot)} />
                              {mine ? "My Booking" : cfg.label(a.availability)}
                            </span>
                            {othersBooked.length > 0 && (
                              <div className="text-xs text-muted-foreground whitespace-nowrap">
                                {othersBooked[0].name}{othersBooked[0].department ? ` (${othersBooked[0].department})` : ""}{othersBooked.length > 1 ? ` +${othersBooked.length - 1} more` : ""} · returns {othersBooked[0].returnsAtLabel}
                              </div>
                            )}
                            {a.availability.nextReservation && (
                              <div className="text-xs text-muted-foreground whitespace-nowrap">next from {a.availability.nextReservation.fromLabel}</div>
                            )}
                            {mine ? (
                              <AccessoryReturnEarlyButton bookingId={mine.bookingId} />
                            ) : bookingDisabled ? (
                              <Button size="sm" variant="outline" disabled>{a.availability.state === "unavailable" ? "Unavailable" : "Fully Booked"}</Button>
                            ) : (
                              <Link to="/accessories/$id" params={{ id: a.id }}>
                                <Button size="sm" variant="outline">Book</Button>
                              </Link>
                            )}
                          </div>
                        </td>
                        {canManage && (
                          <td className="py-2.5 px-3">
                            <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                              <AccessoryRowActions accessory={a} onDone={invalidate} />
                            </div>
                          </td>
                        )}
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
        <div className="text-muted-foreground">Showing {filtered.length === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min(filtered.length, page * PAGE_SIZE + PAGE_SIZE)} of {filtered.length} · Page {page + 1} of {totalPages}</div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

function emptyAcc(): AccessoryInput {
  return { description: "", make: "", model: "", serial_number: "", quantity: 1, remarks: "", status: "active" };
}

function AccessoryDialog({ initial, onDone, trigger }: { initial?: AccessoryInput & { id?: string; photo_url?: string | null }; onDone: () => void; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AccessoryInput>(() => ({ ...emptyAcc(), ...(initial ?? {}) }));
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const isEdit = !!initial?.id;

  const mut = useMutation({
    mutationFn: async () => {
      let photo_url = initial?.photo_url ?? null;
      if (photoFile) photo_url = await uploadAccessoryPhoto(photoFile);
      const payload = { ...form, photo_url };
      if (isEdit && initial?.id) return updateAccessory(initial.id, payload);
      return createAccessory(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Accessory updated" : "Accessory added");
      setOpen(false); setForm(emptyAcc()); setPhotoFile(null); onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button><Plus className="h-4 w-4 mr-2" /> Add accessory</Button>}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "Edit accessory" : "Add accessory"}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label>Description</Label><Input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Make</Label><Input value={form.make ?? ""} onChange={(e) => setForm({ ...form, make: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Model</Label><Input value={form.model ?? ""} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Device serial no.</Label><Input value={form.serial_number ?? ""} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" min={0} required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value || "0", 10) })} /></div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as AccessoryInput["status"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="retired">Retired</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Photo</Label><Input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Remarks</Label><Textarea rows={2} value={form.remarks ?? ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={mut.isPending}>{mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{isEdit ? "Save changes" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccessoryRowActions({ accessory, onDone }: { accessory: AccessoryRow; onDone: () => void }) {
  const del = useMutation({
    mutationFn: () => deleteAccessory(accessory.id),
    onSuccess: () => { toast.success("Accessory deleted"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <AccessoryDialog
        initial={accessory}
        onDone={onDone}
        trigger={<Button size="sm" variant="ghost"><Pencil className="h-4 w-4" /></Button>}
      />
      <AlertDialog>
        <AlertDialogTrigger asChild><Button size="sm" variant="ghost"><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {accessory.description}?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the accessory. Existing bookings referencing it will prevent deletion.</AlertDialogDescription>
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

function AccessoryReturnEarlyButton({ bookingId, className }: { bookingId: string; className?: string }) {
  const qc = useQueryClient();
  const ret = useMutation({
    mutationFn: () => markAccessoryBookingReturned(bookingId),
    onSuccess: () => { toast.success("Marked returned — accessory is now available"); invalidateBookingRelatedQueries(qc); },
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
            This ends your booking before its scheduled time and frees the accessory for others immediately. This cannot be undone.
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

function AccessoryImportDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<ParsedAccessoryRow[]>([]);
  const [validRows, setValidRows] = useState<ParsedAccessoryRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<RowValidationFailure[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [photosFound, setPhotosFound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BulkImportResult[]>([]);

  async function onFile(file: File) {
    try {
      const res = await parseAccessoriesWorkbook(file);
      const { valid, invalid } = validateAccessoryRows(res.rows);
      setParsed(res.rows);
      setValidRows(valid);
      setInvalidRows(invalid);
      setSheetName(res.sheetName);
      setPhotosFound(res.photosFound);
      setResults([]);
      toast.success(`Parsed ${res.rows.length} rows from "${res.sheetName}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not parse workbook");
    }
  }

  async function runImport() {
    setBusy(true);
    try {
      const withPhotos = await Promise.all(validRows.map(async (row) => {
        let photo_url: string | null = null;
        let photoWarning: string | null = null;
        if (row.photoBlob) {
          try {
            photo_url = await uploadAccessoryPhoto(row.photoBlob);
          } catch (err) {
            const info = extractSupabaseError(err);
            photoWarning = `Storage upload failed: ${info.message}${info.code ? ` (${info.code})` : ""}`;
            console.error(`[accessories import] row ${row.rowNumber} photo upload failed:`, info, err);
          }
        }
        return {
          rowNumber: row.rowNumber,
          description: row.description,
          make: row.make || null,
          model: row.model || null,
          serial_number: row.serial_number || null,
          quantity: row.quantity,
          remarks: row.remarks || null,
          photo_url,
          photoWarning,
          status: "active" as const,
        };
      }));
      const res = await bulkCreateAccessories(withPhotos);
      setResults(res);
      toast.success(`Imported ${res.filter((r) => r.status === "created").length} of ${res.length}`);
      onDone();
    } catch (err) {
      const info = extractSupabaseError(err);
      toast.error(info.message);
      console.error("[accessories import] run failed:", info, err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><UploadCloud className="h-4 w-4 mr-2" /> Import Excel</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Import accessories from Excel</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Expected columns: Sl No, Accessories Photo, Description, Make, Model, Device Sl No., Qty, Remarks.
            Embedded row photos are picked up automatically where present; rows without an embedded photo import without one.
          </div>
          <Input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          {parsed.length > 0 && results.length === 0 && (
            <>
              <div className="flex items-center gap-3 text-sm">
                <div>
                  {parsed.length} rows from <span className="font-medium">{sheetName}</span> ({photosFound} photos found)
                  {" · "}<span className="text-emerald-600 dark:text-emerald-400">{validRows.length} valid</span>
                  {invalidRows.length > 0 && <> · <span className="text-destructive">{invalidRows.length} invalid</span></>}
                </div>
                <Button onClick={runImport} disabled={busy || validRows.length === 0}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Run import</Button>
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
            </>
          )}
          {results.length > 0 && (
            <div className="max-h-80 overflow-auto border rounded-md">
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
                    <tr key={i}>
                      <td className="px-3 py-1.5">{r.row}</td>
                      <td className="px-3 py-1.5">{r.description}</td>
                      <td className="px-3 py-1.5 align-top">
                        <Badge variant={r.status === "created" ? "default" : r.status === "skipped" ? "secondary" : "destructive"}>{r.status}</Badge>
                        {r.photoWarning && <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400 whitespace-nowrap">{r.photoWarning}</div>}
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
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
