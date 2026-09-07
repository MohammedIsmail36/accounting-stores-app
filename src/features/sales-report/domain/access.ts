import { FINANCE_ROLES, type AppRole } from "@/lib/role-access";

export type SalesReportAccessRole = AppRole;

/**
 * The full report exposes cost of goods sold, profit, and margin data.
 * Keep this list shared by route and navigation guards so access cannot drift.
 */
export const FULL_SALES_REPORT_ROLES: SalesReportAccessRole[] = FINANCE_ROLES;

export function canAccessFullSalesReport(
  role: SalesReportAccessRole | null | undefined,
): boolean {
  return Boolean(role && FULL_SALES_REPORT_ROLES.includes(role));
}
