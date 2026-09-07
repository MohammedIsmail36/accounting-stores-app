import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase client before importing the module
const mockLimit = vi.fn();
const mockOrder = vi.fn(() => ({ limit: mockLimit }));
const mockIlike = vi.fn(() => ({ order: mockOrder }));
const mockSelect = vi.fn(() => ({ ilike: mockIlike }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...args: any[]) => (mockFrom as any)(...args) },
}));

import {
  generateEntityCode,
  computeEAN13CheckDigit,
  generateProductBarcode,
} from "./code-generation";

describe("generateEntityCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ ilike: mockIlike });
    mockIlike.mockReturnValue({ order: mockOrder });
    mockOrder.mockReturnValue({ limit: mockLimit });
  });

  it("returns prefix + 001 when no existing codes", async () => {
    mockLimit.mockResolvedValue({ data: [] });
    const code = await generateEntityCode("customers", "CUST-");
    expect(code).toBe("CUST-001");
  });

  it("increments from existing highest code", async () => {
    mockLimit.mockResolvedValue({ data: [{ code: "CUST-005" }] });
    const code = await generateEntityCode("customers", "CUST-");
    expect(code).toBe("CUST-006");
  });

  it("pads number to 3 digits", async () => {
    mockLimit.mockResolvedValue({ data: [{ code: "SUPP-009" }] });
    const code = await generateEntityCode("suppliers", "SUPP-");
    expect(code).toBe("SUPP-010");
  });

  it("handles null data as first code", async () => {
    mockLimit.mockResolvedValue({ data: null });
    const code = await generateEntityCode("customers", "CUST-");
    expect(code).toBe("CUST-001");
  });

  it("queries the correct table and prefix", async () => {
    mockLimit.mockResolvedValue({ data: [] });
    await generateEntityCode("suppliers", "SUPP-");
    expect(mockFrom).toHaveBeenCalledWith("suppliers");
    expect(mockIlike).toHaveBeenCalledWith("code", "SUPP-%");
  });

  it("handles large numbers correctly", async () => {
    mockLimit.mockResolvedValue({ data: [{ code: "CUST-999" }] });
    const code = await generateEntityCode("customers", "CUST-");
    expect(code).toBe("CUST-1000");
  });
});

describe("computeEAN13CheckDigit", () => {
  it("computes check digit for known EAN-13 (4006381333931)", () => {
    expect(computeEAN13CheckDigit("400638133393")).toBe(1);
  });

  it("computes check digit for 200000000001x", () => {
    // 200000000001 → weights: 2*1+0*3+0*1+0*3+0*1+0*3+0*1+0*3+0*1+0*3+0*1+1*3 = 2+3 = 5 → (10-5)%10 = 5
    expect(computeEAN13CheckDigit("200000000001")).toBe(5);
  });

  it("computes check digit resulting in 0", () => {
    // 000000000000 → sum = 0 → (10-0)%10 = 0
    expect(computeEAN13CheckDigit("000000000000")).toBe(0);
  });

  it("computes check digit for 590123412345x (known: 7)", () => {
    expect(computeEAN13CheckDigit("590123412345")).toBe(7);
  });
});

describe("generateProductBarcode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ ilike: mockIlike });
    mockIlike.mockReturnValue({ order: mockOrder });
    mockOrder.mockReturnValue({ limit: mockLimit });
  });

  it("returns first barcode 2000000000015 when no existing barcodes", async () => {
    mockLimit.mockResolvedValue({ data: [] });
    const barcode = await generateProductBarcode();
    // 200 + 000000001 = 200000000001 → check digit 5
    expect(barcode).toBe("2000000000015");
    expect(barcode).toHaveLength(13);
  });

  it("increments from existing highest barcode", async () => {
    mockLimit.mockResolvedValue({ data: [{ barcode: "2000000000015" }] });
    const barcode = await generateProductBarcode();
    // 200 + 000000002 = 200000000002 → check digit 2 (sum=2+6=... let's compute)
    // digits: 2 0 0 0 0 0 0 0 0 0 0 2
    // weights: 1 3 1 3 1 3 1 3 1 3 1 3
    // sum: 2+0+0+0+0+0+0+0+0+0+0+6 = 8 → (10-8)%10 = 2
    expect(barcode).toBe("2000000000022");
    expect(barcode).toHaveLength(13);
  });

  it("generates valid 13-digit barcode", async () => {
    mockLimit.mockResolvedValue({ data: [{ barcode: "2000000001004" }] });
    const barcode = await generateProductBarcode();
    expect(barcode).toHaveLength(13);
    expect(barcode.startsWith("200")).toBe(true);
  });

  it("handles null data as first barcode", async () => {
    mockLimit.mockResolvedValue({ data: null });
    const barcode = await generateProductBarcode();
    expect(barcode).toBe("2000000000015");
  });
});
