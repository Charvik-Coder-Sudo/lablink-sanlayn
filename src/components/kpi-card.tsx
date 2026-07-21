import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface KpiCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  to?: string;
  search?: Record<string, string>;
  trend?: { value: number; label?: string };
  tone?: "default" | "warning" | "danger";
}

const TONE_ICON_BG: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "bg-accent text-accent-foreground",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  danger: "bg-destructive/15 text-destructive",
};

export function KpiCard({ title, value, icon: Icon, hint, to, search, trend, tone = "default" }: KpiCardProps) {
  const body = (
    <Card className={cn("border-border h-full", to && "transition-shadow hover:shadow-elevated cursor-pointer")}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
          <div className={cn("h-9 w-9 rounded-md grid place-items-center", TONE_ICON_BG[tone])}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-3 text-2xl font-semibold">{value}</div>
        <div className="mt-1 flex items-center gap-2 min-h-[1rem]">
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
          {trend && (
            <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", trend.value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
              {trend.value >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              {Math.abs(trend.value)}% {trend.label ?? ""}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (!to) return body;
  return <Link to={to} search={search} className="block h-full">{body}</Link>;
}
