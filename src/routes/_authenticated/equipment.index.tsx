import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listEquipment, createEquipment, updateEquipment, deleteEquipment, type EquipmentInput } from "@/lib/equipment";
import { fetchAvailabilityMap, type EquipmentAvailability } from "@/lib/availability";
import { useSessionUser } from "@/lib/use-session";
import { isPrivileged } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/equipment/")({
  component: EquipmentListPage,
});

const PAGE = 12;

function EquipmentListPage() {
  const { data: user } = useSessionUser();
  const canManage = user ? isPrivileged(user.roles) : false;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(0);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["equipment-list", search, category, status, page],
    queryFn: () => listEquipment({
      search,
      category: category === "all" ? undefined : category,
      status: status === "all" ? undefined : status,
      limit: PAGE, offset: page * PAGE,
    }),
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    query.data?.rows.forEach((r) => set.add(r.category));
    return Array.from(set);
  }, [query.data]);

  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE));

  const rows = query.data?.rows ?? [];
  const availabilityQuery = useQuery({
    queryKey: ["equipment-availability", rows.map((r) => r.id).join(",")],
    queryFn: () => fetchAvailabilityMap(rows.map((r) => ({ id: r.id, total_quantity: r.total_quantity }))),
    enabled: rows.length > 0,
    refetchInterval: 60_000,
  });

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
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search by name, code, model…" className="pl-9" />
          </div>
          <Select value={category} onValueChange={(v) => { setCategory(v); setPage(0); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <div className="text-center text-sm text-muted-foreground py-10">Loading equipment…</div>
      ) : (query.data?.rows ?? []).length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-10">No equipment matches your filters.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {query.data!.rows.map((e) => (
            <Card key={e.id} className="hover:shadow-elevated transition-shadow">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-mono text-muted-foreground">{e.equipment_code}</div>
                    <Link to="/equipment/$id" params={{ id: e.id }} className="font-semibold hover:text-primary">
                      {e.name}
                    </Link>
                  </div>
                  <Badge variant={e.status === "active" ? "default" : "secondary"} className="capitalize">{e.status}</Badge>
                </div>
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  <div><span className="font-medium text-foreground">Category:</span> {e.category}</div>
                  <div><span className="font-medium text-foreground">Location:</span> {e.lab_location}</div>
                  {e.manufacturer && <div><span className="font-medium text-foreground">Mfr:</span> {e.manufacturer} {e.model}</div>}
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="text-sm">Qty: <span className="font-semibold">{e.total_quantity}</span></div>
                  <div className="flex gap-1">
                    <Link to="/equipment/$id" params={{ id: e.id }}>
                      <Button size="sm" variant="outline">Book</Button>
                    </Link>
                    {canManage && <EquipmentRowActions equipment={e} onDone={() => qc.invalidateQueries({ queryKey: ["equipment-list"] })} />}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-sm">
        <div className="text-muted-foreground">Page {page + 1} of {totalPages}</div>
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
