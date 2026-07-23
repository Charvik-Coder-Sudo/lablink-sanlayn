import { cn } from "@/lib/utils";
import type { EquipmentAvailability } from "@/lib/equipment-availability";

export const AVAILABILITY_CONFIG: Record<EquipmentAvailability["state"], { dot: string; text: string; emoji: string; label: (a: EquipmentAvailability) => string }> = {
  available: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", emoji: "🟢", label: () => "Available" },
  limited: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", emoji: "🟡", label: (a) => `Partially Available (${a.availableQty} of ${a.totalQty})` },
  fully_booked: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400", emoji: "🔴", label: () => "Unavailable" },
  unavailable: { dot: "bg-blue-500", text: "text-blue-700 dark:text-blue-400", emoji: "🔵", label: () => "Under Maintenance" },
};

export function EquipmentAvailabilityBadge({ availability }: { availability: EquipmentAvailability }) {
  const cfg = AVAILABILITY_CONFIG[availability.state];
  return (
    <div className="space-y-1">
      <div className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", cfg.text)}>
        <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dot)} />
        {cfg.label(availability)}
      </div>
      <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
        {availability.currentBookings.length > 0 && (
          <div className="space-y-1">
            {availability.currentBookings.map((b) => (
              <div key={b.bookingId}>
                <span className="font-medium text-foreground">Booked by:</span> {b.name}
                {b.department ? ` (${b.department})` : ""}
                {" · "}<span className="font-medium text-foreground">Project:</span> {b.projectName}
                {" · "}<span className="font-medium text-foreground">Returns:</span> {b.returnsAtLabel}
              </div>
            ))}
          </div>
        )}
        {availability.state === "unavailable" && availability.reasonLabel}
        {availability.nextReservation && availability.state !== "unavailable" && (
          <div>
            <span className="font-medium text-foreground">Next reservation:</span> {availability.nextReservation.fromLabel} ({availability.nextReservation.name})
          </div>
        )}
      </div>
    </div>
  );
}
