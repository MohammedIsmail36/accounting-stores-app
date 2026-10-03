import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_CODES } from "./constants";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  createJournalEntry: vi.fn(),
  getNextPostedNumber: vi.fn(),
  recalculateEntityBalance: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/lib/journal-writer", () => ({ createJournalEntry: mocks.createJournalEntry }));
vi.mock("@/lib/posted-number-utils", () => ({ getNextPostedNumber: mocks.getNextPostedNumber }));
vi.mock("@/lib/entity-balance", () => ({
  recalculateEntityBalance: mocks.recalculateEntityBalance,
  recalculateInvoicePaidAmount: vi.fn(),
}));

import { postPaymentVoucher, type PaymentVoucherKind } from "./payment-voucher";

const input = (kind: PaymentVoucherKind, existingPaymentId?: string) => ({
  kind,
  entityId: "synthetic-entity",
  entityName: "Synthetic entity",
  date: "2026-10-03",
  amount: 100,
  method: "cash",
  reference: null,
  notes: null,
  existingPaymentId,
});

function mockVoucherWrite(kind: PaymentVoucherKind, result: { data: unknown; error: Error | null }) {
  const paymentTable = kind === "customer" ? "customer_payments" : "supplier_payments";
  const controlCode = kind === "customer" ? ACCOUNT_CODES.CUSTOMERS : ACCOUNT_CODES.SUPPLIERS;
  mocks.from.mockImplementation((table: string) => {
    if (table === "accounts") {
      return {
        select: () => ({
          in: async () => ({
            data: [
              { id: "synthetic-control", code: controlCode },
              { id: "synthetic-cash", code: ACCOUNT_CODES.CASH },
            ],
            error: null,
          }),
        }),
      };
    }
    if (table === paymentTable) {
      return {
        insert: async () => result,
        update: () => ({ eq: async () => result }),
      };
    }
    throw new Error(`Unexpected table in synthetic test: ${table}`);
  });
}

describe("RED characterization: voucher posting currently reports success after a failed write", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createJournalEntry.mockResolvedValue("synthetic-journal");
    mocks.getNextPostedNumber.mockResolvedValue(1);
    mocks.recalculateEntityBalance.mockResolvedValue(0);
  });

  for (const kind of ["customer", "supplier"] as const) {
    it(`${kind}: ignores an insertion error after journal creation`, async () => {
      mockVoucherWrite(kind, { data: null, error: new Error("SYNTHETIC_VOUCHER_INSERT_FAILED") });
      const result = await postPaymentVoucher(input(kind));
      expect(mocks.createJournalEntry).toHaveBeenCalledOnce();
      expect(mocks.recalculateEntityBalance).toHaveBeenCalledOnce();
      expect(result).toEqual({ postedNumber: 1 });
    });

    it(`${kind}: ignores an update that affects no draft row`, async () => {
      mockVoucherWrite(kind, { data: null, error: null });
      const result = await postPaymentVoucher(input(kind, "synthetic-missing-draft"));
      expect(mocks.createJournalEntry).toHaveBeenCalledOnce();
      expect(mocks.recalculateEntityBalance).toHaveBeenCalledOnce();
      expect(result).toEqual({ postedNumber: 1 });
    });
  }
});
