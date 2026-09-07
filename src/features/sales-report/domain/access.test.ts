import { describe, expect, it } from "vitest";
import {
  canAccessFullSalesReport,
  FULL_SALES_REPORT_ROLES,
} from "./access";

describe("full sales report access", () => {
  it("allows administrators and accountants", () => {
    expect(canAccessFullSalesReport("admin")).toBe(true);
    expect(canAccessFullSalesReport("accountant")).toBe(true);
  });

  it("denies sales users and missing roles", () => {
    expect(canAccessFullSalesReport("sales")).toBe(false);
    expect(canAccessFullSalesReport(null)).toBe(false);
  });

  it("keeps the shared route and navigation allow-list cost-safe", () => {
    expect(FULL_SALES_REPORT_ROLES).toEqual(["admin", "accountant"]);
    expect(FULL_SALES_REPORT_ROLES).not.toContain("sales");
  });
});
