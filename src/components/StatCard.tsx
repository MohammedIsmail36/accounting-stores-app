import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone =
  | "primary"
  | "blue"
  | "orange"
  | "purple"
  | "emerald"
  | "red"
  | "amber"
  | "rose";

const TONE_CLASSES: Record<StatTone, string> = {
  primary: "bg-primary/10 text-primary",
  blue: "bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400",
  orange: "bg-orange-100 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400",
  purple: "bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400",
  emerald: "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  red: "bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400",
  amber: "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400",
  rose: "bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

export interface StatCardProps {
  /** مكوّن أيقونة (lucide) أو عنصر أيقونة جاهز */
  icon: React.ComponentType<{ className?: string }> | React.ReactNode;
  label: string;
  value: React.ReactNode;
  /** سطر فرعي أسفل القيمة (مقارنة، عدد، عملة...) */
  sub?: React.ReactNode;
  /** تلميح توضيحي يظهر كأيقونة معلومات بجانب العنوان */
  hint?: string;
  tone?: StatTone;
  valueClass?: string;
  className?: string;
  onClick?: () => void;
  /** md: مضغوط (لوحات المؤشرات) • lg: بطاقة تقارير كبيرة */
  size?: "md" | "lg";
  /** تجاوز خلفية الأيقونة (للحالات القديمة التي تمرر classes مباشرة) */
  iconBg?: string;
}

/**
 * بطاقة مؤشر موحّدة — تحل محل تعريفات KpiCard المحلية المكرّرة.
 */
export function StatCard({
  icon,
  label,
  value,
  sub,
  hint,
  tone = "primary",
  valueClass,
  className,
  onClick,
  size = "md",
  iconBg,
}: StatCardProps) {
  const lg = size === "lg";
  const iconNode = React.isValidElement(icon)
    ? icon
    : (() => {
        const Icon = icon as React.ComponentType<{ className?: string }>;
        return <Icon className={lg ? "h-5 w-5" : "h-3 w-3"} />;
      })();

  if (lg) {
    return (
      <Card
        className={cn(
          "border shadow-sm",
          onClick && "cursor-pointer transition-colors hover:bg-muted/40",
          className,
        )}
        onClick={onClick}
      >
        <CardContent className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div
              className={cn(
                "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                iconBg || TONE_CLASSES[tone],
              )}
            >
              {iconNode}
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-sm text-muted-foreground font-medium">{label}</p>
              {hint && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground/50 cursor-help shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs text-right">
                    {hint}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
          <p
            className={cn(
              "text-2xl font-black font-mono tabular-nums leading-tight",
              valueClass,
            )}
            style={{ wordBreak: "break-all" }}
          >
            {value}
          </p>
          {sub && (
            <p className="text-xs text-muted-foreground mt-1 font-mono">{sub}</p>
          )}
        </CardContent>
      </Card>
    );
  }


  return (
    <Card
      className={cn(
        "border shadow-sm",
        onClick && "cursor-pointer transition-colors hover:bg-muted/40",
        className,
      )}
      onClick={onClick}
    >
      <CardContent className="pt-3 pb-3 px-3">
        <div className="flex items-start justify-between gap-1 mb-2">
          <div className="flex items-center gap-1 min-w-0">
            <p className="text-[11px] leading-snug text-muted-foreground line-clamp-2">
              {label}
            </p>
            {hint && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-2.5 w-2.5 text-muted-foreground/40 cursor-help shrink-0 mt-px" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs text-right">
                  {hint}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div
            className={cn(
              "w-6 h-6 rounded-md flex items-center justify-center shrink-0",
              iconBg || TONE_CLASSES[tone],
            )}
          >
            {iconNode}
          </div>

        </div>

        <p
          className={cn(
            "text-base font-bold tabular-nums font-mono leading-tight",
            valueClass,
          )}
          style={{ wordBreak: "break-all" }}
        >
          {value}
        </p>

        {sub && (
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** شبكة بطاقات المؤشرات المتجاوبة الموحّدة */
export function StatGrid({
  cols = 4,
  className,
  children,
}: {
  cols?: 2 | 3 | 4 | 5;
  className?: string;
  children: React.ReactNode;
}) {
  const colClass = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-2 lg:grid-cols-5",
  }[cols];

  return (
    <div className={cn("grid grid-cols-1 gap-3", colClass, className)}>{children}</div>
  );
}
