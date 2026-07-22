import { cn } from "@/lib/utils";

interface TimelineSlot {
  id: string;
  start_time: string;
  end_time: string;
  quantity: number;
  profile?: { full_name?: string | null } | null;
}

function toMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** A single-day, Google-Calendar-style horizontal timeline: each booking occupies its slot within lab hours. */
export function BookingTimeline({ slots, labStart, labEnd }: { slots: TimelineSlot[]; labStart: string; labEnd: string }) {
  const startMin = toMinutes(labStart);
  const endMin = toMinutes(labEnd);
  const span = endMin - startMin;
  const hours = Array.from({ length: Math.floor(span / 60) + 1 }, (_, i) => startMin + i * 60);

  return (
    <div className="space-y-1">
      <div className="relative h-8 text-[10px] text-muted-foreground select-none">
        {hours.map((m) => (
          <span key={m} className="absolute -translate-x-1/2" style={{ left: `${((m - startMin) / span) * 100}%` }}>
            {String(Math.floor(m / 60)).padStart(2, "0")}:00
          </span>
        ))}
      </div>
      <div className="relative h-12 rounded-md border bg-muted/20 overflow-hidden">
        {hours.map((m) => (
          <div key={m} className="absolute top-0 bottom-0 border-l border-border/50" style={{ left: `${((m - startMin) / span) * 100}%` }} />
        ))}
        {slots.map((s) => {
          const from = Math.max(toMinutes(s.start_time), startMin);
          const to = Math.min(toMinutes(s.end_time), endMin);
          if (to <= from) return null;
          const left = ((from - startMin) / span) * 100;
          const width = ((to - from) / span) * 100;
          return (
            <div
              key={s.id}
              className={cn(
                "absolute top-1.5 bottom-1.5 rounded bg-primary/80 text-primary-foreground text-[10px] px-1.5 flex items-center overflow-hidden whitespace-nowrap",
              )}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${s.profile?.full_name ?? "Booked"} · ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)} · Qty ${s.quantity}`}
            >
              {s.profile?.full_name ?? "Booked"}
            </div>
          );
        })}
      </div>
    </div>
  );
}
