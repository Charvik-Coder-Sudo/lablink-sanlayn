import { cn } from "@/lib/utils";
import type { EquipmentAvailability } from "@/lib/equipment-availability";

const CONFIG: Record<EquipmentAvailability["state"], { dot: string; text: string; label: string }> = {
  available: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", label: "Available" },
  booked: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400", label: "Currently Booked" },
  reserved: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", label: "Reserved" },
  unavailable: { dot: "bg-muted-foreground", text: "text-muted-foreground", label: "Unavailable" },
};

export function EquipmentAvailabilityBadge({ availability }: { availability: EquipmentAvailability }) {
  const cfg = CONFIG[availability.state];
  return (
    <div className="space-y-1">
      <div className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", cfg.text)}>
        <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dot)} />
        {cfg.label}
      </div>
      <div className="text-xs text-muted-foreground leading-relaxed">
        {availability.state === "available" && "Available Now"}
        {availability.state === "booked" && availability.bookedBy && (
          <div className="space-y-0.5">
            <div>
              <span className="font-medium text-foreground">Booked By:</span> {availability.bookedBy.name}
              {availability.bookedBy.department ? ` (${availability.bookedBy.department})` : ""}
            </div>
            <div>
              <span className="font-medium text-foreground">Available At:</span> {availability.availableAtLabel}
            </div>
          </div>
        )}
        {availability.state === "reserved" && (
          <div>
            <span className="font-medium text-foreground">Reserved From:</span> {availability.reservedFromLabel}
          </div>
        )}
        {availability.state === "unavailable" && availability.reasonLabel}
      </div>
    </div>
  );
}
