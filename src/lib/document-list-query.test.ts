import { describe, it, expect } from "vitest";
import {
  applyDocumentFilters,
  applyDocumentScopeFilters,
  applyDocumentSearchFilter,
  hasActiveDocumentFilters,
  computePageCount,
  computeRange,
  EMPTY_DOCUMENT_FILTERS,
  type DocumentListFilters,
} from "./document-list-query";

/** Records every chained call so we can assert the produced query. */
function fakeQuery() {
  const calls: string[] = [];
  const q: any = {
    calls,
    eq: (c: string, v: unknown) => (calls.push(`eq:${c}=${v}`), q),
    gte: (c: string, v: unknown) => (calls.push(`gte:${c}=${v}`), q),
    lte: (c: string, v: unknown) => (calls.push(`lte:${c}=${v}`), q),
    or: (f: string) => (calls.push(`or:${f}`), q),
    ilike: (c: string, p: string) => (calls.push(`ilike:${c}=${p}`), q),
  };
  return q;
}

const invoiceFields = {
  dateField: "invoice_date",
  numberField: "invoice_number",
  searchTextColumn: "customers.name",
};

const returnFields = {
  dateField: "return_date",
  numberField: "return_number",
};

const filters = (over: Partial<DocumentListFilters> = {}): DocumentListFilters => ({
  ...EMPTY_DOCUMENT_FILTERS,
  ...over,
});

describe("applyDocumentScopeFilters", () => {
  it("applies nothing for default filters", () => {
    const q = fakeQuery();
    applyDocumentScopeFilters(q, filters(), invoiceFields);
    expect(q.calls).toEqual([]);
  });

  it("skips the status filter when it is 'all'", () => {
    const q = fakeQuery();
    applyDocumentScopeFilters(q, filters({ status: "all" }), invoiceFields);
    expect(q.calls).toEqual([]);
  });

  it("applies status and both date bounds in order", () => {
    const q = fakeQuery();
    applyDocumentScopeFilters(
      q,
      filters({ status: "posted", dateFrom: "2026-01-01", dateTo: "2026-01-31" }),
      invoiceFields,
    );
    expect(q.calls).toEqual([
      "eq:status=posted",
      "gte:invoice_date=2026-01-01",
      "lte:invoice_date=2026-01-31",
    ]);
  });

  it("uses the configured date field per document type", () => {
    const q = fakeQuery();
    applyDocumentScopeFilters(q, filters({ dateFrom: "2026-02-02" }), returnFields);
    expect(q.calls).toEqual(["gte:return_date=2026-02-02"]);
  });
});

describe("applyDocumentSearchFilter", () => {
  it("ignores empty and whitespace-only search", () => {
    const q = fakeQuery();
    applyDocumentSearchFilter(q, filters({ search: "   " }), invoiceFields);
    expect(q.calls).toEqual([]);
  });

  it("matches draft or posted number for numeric search", () => {
    const q = fakeQuery();
    applyDocumentSearchFilter(q, filters({ search: " 103 " }), invoiceFields);
    expect(q.calls).toEqual(["or:invoice_number.eq.103,posted_number.eq.103"]);
  });

  it("falls back to related-name ilike for text search", () => {
    const q = fakeQuery();
    applyDocumentSearchFilter(q, filters({ search: "محمد" }), invoiceFields);
    expect(q.calls).toEqual(["ilike:customers.name=%محمد%"]);
  });

  it("ignores text search when no text column is configured", () => {
    const q = fakeQuery();
    applyDocumentSearchFilter(q, filters({ search: "محمد" }), returnFields);
    expect(q.calls).toEqual([]);
  });

  it("still treats numeric search as a number when no text column exists", () => {
    const q = fakeQuery();
    applyDocumentSearchFilter(q, filters({ search: "7" }), returnFields);
    expect(q.calls).toEqual(["or:return_number.eq.7,posted_number.eq.7"]);
  });
});

describe("applyDocumentFilters", () => {
  it("applies scope filters before the search filter", () => {
    const q = fakeQuery();
    applyDocumentFilters(
      q,
      filters({ status: "draft", dateFrom: "2026-01-01", search: "5" }),
      invoiceFields,
    );
    expect(q.calls).toEqual([
      "eq:status=draft",
      "gte:invoice_date=2026-01-01",
      "or:invoice_number.eq.5,posted_number.eq.5",
    ]);
  });
});

describe("hasActiveDocumentFilters", () => {
  it("is false for defaults", () => {
    expect(hasActiveDocumentFilters(filters())).toBe(false);
  });

  it("is false for whitespace-only search", () => {
    expect(hasActiveDocumentFilters(filters({ search: "  " }))).toBe(false);
  });

  it.each([
    ["status", { status: "posted" }],
    ["dateFrom", { dateFrom: "2026-01-01" }],
    ["dateTo", { dateTo: "2026-01-31" }],
    ["search", { search: "abc" }],
  ])("is true when %s is set", (_label, over) => {
    expect(hasActiveDocumentFilters(filters(over as Partial<DocumentListFilters>))).toBe(true);
  });
});

describe("pagination helpers", () => {
  it("never returns a page count below 1", () => {
    expect(computePageCount(0, 20)).toBe(1);
  });

  it("rounds partial pages up", () => {
    expect(computePageCount(41, 20)).toBe(3);
  });

  it("guards against a zero page size", () => {
    expect(computePageCount(100, 0)).toBe(1);
  });

  it("computes an inclusive range", () => {
    expect(computeRange(0, 20)).toEqual({ from: 0, to: 19 });
    expect(computeRange(2, 20)).toEqual({ from: 40, to: 59 });
  });
});
