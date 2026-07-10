import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEquipment } from "@/lib/equipment";
import { createBooking, equipmentDaySchedule } from "@/lib/bookings";
import { createBookingServerFn } from "@/lib/bookings.server";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { format } from "date-fns";
import { validateBookingTimeRange } from "@/lib/booking-validation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, CalendarCheck2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/equipment/$id")({
  component: EquipmentDetailPage,
});

const LAB_START = "08:00", LAB_END = "20:00";

function toMinutes(t: string) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }

function EquipmentDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [quantity, setQuantity] = useState(1);
  const [purpose, setPurpose] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const submitBooking = useServerFn(createBookingServerFn);
  const equipment = useQuery({ queryKey: ["equipment", id], queryFn: () => getEquipment(id) });
  const schedule = useQuery({ queryKey: ["schedule", id, date], queryFn: () => equipmentDaySchedule(id, date) });
  const availability = useQuery({
    queryKey: ["avail", id, date, startTime, endTime],
    enabled: !!equipment.data,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("equipment_available_qty", {
        _equipment_id: id, _date: date, _start: startTime, _end: endTime,
      });
      if (error) throw error;
      return data as number;
    },
  });

  const availabilityPreview = useQuery({
    queryKey: ["availability-preview", id, date],
    enabled: !!equipment.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("id,start_time,end_time,quantity,purpose,user_id,profile:profiles!bookings_user_profile_fk(full_name)")
        .eq("equipment_id", id)
        .eq("booking_date", date)
        .eq("status", "booked")
        .order("start_time", { ascending: true })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        start_time: string;
        end_time: string;
        quantity: number;
        purpose: string;
        user_id: string;
        profile?: { full_name?: string | null } | null;
      }>;
    },
  });

  const book = useMutation({
    mutationFn: (input: {
      equipment_id: string;
      booking_date: string;
      start_time: string;
      end_time: string;
      quantity: number;
      purpose: string;
    }) => submitBooking({ data: input }),
    onSuccess: () => {
      toast.success("Booking created");
      setPurpose("");
      setValidationError(null);
      qc.invalidateQueries({ queryKey: ["schedule", id] });
      qc.invalidateQueries({ queryKey: ["avail", id] });
      qc.invalidateQueries({ queryKey: ["availability-preview", id] });
    },
    onError: (e: Error) => {
      const map: Record<string, string> = {
        outside_lab_hours: "Bookings must be between 08:00 and 20:00",
        invalid_time_range: "End time must be after start time",
        cannot_book_in_past: "Cannot book in the past",
        insufficient_quantity: "Not enough equipment available for that slot",
        equipment_unavailable: "Equipment is not available for booking",
      };
      toast.error(map[e.message] ?? e.message);
    },
  });

  if (equipment.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!equipment.data) return <div className="text-muted-foreground">Equipment not found.</div>;

  const e = equipment.data;
  const nextAvailableSlot = computeNextAvailable(schedule.data ?? [], e.total_quantity);
  const timeValidation = validateBookingTimeRange({ startTime, endTime });
  const preview = getAvailabilityPreview(availabilityPreview.data ?? [], startTime, endTime);
  const canSubmit = Boolean(purpose.trim()) && timeValidation.isValid && (availability.data ?? 0) >= quantity && e.status === "active";

  return (
    <div className="space-y-6">
      <Link to="/equipment" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to equipment</Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-mono text-muted-foreground">{e.equipment_code}</div>
                <CardTitle className="text-xl">{e.name}</CardTitle>
                <div className="text-sm text-muted-foreground mt-0.5">{e.category} · {e.lab_location}</div>
              </div>
              <Badge variant={e.status === "active" ? "default" : "secondary"} className="capitalize">{e.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
            <Info label="Manufacturer">{e.manufacturer ?? "—"}</Info>
            <Info label="Model">{e.model ?? "—"}</Info>
            <Info label="Serial Number">{e.serial_number ?? "—"}</Info>
            <Info label="Total Quantity">{e.total_quantity}</Info>
            {e.remarks && <Info label="Remarks" className="sm:col-span-2">{e.remarks}</Info>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold flex items-center gap-2"><CalendarCheck2 className="h-4 w-4" /> Book equipment</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>Date</Label><Input type="date" min={today} value={date} onChange={(ev) => setDate(ev.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start</Label><Input type="time" min={LAB_START} max={LAB_END} value={startTime} onChange={(ev) => setStartTime(ev.target.value)} /></div>
              <div><Label>End</Label><Input type="time" min={LAB_START} max={LAB_END} value={endTime} onChange={(ev) => setEndTime(ev.target.value)} /></div>
            </div>
            <div><Label>Quantity</Label><Input type="number" min={1} max={e.total_quantity} value={quantity} onChange={(ev) => setQuantity(parseInt(ev.target.value || "1", 10))} /></div>
            <div><Label>Purpose</Label><Textarea rows={2} required value={purpose} onChange={(ev) => setPurpose(ev.target.value)} placeholder="e.g. Sample preparation" /></div>
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
              <div className="font-medium">{e.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {preview.isAvailable
                  ? "● Available now"
                  : `● Currently in use · Available at ${preview.nextAvailableLabel}`}
              </div>
              {preview.currentBooking && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <div>Booked by: {preview.currentBooking.profile?.full_name ?? "—"}</div>
                  <div>Ends: {preview.currentBooking.end_time.slice(0, 5)}</div>
                </div>
              )}
            </div>
            <div className="text-xs text-muted-foreground">Available for selected slot: <span className="font-medium text-foreground">{availability.data ?? "—"}</span></div>
            {!timeValidation.isValid && <div className="text-xs text-destructive">{timeValidation.error}</div>}
            {validationError && <div className="text-xs text-destructive">{validationError}</div>}
            <Button
              className="w-full"
              onClick={() => {
                const validationResult = validateBookingTimeRange({ startTime, endTime });
                if (!validationResult.isValid) {
                  setValidationError(validationResult.error ?? null);
                  return;
                }
                setValidationError(null);
                book.mutate({
                  equipment_id: id,
                  booking_date: date,
                  start_time: startTime,
                  end_time: endTime,
                  quantity,
                  purpose,
                });
              }}
              disabled={book.isPending || !canSubmit}
            >
              Create booking
            </Button>
            <div className="text-[11px] text-muted-foreground">Lab hours: 08:00 – 20:00</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Schedule for {format(new Date(date), "EEEE, d MMM yyyy")}</CardTitle>
            <div className="text-xs text-muted-foreground">Next available: <span className="font-medium text-foreground">{nextAvailableSlot}</span></div>
          </div>
        </CardHeader>
        <CardContent>
          {(schedule.data ?? []).length === 0
            ? <div className="text-sm text-muted-foreground">No bookings for this day — full capacity available.</div>
            : <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                    <tr><th className="py-2 pr-4">Time</th><th className="py-2 pr-4">Booked by</th><th className="py-2 pr-4">Purpose</th><th className="py-2 pr-4 text-right">Qty</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {schedule.data!.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2 pr-4 font-mono text-xs">{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}</td>
                        <td className="py-2 pr-4">{s.profile?.full_name ?? "—"}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{s.purpose}</td>
                        <td className="py-2 pr-4 text-right">{s.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-0.5">{children}</div></div>;
}

function getAvailabilityPreview(
  bookings: Array<{ start_time: string; end_time: string; profile?: { full_name?: string | null } | null }>,
  selectedStartTime: string,
  selectedEndTime: string,
) {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const selectedStartMinutes = toMinutes(selectedStartTime);
  const selectedEndMinutes = toMinutes(selectedEndTime);
  const activeBooking = bookings.find((booking) => {
    const startMinutes = toMinutes(booking.start_time);
    const endMinutes = toMinutes(booking.end_time);
    return startMinutes <= nowMinutes && nowMinutes < endMinutes;
  });

  if (!activeBooking) {
    return {
      isAvailable: true,
      nextAvailableLabel: "Available now",
      currentBooking: null,
    };
  }

  const nextFutureBooking = [...bookings]
    .filter((booking) => toMinutes(booking.end_time) > nowMinutes)
    .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time))[0];

  return {
    isAvailable: false,
    nextAvailableLabel: nextFutureBooking?.end_time?.slice(0, 5) ?? activeBooking.end_time.slice(0, 5),
    currentBooking: activeBooking,
    selectedSlotIsAvailable: selectedStartMinutes >= nowMinutes && selectedEndMinutes <= toMinutes(activeBooking.end_time),
  };
}

function computeNextAvailable(schedule: { start_time: string; end_time: string; quantity: number }[], _total: number): string {
  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();
  const dayStart = Math.max(currentMin, toMinutes(LAB_START));
  const sorted = [...schedule].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  let cursor = dayStart;
  for (const s of sorted) {
    if (toMinutes(s.start_time) > cursor) {
      const h = Math.floor(cursor / 60), m = cursor % 60;
      return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    }
    cursor = Math.max(cursor, toMinutes(s.end_time));
  }
  if (cursor >= toMinutes(LAB_END)) return "Tomorrow 08:00";
  const h = Math.floor(cursor / 60), m = cursor % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
