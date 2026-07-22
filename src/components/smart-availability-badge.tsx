import { cn } from "@/lib/utils";
import type { EquipmentAvailability } from "@/lib/equipment-availability";

/**
 * Prominent, real-time "smart" availability status shown at the top of the detail pages.
 * Driven by NOW-based availability (computeEquipmentAvailability / computeAccessoryAvailability),
 * it turns raw quantities into intent-revealing messages. Shared by Equipment and Accessories.
 */
export function SmartAvailabilityBadge({
  availability,
  status,
  itemLabel = "equipment",
}: {
  availability: EquipmentAvailability;
  status: string; // active | maintenance | retired
  itemLabel?: string;
}) {
  const soonest = availability.currentBookings[0]; // sorted by earliest end

  if (status !== "active") {
    const maintenance = status === "maintenance";
    return (
      <Shell tone="slate" dot="bg-slate-400" heading={maintenance ? "Under Maintenance" : "Retired"}>
        <span className="text-muted-foreground">
          {maintenance ? `This ${itemLabel} is temporarily out of service.` : `This ${itemLabel} is no longer in service.`}
        </span>
      </Shell>
    );
  }

  if (availability.state === "available") {
    return (
      <Shell tone="emerald" dot="bg-emerald-500" heading="Available Now">
        <span className="text-muted-foreground">
          All {availability.totalQty} unit{availability.totalQty === 1 ? "" : "s"} free.
          {availability.nextReservation && <> Next reservation {availability.nextReservation.fromLabel}.</>}
        </span>
      </Shell>
    );
  }

  if (availability.state === "fully_booked") {
    return (
      <Shell tone="red" dot="bg-red-500" heading="Currently Booked">
        <div className="grid gap-0.5 sm:grid-cols-2">
          {soonest && <Fact label="Booked by">{soonest.name}{soonest.department ? ` · ${soonest.department}` : ""}</Fact>}
          {soonest && <Fact label="Available after">{soonest.returnsAtLabel}</Fact>}
        </div>
      </Shell>
    );
  }

  // limited / partially available
  return (
    <Shell tone="amber" dot="bg-amber-500" heading={`${availability.availableQty} of ${availability.totalQty} Available`}>
      <div className="grid gap-0.5 sm:grid-cols-2">
        <Fact label="In use now">{availability.bookedQty} unit{availability.bookedQty === 1 ? "" : "s"}</Fact>
        {soonest && <Fact label="Next unit available">{soonest.returnsAtLabel}</Fact>}
      </div>
    </Shell>
  );
}

const TONE: Record<string, string> = {
  emerald: "border-emerald-500/30 bg-emerald-500/5",
  amber: "border-amber-500/30 bg-amber-500/5",
  red: "border-red-500/30 bg-red-500/5",
  slate: "border-border bg-muted/30",
};
const HEAD_TONE: Record<string, string> = {
  emerald: "text-emerald-700 dark:text-emerald-400",
  amber: "text-amber-700 dark:text-amber-400",
  red: "text-red-700 dark:text-red-400",
  slate: "text-muted-foreground",
};

function Shell({ tone, dot, heading, children }: { tone: string; dot: string; heading: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-lg border p-4", TONE[tone])}>
      <div className={cn("flex items-center gap-2 text-base font-semibold", HEAD_TONE[tone])}>
        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", dot)} />
        {heading}
      </div>
      <div className="mt-1.5 text-sm">{children}</div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><span className="text-muted-foreground">{label}: </span><span className="font-medium">{children}</span></div>;
}
