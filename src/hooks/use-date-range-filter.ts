import { useCallback, useMemo, useState } from "react";
import {
  endOfMonth,
  endOfQuarter,
  endOfYear,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subDays,
} from "date-fns";
import { toDateString } from "@/lib/utils";

export type DateRangePreset =
  | "all"
  | "today"
  | "last7"
  | "last30"
  | "month"
  | "quarter"
  | "year"
  | "custom";

export const DATE_RANGE_PRESET_LABELS: Record<DateRangePreset, string> = {
  all: "كل الوقت",
  today: "اليوم",
  last7: "آخر 7 أيام",
  last30: "آخر 30 يوماً",
  month: "الشهر الحالي",
  quarter: "الربع الحالي",
  year: "السنة الحالية",
  custom: "مخصص",
};

function rangeFor(preset: DateRangePreset): { from: string; to: string } {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: toDateString(now), to: toDateString(now) };
    case "last7":
      return { from: toDateString(subDays(now, 6)), to: toDateString(now) };
    case "last30":
      return { from: toDateString(subDays(now, 29)), to: toDateString(now) };
    case "month":
      return { from: toDateString(startOfMonth(now)), to: toDateString(endOfMonth(now)) };
    case "quarter":
      return {
        from: toDateString(startOfQuarter(now)),
        to: toDateString(endOfQuarter(now)),
      };
    case "year":
      return { from: toDateString(startOfYear(now)), to: toDateString(endOfYear(now)) };
    default:
      return { from: "", to: "" };
  }
}

/**
 * حالة فلتر التاريخ الموحّدة (نطاقات جاهزة + مخصص).
 * الافتراضي «كل الوقت» ليطابق سلوك التقارير الحالية.
 */
export function useDateRangeFilter(initialPreset: DateRangePreset = "all") {
  const initial = rangeFor(initialPreset);
  const [preset, setPresetState] = useState<DateRangePreset>(initialPreset);
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);

  const setPreset = useCallback((next: DateRangePreset) => {
    setPresetState(next);
    if (next === "custom") return;
    const r = rangeFor(next);
    setDateFrom(r.from);
    setDateTo(r.to);
  }, []);

  const setCustomFrom = useCallback((v: string) => {
    setPresetState("custom");
    setDateFrom(v);
  }, []);

  const setCustomTo = useCallback((v: string) => {
    setPresetState("custom");
    setDateTo(v);
  }, []);

  const reset = useCallback(() => setPreset(initialPreset), [initialPreset, setPreset]);

  const isActive = useMemo(() => Boolean(dateFrom || dateTo), [dateFrom, dateTo]);

  /** فلترة محلية لمصفوفة سجلات بحقل تاريخ نصي (yyyy-MM-dd) */
  const filterByDate = useCallback(
    <T,>(rows: T[], getDate: (row: T) => string | null | undefined): T[] => {
      if (!dateFrom && !dateTo) return rows;
      return rows.filter((r) => {
        const d = getDate(r);
        if (!d) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      });
    },
    [dateFrom, dateTo],
  );

  return {
    preset,
    setPreset,
    dateFrom,
    dateTo,
    setCustomFrom,
    setCustomTo,
    reset,
    isActive,
    filterByDate,
  };
}
