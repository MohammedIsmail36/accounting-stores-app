import { describe, expect, it } from "vitest";
import {
  applyCurrentPeriod,
  excludeClosingEntries,
  filterLinesByDate,
  isClosingDescription,
  isCurrentPeriodActive,
  isResultAccountType,
  monthKey,
  sumDebitCreditByAccount,
  sumNetByAccount,
  toReportDate,
  getQuickDateRanges,
  getPreviousPeriod,
  getSamePeriodPreviousYear,
  type GLLine,
} from "./report-period";
import { FISCAL_CLOSING_DESCRIPTION_PREFIX } from "./constants";

const line = (
  account_id: string,
  debit: number,
  credit: number,
  entry_date: string,
  description = "",
): GLLine => ({
  account_id,
  debit,
  credit,
  journal_entries: { entry_date, description },
});

describe("report-period helpers", () => {
  it("toReportDate formats or returns empty", () => {
    expect(toReportDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toReportDate(undefined)).toBe("");
  });

  it("monthKey buckets by year-month", () => {
    expect(monthKey("2026-03-17")).toBe("2026-03");
    expect(monthKey(new Date(2026, 11, 31))).toBe("2026-12");
  });

  it("detects result account types", () => {
    expect(isResultAccountType("revenue")).toBe(true);
    expect(isResultAccountType("expenses")).toBe(true);
    expect(isResultAccountType("asset")).toBe(false);
    expect(isResultAccountType(null)).toBe(false);
  });

  it("detects closing descriptions", () => {
    expect(isClosingDescription(`${FISCAL_CLOSING_DESCRIPTION_PREFIX} 2025`)).toBe(
      true,
    );
    expect(isClosingDescription("فاتورة بيع")).toBe(false);
    expect(isClosingDescription(undefined)).toBe(false);
  });
});

describe("filterLinesByDate", () => {
  const lines = [
    line("a", 10, 0, "2026-01-01"),
    line("a", 0, 5, "2026-02-15"),
    line("b", 3, 0, "2026-03-30"),
  ];

  it("returns all when no range", () => {
    expect(filterLinesByDate(lines)).toHaveLength(3);
  });

  it("is inclusive on both bounds", () => {
    expect(filterLinesByDate(lines, "2026-01-01", "2026-02-15")).toHaveLength(2);
  });

  it("drops lines without a date", () => {
    const bad: GLLine[] = [{ account_id: "x", debit: 1, credit: 0 }];
    expect(filterLinesByDate(bad, "2026-01-01")).toHaveLength(0);
  });
});

describe("current period (fiscal closing)", () => {
  const closingDesc = `${FISCAL_CLOSING_DESCRIPTION_PREFIX} 2025`;
  const lines = [
    line("rev", 0, 100, "2025-06-01"),
    line("rev", 0, 50, "2025-12-31", closingDesc),
    line("rev", 0, 70, "2026-01-10"),
  ];

  it("excludes closing entries themselves", () => {
    const out = excludeClosingEntries(lines);
    expect(out).toHaveLength(2);
    expect(out.every((l) => l.journal_entries?.description !== closingDesc)).toBe(
      true,
    );
  });

  it("keeps only activity after the closing date", () => {
    const out = applyCurrentPeriod(lines, { lastClosingDate: "2025-12-31" });
    expect(out).toHaveLength(1);
    expect(out[0].journal_entries?.entry_date).toBe("2026-01-10");
  });

  it("honours a manual date range over the closing filter", () => {
    const out = applyCurrentPeriod(lines, {
      lastClosingDate: "2025-12-31",
      manualDateFrom: "2025-01-01",
    });
    expect(out).toHaveLength(2);
  });

  it("no closing date means only closing entries removed", () => {
    expect(applyCurrentPeriod(lines, { lastClosingDate: null })).toHaveLength(2);
  });

  it("badge is active only when enabled, dated and unfiltered", () => {
    expect(
      isCurrentPeriodActive({
        closingEnabled: true,
        lastClosingDate: "2025-12-31",
      }),
    ).toBe(true);
    expect(
      isCurrentPeriodActive({
        closingEnabled: true,
        lastClosingDate: "2025-12-31",
        manualDateFrom: "2025-01-01",
      }),
    ).toBe(false);
    expect(
      isCurrentPeriodActive({ closingEnabled: false, lastClosingDate: "x" }),
    ).toBe(false);
    expect(
      isCurrentPeriodActive({ closingEnabled: true, lastClosingDate: null }),
    ).toBe(false);
  });
});

