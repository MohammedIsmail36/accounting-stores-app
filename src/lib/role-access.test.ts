import { describe, expect, it } from "vitest";
import {
  canCancelPostedSalesDocument,
  FINANCE_ROLES,
} from "./role-access";

describe("financial role access", () => {
  it("keeps financial pages limited to administrators and accountants", () => {
    expect(FINANCE_ROLES).toEqual(["admin", "accountant"]);
    expect(FINANCE_ROLES).not.toContain("sales");
  });

  it("prevents sales from cancelling posted sales documents", () => {
    expect(canCancelPostedSalesDocument("admin")).toBe(true);
    expect(canCancelPostedSalesDocument("accountant")).toBe(true);
    expect(canCancelPostedSalesDocument("sales")).toBe(false);
    expect(canCancelPostedSalesDocument(null)).toBe(false);
  });
});
