import type { InvoiceCoverage } from "./collections";
import { round2 } from "@/lib/utils";

type NumericValue = number | string | null | undefined;

export interface SalesInsightInvoice {
  id: string;
  status: string | null;
  total: NumericValue;
  due_date?: string | null;
  discount?: NumericValue;
  tax?: NumericValue;
}

const EMPTY_COVERAGE: InvoiceCoverage = {
  cashCollected: 0,
  returnSettled: 0,
  totalCovered: 0,
};

const toFiniteNumber = (value: NumericValue): number => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

export function getInvoiceCoverage(
  invoiceId: string,
  coverageByInvoice: Record<string, InvoiceCoverage>,
): InvoiceCoverage {
  return coverageByInvoice[invoiceId] ?? EMPTY_COVERAGE;
}

export function isSalesInvoiceOverdue(
  invoice: SalesInsightInvoice,
  coverageByInvoice: Record<string, InvoiceCoverage>,
  today: string,
): boolean {
  const remaining =
    toFiniteNumber(invoice.total) -
    getInvoiceCoverage(invoice.id, coverageByInvoice).totalCovered;

  return Boolean(
    invoice.status === "posted" &&
      invoice.due_date &&
      invoice.due_date < today &&
      remaining > 0,
  );
}

export function buildOverdueSalesInfo(
  invoices: SalesInsightInvoice[],
  coverageByInvoice: Record<string, InvoiceCoverage>,
  today: string,
) {
  return invoices.reduce(
    (result, invoice) => {
      if (!isSalesInvoiceOverdue(invoice, coverageByInvoice, today)) {
        return result;
      }

      result.count += 1;
      result.total +=
        toFiniteNumber(invoice.total) -
        getInvoiceCoverage(invoice.id, coverageByInvoice).totalCovered;
      return result;
    },
    { count: 0, total: 0 },
  );
}

export function buildSalesDiscountTaxInfo(
  invoices: SalesInsightInvoice[],
) {
  return invoices.reduce(
    (result, invoice) => {
      if (invoice.status !== "posted") return result;
      result.discount += toFiniteNumber(invoice.discount);
      result.tax += toFiniteNumber(invoice.tax);
      return result;
    },
    { discount: 0, tax: 0 },
  );
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
  key: string;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseCalendarDate(date: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > getDaysInMonth(year, month)
  ) {
    return null;
  }
  return { year, month, day, key: date };
}

export function buildSalesTargetInfo(
  monthlyTarget: NumericValue,
  dateFrom: string,
  dateTo: string,
  netSales: number,
  asOfDate = dateTo,
) {
  const target = toFiniteNumber(monthlyTarget);
  if (target <= 0) return null;

  const from = parseCalendarDate(dateFrom);
  const to = parseCalendarDate(dateTo);
  const asOf = parseCalendarDate(asOfDate);
  if (!from || !to || from.key > to.key) return null;

  const effectiveTo = asOf && asOf.key < to.key ? asOf : to;
  if (effectiveTo.key < from.key) return null;

  const startMonthIndex = from.year * 12 + from.month - 1;
  const endMonthIndex = effectiveTo.year * 12 + effectiveTo.month - 1;
  const monthsInRange = endMonthIndex - startMonthIndex + 1;
  let targetMonthFraction = 0;
  let daysInRange = 0;

  for (let monthIndex = startMonthIndex; monthIndex <= endMonthIndex; monthIndex += 1) {
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const daysInMonth = getDaysInMonth(year, month);
    const startDay = monthIndex === startMonthIndex ? from.day : 1;
    const endDay = monthIndex === endMonthIndex ? effectiveTo.day : daysInMonth;
    const includedDays = endDay - startDay + 1;
    daysInRange += includedDays;
    targetMonthFraction += includedDays / daysInMonth;
  }

  const scaledTarget = round2(target * targetMonthFraction);

  return {
    scaledTarget,
    pct: round2((toFiniteNumber(netSales) / scaledTarget) * 100),
    monthsInRange,
    daysInRange,
    isCappedAtAsOf: effectiveTo.key < to.key,
  };
}
