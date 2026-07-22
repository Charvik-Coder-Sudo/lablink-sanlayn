import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getEquipment } from "@/lib/equipment";
import { createBooking } from "@/lib/bookings";
import {
  fetchEquipmentBookingSlots, computeEquipmentAvailability, computeSlotAvailability,
  type EquipmentAvailability,
} from "@/lib/equipment-availability";
import { invalidateBookingRelatedQueries } from "@/lib/query-invalidation";
import { SmartAvailabilityBadge } from "@/components/smart-availability-badge";
import { BookingCalendar } from "@/components/booking-calendar";
import { useState } from "react";
import { format, startOfMonth, endOfMonth, addDays } from "date-fns";
import { validateBookingDateTimeRange } from "@/lib/booking-validation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { ArrowLeft, CalendarCheck2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/equipment/$id")({
  component: EquipmentDetailPage,
});

const LAB_START = "08:00", LAB_END = "20:00";

function EquipmentDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [calMonth, setCalMonth] = useState(() => startOfMonth(new Date()));
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [quantity, setQuantity] = useState(1);
  const [projectName, setProjectName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const equipment = useQuery({ queryKey: ["equipment", id], queryFn: () => getEquipment(id) });

  // Single DEFINER-backed window covering the visible month + today + the selected range,
  // from which the calendar colours, daily schedule, live badge, and slot availability are
  // all derived — so a normal user sees the true booking state (RLS-safe) with one query.
  const winFrom = [format(startOfMonth(calMonth), "yyyy-MM-dd"), today, fromDate].sort()[0];
  const winTo = [format(endOfMonth(calMonth), "yyyy-MM-dd"), toDate, format(addDays(new Date(), 1), "yyyy-MM-dd")].sort().at(-1)!;
  const windowSlots = useQuery({
    queryKey: ["equipment-booking-slots", "window", id, winFrom, winTo],
    enabled: !!equipment.data,
    queryFn: () => fetchEquipmentBookingSlots([id], { from: winFrom, to: winTo }),
    refetchInterval: 60_000,
  });

  const book = useMutation({
    mutationFn: (input: {
      equipment_id: string; booking_date: string; end_date: string; start_time: string;
      end_time: string; quantity: number; project_name: string; purpose: string;
    }) => createBooking(input),
    onSuccess: () => {
      toast.success("Booking confirmed");
      setProjectName(""); setPurpose(""); setValidationError(null);
      invalidateBookingRelatedQueries(qc);
    },
    onError: (er: Error) => {
      const map: Record<string, string> = {
        outside_lab_hours: "Bookings must be between 08:00 and 20:00",
        invalid_time_range: "End time must be after start time",
        invalid_date_range: "To Date must be on or after From Date",
        cannot_book_in_past: "Cannot book in the past",
        insufficient_quantity: "Not enough equipment available for that slot",
        equipment_unavailable: "Equipment is not available for booking",
        duplicate_booking: "You already have an overlapping booking for this equipment — edit or cancel it instead",
        not_authenticated: "You must be signed in to book equipment",
        equipment_not_found: "Equipment not found",
        project_name_required: "Project name is required",
        purpose_required: "Purpose is required",
      };
      toast.error(map[er.message] ?? er.message);
    },
  });

  if (equipment.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!equipment.data) return <div className="text-muted-foreground">Equipment not found.</div>;

  const e = equipment.data;
  const now = new Date();
  const slots = windowSlots.data?.[id] ?? [];
  const isUnavailable = e.status !== "active";
  const rangeValidation = validateBookingDateTimeRange({ fromDate, toDate, startTime, endTime });

  // NOW-based availability drives the smart badge + active-bookings list.
  const nowAvailability = computeEquipmentAvailability(slots, e.total_quantity, now);
  // SELECTED-SLOT availability drives the booking button.
  const slotAvailability: EquipmentAvailability = isUnavailable
    ? { state: "unavailable", totalQty: e.total_quantity, availableQty: 0, bookedQty: e.total_quantity, currentBookings: [] }
    : computeSlotAvailability(slots, e.total_quantity, fromDate, toDate, startTime, endTime, now);

  const availableForSlot = slotAvailability.availableQty;
  const fullyBooked = !isUnavailable && availableForSlot <= 0;
  const canSubmit = Boolean(projectName.trim()) && Boolean(purpose.trim()) && rangeValidation.isValid && availableForSlot >= quantity && !isUnavailable;

  function selectDate(dateStr: string) {
    setFromDate(dateStr);
    setToDate((prev) => (prev < dateStr ? dateStr : prev));
  }

  function submitBooking() {
    const v = validateBookingDateTimeRange({ fromDate, toDate, startTime, endTime });
    if (!v.isValid) { setValidationError(v.error ?? null); return; }
    if (!projectName.trim()) { setValidationError("Project name is required."); return; }
    if (!purpose.trim()) { setValidationError("Purpose is required."); return; }
    setValidationError(null);
    book.mutate({ equipment_id: id, booking_date: fromDate, end_date: toDate, start_time: startTime, end_time: endTime, quantity, project_name: projectName, purpose });
  }

  const disabledReason = isUnavailable
    ? (e.status === "maintenance" ? "This equipment is under maintenance." : "This equipment is retired.")
    : fullyBooked
      ? `Fully booked for the selected slot.${slotAvailability.nextAvailableLabel ? ` Available after ${slotAvailability.nextAvailableLabel}.` : ""}`
      : availableForSlot < quantity
        ? `Only ${availableForSlot} unit${availableForSlot === 1 ? "" : "s"} available for the selected slot.`
        : null;

  return (
    <div className="space-y-5 pb-24 md:pb-0">
      <Link to="/equipment" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to equipment</Link>

      {/* 1. Name */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-mono text-muted-foreground">{e.equipment_code || "—"}</div>
          <h1 className="text-xl sm:text-2xl font-semibold">{e.name}</h1>
          <div className="text-sm text-muted-foreground mt-0.5">{e.category} · {e.lab_location}</div>
        </div>
        <Badge variant={e.status === "active" ? "default" : "secondary"} className="capitalize shrink-0">{e.status}</Badge>
      </div>

      {/* 2. Availability badge */}
      <SmartAvailabilityBadge availability={nowAvailability} status={e.status} itemLabel="equipment" />

      {/* 3 + 4. Calendar with daily schedule */}
      <BookingCalendar
        slots={slots}
        totalQuantity={e.total_quantity}
        maintenance={isUnavailable}
        month={calMonth}
        onMonthChange={setCalMonth}
        selectedDate={fromDate}
        onSelectDate={selectDate}
        labStart={LAB_START}
        labEnd={LAB_END}
      />

      {/* 5. Current active bookings */}
      {nowAvailability.currentBookings.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Current Users {nowAvailability.currentBookings.length > 1 ? `(${nowAvailability.currentBookings.length})` : ""}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {nowAvailability.currentBookings.map((b) => (
              <div key={b.bookingId} className="rounded-md border p-3 text-sm space-y-0.5">
                <div className="font-medium">{b.name}{b.department ? <span className="text-muted-foreground font-normal"> · {b.department}</span> : null}</div>
                <div className="text-xs"><span className="text-muted-foreground">Project:</span> {b.projectName} · <span className="text-muted-foreground">Qty</span> {b.quantity}</div>
                <div className="text-xs text-muted-foreground">{b.fromLabel} → {b.returnsAtLabel}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 6. Equipment information */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Equipment Information</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
          <Info label="Manufacturer">{e.manufacturer ?? "—"}</Info>
          <Info label="Model">{e.model ?? "—"}</Info>
          <Info label="Serial Number">{e.serial_number ?? "—"}</Info>
          <Info label="Total Quantity">{e.total_quantity}</Info>
          <Info label="Calibration Date">{e.calibration_date ?? "—"}</Info>
          <Info label="Calibration Due Date">
            <span className={e.calibration_due_date && e.calibration_due_date < today ? "text-destructive font-medium" : undefined}>{e.calibration_due_date ?? "—"}</span>
          </Info>
          {e.remarks && <Info label="Remarks" className="sm:col-span-2">{e.remarks}</Info>}
        </CardContent>
      </Card>

      {/* 7. Booking form */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold flex items-center gap-2"><CalendarCheck2 className="h-4 w-4" /> Book equipment</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>From Date</Label><Input type="date" min={today} value={fromDate} onChange={(ev) => selectDate(ev.target.value)} /></div>
            <div><Label>To Date</Label><Input type="date" min={fromDate || today} value={toDate} onChange={(ev) => setToDate(ev.target.value)} /></div>
            <div><Label>Start</Label><Input type="time" min={LAB_START} max={LAB_END} value={startTime} onChange={(ev) => setStartTime(ev.target.value)} /></div>
            <div><Label>End</Label><Input type="time" min={LAB_START} max={LAB_END} value={endTime} onChange={(ev) => setEndTime(ev.target.value)} /></div>
            <div><Label>Quantity Required</Label><Input type="number" min={1} max={e.total_quantity} value={quantity} onChange={(ev) => setQuantity(parseInt(ev.target.value || "1", 10))} /></div>
            <div className="flex items-end text-xs text-muted-foreground pb-2">Selected slot: <span className="font-medium text-foreground ml-1">{availableForSlot} / {e.total_quantity} available</span></div>
            <div className="sm:col-span-2"><Label>Project Name</Label><Input required value={projectName} onChange={(ev) => setProjectName(ev.target.value)} placeholder="e.g. Radar Automation" /></div>
            <div className="sm:col-span-2"><Label>Purpose</Label><Textarea rows={2} required value={purpose} onChange={(ev) => setPurpose(ev.target.value)} placeholder="e.g. Sample preparation" /></div>
          </div>
          {!rangeValidation.isValid && <div className="text-xs text-destructive">{rangeValidation.error}</div>}
          {validationError && <div className="text-xs text-destructive">{validationError}</div>}
          <div className="hidden md:block">
            <BookAction label={isUnavailable ? "Unavailable" : fullyBooked ? "Fully Booked" : "Book Equipment"} disabledReason={disabledReason} canSubmit={canSubmit} pending={book.isPending} onSubmit={submitBooking} />
          </div>
          <div className="text-[11px] text-muted-foreground">Lab hours: 08:00 – 20:00</div>
        </CardContent>
      </Card>

      {/* Mobile: sticky bottom action bar */}
      <div className="md:hidden fixed inset-x-0 bottom-14 z-30 border-t bg-card p-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        {!rangeValidation.isValid && <div className="text-xs text-destructive mb-1.5">{rangeValidation.error}</div>}
        {validationError && <div className="text-xs text-destructive mb-1.5">{validationError}</div>}
        <BookAction size="lg" label={isUnavailable ? "Unavailable" : fullyBooked ? "Fully Booked" : `Book Equipment · ${availableForSlot} available`} disabledReason={disabledReason} canSubmit={canSubmit} pending={book.isPending} onSubmit={submitBooking} />
      </div>
    </div>
  );
}

function BookAction({ label, disabledReason, canSubmit, pending, onSubmit, size }: { label: string; disabledReason: string | null; canSubmit: boolean; pending: boolean; onSubmit: () => void; size?: "lg" }) {
  const disabled = pending || !canSubmit;
  if (disabled && disabledReason) {
    return (
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-block w-full" tabIndex={0}>
              <Button className="w-full pointer-events-none" size={size} variant="outline" disabled>{label}</Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return <Button className="w-full" size={size} onClick={onSubmit} disabled={disabled}>{label}</Button>;
}

function Info({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-0.5">{children}</div></div>;
}
