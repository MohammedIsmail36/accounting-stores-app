export type AppRole = "admin" | "accountant" | "sales";

/** Roles allowed to see or change company-wide accounting and cost data. */
export const FINANCE_ROLES: AppRole[] = ["admin", "accountant"];

/** Cancelling a posted sales document creates a financial reversal. */
export function canCancelPostedSalesDocument(
  role: AppRole | null | undefined,
): boolean {
  return Boolean(role && FINANCE_ROLES.includes(role));
}