describe("aggregation", () => {
  const types: Record<string, string> = {
    cash: "asset",
    sales: "revenue",
    rent: "expense",
    ap: "liability",
  };
  const typeOf = (id: string) => types[id];

  it("applies natural sign per account type", () => {
    const totals = sumNetByAccount(
      [
        line("cash", 100, 20, "2026-01-01"),
        line("sales", 0, 80, "2026-01-01"),
        line("rent", 30, 0, "2026-01-01"),
        line("ap", 10, 60, "2026-01-01"),
      ],
      typeOf,
    );
    expect(totals.get("cash")).toBe(80);
    expect(totals.get("sales")).toBe(80);
    expect(totals.get("rent")).toBe(30);
    expect(totals.get("ap")).toBe(50);
  });

  it("skips lines of unknown accounts", () => {
    const totals = sumNetByAccount([line("ghost", 5, 0, "2026-01-01")], typeOf);
    expect(totals.size).toBe(0);
  });

  it("sums debit/credit per account for the trial balance", () => {
    const totals = sumDebitCreditByAccount([
      line("cash", 100, 0, "2026-01-01"),
      line("cash", 0, 40, "2026-01-02"),
    ]);
    expect(totals.get("cash")).toEqual({ totalDebit: 100, totalCredit: 40 });
  });

  it("treats null amounts as zero", () => {
    const totals = sumDebitCreditByAccount([
      { account_id: "cash", debit: null, credit: "25" },
    ]);
    expect(totals.get("cash")).toEqual({ totalDebit: 0, totalCredit: 25 });
  });
});

describe("getQuickDateRanges", () => {
  const now = new Date(2026, 7, 26); // 2026-08-26

  it("يعيد خمسة نطاقات موحّدة بنفس التسميات", () => {
    const r = getQuickDateRanges(now);
    expect(r.map((x) => x.label)).toEqual([
      "هذا الشهر",
      "الشهر السابق",
      "هذا الربع",
      "من بداية السنة",
      "آخر 12 شهر",
    ]);
  });

  it("يحسب حدود الشهر الحالي والشهر السابق بدقة", () => {
    const r = getQuickDateRanges(now);
    expect(r[0]).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
    expect(r[1]).toMatchObject({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("يحسب الربع وبداية السنة وآخر 12 شهرًا", () => {
    const r = getQuickDateRanges(now);
    expect(r[2].from).toBe("2026-07-01");
    expect(r[3].from).toBe("2026-01-01");
    expect(r[4].from).toBe("2025-09-01");
  });
});

describe("getPreviousPeriod", () => {
  it("يعيد فترة بنفس الطول تنتهي قبل بداية الفترة الحالية", () => {
    expect(getPreviousPeriod("2026-08-01", "2026-08-31")).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("يتعامل مع فترة يوم واحد", () => {
    expect(getPreviousPeriod("2026-08-10", "2026-08-10")).toEqual({
      from: "2026-08-09",
      to: "2026-08-09",
    });
  });
});

describe("getSamePeriodPreviousYear", () => {
  it("يعيد نفس حدود الفترة في السنة السابقة", () => {
    expect(getSamePeriodPreviousYear("2026-07-01", "2026-09-30")).toEqual({
      from: "2025-07-01",
      to: "2025-09-30",
    });
  });

  it("يضبط 29 فبراير إلى آخر يوم صالح في السنة السابقة", () => {
    expect(getSamePeriodPreviousYear("2024-02-29", "2024-02-29")).toEqual({
      from: "2023-02-28",
      to: "2023-02-28",
    });
  });
});
