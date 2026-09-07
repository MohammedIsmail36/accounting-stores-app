import { useEffect, useState } from "react";

export type SalesReportStatusFilter =
  | "all"
  | "posted"
  | "draft"
  | "cancelled";
export type SalesReportGroupBy =
  | "invoice"
  | "return"
  | "customer"
  | "product"
  | "time"
  | "category";
export type SalesReportTimeMode = "daily" | "monthly";
export type SalesReportComparisonMode = "previous_period" | "previous_year";

export interface SalesReportPreferences {
  statusFilter: SalesReportStatusFilter;
  groupBy: SalesReportGroupBy;
  timeMode: SalesReportTimeMode;
  comparisonMode: SalesReportComparisonMode;
}

export const SALES_REPORT_PREFERENCES_KEY = "sales-report-prefs-v1";

export const DEFAULT_SALES_REPORT_PREFERENCES: SalesReportPreferences = {
  statusFilter: "posted",
  groupBy: "invoice",
  timeMode: "daily",
  comparisonMode: "previous_period",
};

const STATUS_FILTERS = new Set<SalesReportStatusFilter>([
  "all",
  "posted",
  "draft",
  "cancelled",
]);
const GROUPS = new Set<SalesReportGroupBy>([
  "invoice",
  "return",
  "customer",
  "product",
  "time",
  "category",
]);
const TIME_MODES = new Set<SalesReportTimeMode>(["daily", "monthly"]);
const COMPARISON_MODES = new Set<SalesReportComparisonMode>([
  "previous_period",
  "previous_year",
]);

export function parseSalesReportPreferences(
  rawValue: string | null,
): SalesReportPreferences {
  if (!rawValue) return DEFAULT_SALES_REPORT_PREFERENCES;

  try {
    const parsed = JSON.parse(rawValue) as Partial<SalesReportPreferences>;
    return {
      statusFilter: STATUS_FILTERS.has(parsed.statusFilter as SalesReportStatusFilter)
        ? (parsed.statusFilter as SalesReportStatusFilter)
        : DEFAULT_SALES_REPORT_PREFERENCES.statusFilter,
      groupBy: GROUPS.has(parsed.groupBy as SalesReportGroupBy)
        ? (parsed.groupBy as SalesReportGroupBy)
        : DEFAULT_SALES_REPORT_PREFERENCES.groupBy,
      timeMode: TIME_MODES.has(parsed.timeMode as SalesReportTimeMode)
        ? (parsed.timeMode as SalesReportTimeMode)
        : DEFAULT_SALES_REPORT_PREFERENCES.timeMode,
      comparisonMode: COMPARISON_MODES.has(
        parsed.comparisonMode as SalesReportComparisonMode,
      )
        ? (parsed.comparisonMode as SalesReportComparisonMode)
        : DEFAULT_SALES_REPORT_PREFERENCES.comparisonMode,
    };
  } catch {
    return DEFAULT_SALES_REPORT_PREFERENCES;
  }
}

function readPreferences(): SalesReportPreferences {
  try {
    return parseSalesReportPreferences(
      localStorage.getItem(SALES_REPORT_PREFERENCES_KEY),
    );
  } catch {
    return DEFAULT_SALES_REPORT_PREFERENCES;
  }
}

export function useSalesReportPreferences() {
  const [initialPreferences] = useState(readPreferences);
  const [statusFilter, setStatusFilter] = useState(
    initialPreferences.statusFilter,
  );
  const [groupBy, setGroupBy] = useState(initialPreferences.groupBy);
  const [timeMode, setTimeMode] = useState(initialPreferences.timeMode);
  const [comparisonMode, setComparisonMode] = useState(
    initialPreferences.comparisonMode,
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        SALES_REPORT_PREFERENCES_KEY,
        JSON.stringify({ statusFilter, groupBy, timeMode, comparisonMode }),
      );
    } catch {
      // The report still works when browser storage is unavailable.
    }
  }, [statusFilter, groupBy, timeMode, comparisonMode]);

  return {
    statusFilter,
    setStatusFilter,
    groupBy,
    setGroupBy,
    timeMode,
    setTimeMode,
    comparisonMode,
    setComparisonMode,
  };
}
