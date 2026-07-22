import { useMemo } from "react";
import { format, startOfMonth, endOfMonth, startOfWeek, addDays, addMonths, isSameMonth, isSameDay, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import {
  computeDayState, buildDaySchedule, type DayState, type SlotForAvailability,
} from "@/lib/equipment-availability";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

const DAY_DOT: Record<DayState, string> = {
  available: "bg-emerald-500",
  partial: "bg-amber-500",
  booked: "bg-red-500",
  maintenance: "bg-slate-400",
};

const LEGEND: Array<{ state: DayState; label: string }> = [
  { state: "available", label: "Available" },
  { state: "partial", label: "Partially Available" },
  { state: "booked", label: "Fully Booked" },
  { state: "maintenance", label: "Maintenance" },
];

/**
 * Google-Calendar-style month view with a per-day availability colour and a daily schedule
 * for the selected date. Shared verbatim by Equipment and Accessory detail pages — the only
 * inputs are the item's booked slots + total quantity, so behaviour is identical for both.
 */
export function BookingCalendar({
  slots,
  totalQuantity,
  maintenance = false,
  month,
  onMonthChange,
  selectedDate,
  onSelectDate,
  labStart,
  labEnd,
}: {
  slots: SlotForAvailability[];
  totalQuantity: number;
  maintenance?: boolean;
  month: Date;
  onMonthChange: (d: Date) => void;
  selectedDate: string;
  onSelectDate: (dateStr: string) => void;
  labStart: string;
  labEnd: string;
}) {
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const weeks = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
    const cells: Date[] = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    const rows: Date[][] = [];
    for (let i = 0; i < 6; i++) rows.push(cells.slice(i * 7, i * 7 + 7));
    return rows;
  }, [month]);

  const daySchedule = useMemo(
    () => buildDaySchedule(slots, selectedDate, labStart, labEnd),
    [slots, selectedDate, labStart, labEnd],
  );

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Month header */}
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold">{format(month, "MMMM yyyy")}</div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onMonthChange(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => { onMonthChange(new Date()); onSelectDate(todayStr); }}>Today</Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onMonthChange(addMonths(month, 1))} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-1">
          {weeks.flat().map((date) => {
            const dateStr = format(date, "yyyy-MM-dd");
            const inMonth = isSameMonth(date, month);
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            const isPast = dateStr < todayStr;
            const state: DayState = maintenance ? "maintenance" : computeDayState(slots, totalQuantity, dateStr);
            return (
              <button
                key={dateStr}
                onClick={() => onSelectDate(dateStr)}
                className={cn(
                  "relative aspect-square rounded-md text-sm flex flex-col items-center justify-center gap-1 transition-colors",
                  "hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring",
                  !inMonth && "text-muted-foreground/40",
                  isPast && "opacity-50",
                  isSelected && "bg-primary text-primary-foreground hover:bg-primary",
                  !isSelected && isToday && "ring-1 ring-primary",
                )}
              >
                <span className={cn(isToday && !isSelected && "font-semibold text-primary")}>{format(date, "d")}</span>
                <span className={cn("h-1.5 w-1.5 rounded-full", isSelected ? "bg-primary-foreground" : DAY_DOT[state])} />
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {LEGEND.map((l) => (
            <span key={l.state} className="inline-flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", DAY_DOT[l.state])} /> {l.label}
            </span>
          ))}
        </div>

        {/* Daily schedule */}
        <div className="border-t pt-3">
          <div className="text-sm font-semibold mb-2">{format(parseISO(selectedDate), "EEEE, d MMMM yyyy")}</div>
          {maintenance ? (
            <div className="text-sm text-muted-foreground">This item is under maintenance — not bookable.</div>
          ) : (
            <ol className="space-y-1.5">
              {daySchedule.map((seg, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="font-mono text-xs text-muted-foreground w-[92px] shrink-0 pt-0.5">{seg.fromLabel}–{seg.toLabel}</span>
                  {seg.kind === "available" ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Available
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
                      <span><span className="font-medium">{seg.name}</span>{seg.project ? <span className="text-muted-foreground"> · {seg.project}</span> : null}</span>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
