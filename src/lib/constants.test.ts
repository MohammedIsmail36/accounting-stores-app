import { describe, it, expect } from "vitest";
import {
  isBalanced,
  BALANCE_TOLERANCE,
  ACCOUNT_CODES,
  INVOICE_STATUS_LABELS,
  MOVEMENT_TYPE_LABELS,
  FISCAL_CLOSING_DESCRIPTION_PREFIX,
} from "./constants";

describe("isBalanced", () => {
  it("returns true when debit === credit", () => {
    expect(isBalanced(100, 100)).toBe(true);
  });

  it("returns true when difference is within BALANCE_TOLERANCE", () => {
    expect(isBalanced(100, 100.005)).toBe(true);
    expect(isBalanced(100, 100.009)).toBe(true);
  });

  it("returns false when difference exceeds tolerance", () => {
    expect(isBalanced(100, 100.02)).toBe(false);
    expect(isBalanced(100, 99.98)).toBe(false);
  });

  it("handles 0/0", () => {
    expect(isBalanced(0, 0)).toBe(true);
  });

  it("handles very large numbers", () => {
    expect(isBalanced(999999999, 999999999)).toBe(true);
    expect(isBalanced(999999999, 999999999.005)).toBe(true);
    expect(isBalanced(999999999, 999999999.02)).toBe(false);
  });

  it("handles negative numbers", () => {
    expect(isBalanced(-50, -50)).toBe(true);
    expect(isBalanced(-50, -50.005)).toBe(true);
    expect(isBalanced(-50, -50.02)).toBe(false);
  });
});

describe("ACCOUNT_CODES", () => {
  it("has all expected keys", () => {
    const expectedKeys = [
      "CASH",
      "BANK",
      "CUSTOMERS",
      "INVENTORY",
      "INPUT_VAT",
      "SUPPLIERS",
      "SALES_TAX",
      "EQUITY",
      "RETAINED_EARNINGS",
      "REVENUE",
      "INVENTORY_ADJUSTMENT_GAIN",
      "COGS",
      "PURCHASE_RETURN_PRICE_VARIANCE",
      "INVENTORY_ADJUSTMENT_LOSS",

    ];
    expect(Object.keys(ACCOUNT_CODES)).toEqual(expectedKeys);
  });

  it("has string values for all codes", () => {
    Object.values(ACCOUNT_CODES).forEach((code) => {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    });
  });
});

describe("INVOICE_STATUS_LABELS", () => {
  it("has all expected statuses", () => {
    expect(Object.keys(INVOICE_STATUS_LABELS)).toEqual(
      expect.arrayContaining(["draft", "posted", "cancelled"]),
    );
  });

  it("has non-empty string labels", () => {
    Object.values(INVOICE_STATUS_LABELS).forEach((label) => {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    });
  });
});

describe("MOVEMENT_TYPE_LABELS", () => {
  it("has all expected movement types", () => {
    const expectedTypes = [
      "opening_balance",
      "purchase",
      "purchase_return",
      "sale",
      "sale_return",
      "adjustment",
    ];
    expect(Object.keys(MOVEMENT_TYPE_LABELS)).toEqual(
      expect.arrayContaining(expectedTypes),
    );
  });

  it("has non-empty string labels", () => {
    Object.values(MOVEMENT_TYPE_LABELS).forEach((label) => {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    });
  });
});

describe("BALANCE_TOLERANCE", () => {
  it("equals 0.01", () => {
    expect(BALANCE_TOLERANCE).toBe(0.01);
  });
});

describe("FISCAL_CLOSING_DESCRIPTION_PREFIX", () => {
  it("exists and is a non-empty string", () => {
    expect(typeof FISCAL_CLOSING_DESCRIPTION_PREFIX).toBe("string");
    expect(FISCAL_CLOSING_DESCRIPTION_PREFIX.length).toBeGreaterThan(0);
  });
});

describe("ACCOUNT_CODES required keys", () => {
  it("contains all required account code keys", () => {
    const requiredKeys = [
      "CASH",
      "BANK",
      "CUSTOMERS",
      "INVENTORY",
      "INPUT_VAT",
      "SUPPLIERS",
      "SALES_TAX",
      "EQUITY",
      "RETAINED_EARNINGS",
      "REVENUE",
      "COGS",
    ];
    requiredKeys.forEach((key) => {
      expect(ACCOUNT_CODES).toHaveProperty(key);
    });
  });
});
