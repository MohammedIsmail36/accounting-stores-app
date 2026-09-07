import { describe, it, expect } from "vitest";
import {
  PAYMENT_VOUCHER_CONFIG,
  EMPTY_PAYMENT_VOUCHER_FILTERS,
  filterPaymentVouchers,
  hasPaymentVoucherFilters,
  getPostedVoucherEditBlockReason,
} from "./payment-voucher";

const rows = [
  { id: "1", payment_method: "cash", status: "posted", payment_date: "2026-01-10" },
  { id: "2", payment_method: "bank", status: "draft", payment_date: "2026-02-15" },
  { id: "3", payment_method: "check", status: "cancelled", payment_date: "2026-03-20" },
];

describe("filterPaymentVouchers", () => {
  it("returns all rows with empty filters", () => {
    expect(filterPaymentVouchers(rows, EMPTY_PAYMENT_VOUCHER_FILTERS)).toHaveLength(3);
  });

  it("filters by method", () => {
    const out = filterPaymentVouchers(rows, { ...EMPTY_PAYMENT_VOUCHER_FILTERS, methodFilter: "bank" });
    expect(out.map((r) => r.id)).toEqual(["2"]);
  });

  it("filters by status", () => {
    const out = filterPaymentVouchers(rows, { ...EMPTY_PAYMENT_VOUCHER_FILTERS, statusFilter: "posted" });
    expect(out.map((r) => r.id)).toEqual(["1"]);
  });

  it("filters by inclusive date range", () => {
    const out = filterPaymentVouchers(rows, {
      ...EMPTY_PAYMENT_VOUCHER_FILTERS,
      dateFrom: "2026-02-15",
      dateTo: "2026-03-20",
    });
    expect(out.map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("combines filters", () => {
    const out = filterPaymentVouchers(rows, {
      methodFilter: "cash",
      statusFilter: "posted",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
    expect(out.map((r) => r.id)).toEqual(["1"]);
  });
});

describe("hasPaymentVoucherFilters", () => {
  it("is false for the empty state", () => {
    expect(hasPaymentVoucherFilters(EMPTY_PAYMENT_VOUCHER_FILTERS)).toBe(false);
  });

  it("is true when any filter is set", () => {
    expect(hasPaymentVoucherFilters({ ...EMPTY_PAYMENT_VOUCHER_FILTERS, dateTo: "2026-01-01" })).toBe(true);
    expect(hasPaymentVoucherFilters({ ...EMPTY_PAYMENT_VOUCHER_FILTERS, statusFilter: "draft" })).toBe(true);
  });
});

describe("getPostedVoucherEditBlockReason", () => {
  it("allows editing an unlocked, non-refund voucher", () => {
    expect(getPostedVoucherEditBlockReason({ payment_date: "2026-05-01" }, "2026-04-30")).toBeNull();
  });

  it("blocks editing inside a locked period (inclusive)", () => {
    expect(getPostedVoucherEditBlockReason({ payment_date: "2026-04-30" }, "2026-04-30")).toContain("الفترة مقفلة");
  });

  it("blocks editing refund vouchers", () => {
    expect(getPostedVoucherEditBlockReason({ payment_date: "2026-05-01", isRefund: true }, null)).toContain("مرتجع");
  });

  it("ignores the lock when no lock date is set", () => {
    expect(getPostedVoucherEditBlockReason({ payment_date: "2020-01-01" }, null)).toBeNull();
  });
});

describe("PAYMENT_VOUCHER_CONFIG", () => {
  it("credits AR for customer receipts and debits AP for supplier payments", () => {
    expect(PAYMENT_VOUCHER_CONFIG.customer.entityAccountSide).toBe("credit");
    expect(PAYMENT_VOUCHER_CONFIG.supplier.entityAccountSide).toBe("debit");
  });

  it("maps each kind to its own tables and RPCs", () => {
    expect(PAYMENT_VOUCHER_CONFIG.customer.table).toBe("customer_payments");
    expect(PAYMENT_VOUCHER_CONFIG.customer.invoiceKind).toBe("sales");
    expect(PAYMENT_VOUCHER_CONFIG.customer.editRpc).toBe("edit_customer_payment");
    expect(PAYMENT_VOUCHER_CONFIG.supplier.table).toBe("supplier_payments");
    expect(PAYMENT_VOUCHER_CONFIG.supplier.invoiceKind).toBe("purchase");
    expect(PAYMENT_VOUCHER_CONFIG.supplier.editRpc).toBe("edit_supplier_payment");
  });
});
