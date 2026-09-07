import {
  format,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  startOfYear,
  subMonths,
  subDays,
  subYears,
} from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { FISCAL_CLOSING_DESCRIPTION_PREFIX } from "@/lib/constants";

/**
 * طبقة موحّدة لمنطق فترات التقارير المحاسبية:
 * - جلب تاريخ آخر إقفال سنوي (الفترة الحالية)
 * - فلترة سطور القيود بالتاريخ
 * - استثناء نشاط ما قبل الإقفال وقيود الإقفال نفسها
 * - تجميع الأرصدة حسب الحساب بقواعد الإشارة الموحّدة
 *
 * الهدف: ألا تختلف الأرقام بين ميزان المراجعة وقائمة الدخل والميزانية.
 */

/** الحالات المعتمدة للقيود في كل التقارير */
export const REPORT_ENTRY_STATUSES = ["posted", "approved"] as const;

/** أنواع حسابات النتيجة (إيرادات/مصروفات) */
export const RESULT_ACCOUNT_TYPES = ["revenue", "expense", "expenses"] as const;

export interface GLLineEntry {
  entry_date?: string | null;
  description?: string | null;
}

export interface GLLine {
  account_id: string;
  debit: number | string | null;
  credit: number | string | null;
  journal_entries?: GLLineEntry | null;
}

/** تحويل تاريخ اختياري إلى نص yyyy-MM-dd (أو "" إن لم يوجد) */
export function toReportDate(d?: Date | null): string {
  return d ? format(d, "yyyy-MM-dd") : "";
}

/** مفتاح تجميع شهري موحّد (yyyy-MM) */
export function monthKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return format(date, "yyyy-MM");
}

export function isResultAccountType(type?: string | null): boolean {
  return RESULT_ACCOUNT_TYPES.includes((type || "") as never);
}

/** هل وصف القيد يعني أنه قيد إقفال سنوي؟ */
export function isClosingDescription(desc?: string | null): boolean {
  return Boolean(desc && desc.includes(FISCAL_CLOSING_DESCRIPTION_PREFIX));
}

function lineDate(l: GLLine): string | null {
  return l.journal_entries?.entry_date ?? null;
}

function lineDesc(l: GLLine): string {
  return l.journal_entries?.description ?? "";
}

/**
 * جلب تاريخ آخر قيد إقفال مرحّل. يعيد null إذا كان الإقفال معطّلاً
 * في الإعدادات أو لا توجد قيود إقفال.
 */
export async function fetchLastClosingDate(
  closingEnabled: boolean | null | undefined,
): Promise<string | null> {
  if (!closingEnabled) return null;
  const { data } = await supabase
    .from("journal_entries")
    .select("entry_date")
    .like("description", `%${FISCAL_CLOSING_DESCRIPTION_PREFIX}%`)
    .in("status", [...REPORT_ENTRY_STATUSES])
    .order("entry_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.entry_date ?? null;
}

/** فلترة سطور القيود بنطاق تاريخ نصي (شامل الطرفين) */
export function filterLinesByDate<T extends GLLine>(
  lines: T[],
  dateFrom?: string,
  dateTo?: string,
): T[] {
  return lines.filter((l) => {
    const d = lineDate(l);
    if (!d) return false;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });
}

/** استثناء قيود الإقفال نفسها من أي تقرير */
export function excludeClosingEntries<T extends GLLine>(lines: T[]): T[] {
  return lines.filter((l) => !isClosingDescription(lineDesc(l)));
}

/**
 * تطبيق «الفترة الحالية»: عند تمكين الإقفال ووجود تاريخ إقفال ولم يحدّد
 * المستخدم تاريخ بداية يدوي، تُستبعد قيود الإقفال وكل ما قبله (أو يساويه).
 */
export function applyCurrentPeriod<T extends GLLine>(
  lines: T[],
  opts: { lastClosingDate: string | null; manualDateFrom?: string },
): T[] {
  const { lastClosingDate, manualDateFrom } = opts;
  const withoutClosing = excludeClosingEntries(lines);
  if (!lastClosingDate || manualDateFrom) return withoutClosing;
  return withoutClosing.filter((l) => {
    const d = lineDate(l);
    return Boolean(d && d > lastClosingDate);
  });
}

/** هل نعرض شارة «الفترة الحالية» في رأس التقرير؟ */
export function isCurrentPeriodActive(opts: {
  closingEnabled?: boolean | null;
  lastClosingDate: string | null;
  manualDateFrom?: string;
}): boolean {
  return Boolean(
    opts.closingEnabled && opts.lastClosingDate && !opts.manualDateFrom,
  );
}

const num = (v: unknown) => Number(v) || 0;

/**
 * تجميع صافي رصيد كل حساب بقاعدة الإشارة الطبيعية:
 * أصول/مصروفات = مدين − دائن، والباقي = دائن − مدين.
 */
export function sumNetByAccount(
  lines: GLLine[],
  accountTypeOf: (accountId: string) => string | undefined,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const l of lines) {
    const type = accountTypeOf(l.account_id);
    if (!type) continue;
    const debitNatural =
      type === "asset" || type === "expense" || type === "expenses";
    const delta = debitNatural
      ? num(l.debit) - num(l.credit)
      : num(l.credit) - num(l.debit);
    totals.set(l.account_id, (totals.get(l.account_id) || 0) + delta);
  }
  return totals;
}

/** تجميع إجمالي المدين والدائن لكل حساب (لميزان المراجعة) */
export function sumDebitCreditByAccount(
  lines: GLLine[],
): Map<string, { totalDebit: number; totalCredit: number }> {
  const totals = new Map<string, { totalDebit: number; totalCredit: number }>();
  for (const l of lines) {
    const existing = totals.get(l.account_id) || {
      totalDebit: 0,
      totalCredit: 0,
    };
    existing.totalDebit += num(l.debit);
    existing.totalCredit += num(l.credit);
    totals.set(l.account_id, existing);
  }
  return totals;
}

// ─── فلاتر الفترة السريعة (موحّدة لكل التقارير التشغيلية) ───────────────────

export interface QuickDateRange {
  label: string;
  from: string;
  to: string;
}

/** نطاقات سريعة موحّدة: هذا الشهر / السابق / الربع / بداية السنة / 12 شهرًا */
export function getQuickDateRanges(now: Date = new Date()): QuickDateRange[] {
  return [
    {
      label: "هذا الشهر",
      from: format(startOfMonth(now), "yyyy-MM-dd"),
      to: format(endOfMonth(now), "yyyy-MM-dd"),
    },
    {
      label: "الشهر السابق",
      from: format(startOfMonth(subMonths(now, 1)), "yyyy-MM-dd"),
      to: format(endOfMonth(subMonths(now, 1)), "yyyy-MM-dd"),
    },
    {
      label: "هذا الربع",
      from: format(startOfQuarter(now), "yyyy-MM-dd"),
      to: format(endOfMonth(now), "yyyy-MM-dd"),
    },
    {
      label: "من بداية السنة",
      from: format(startOfYear(now), "yyyy-MM-dd"),
      to: format(endOfMonth(now), "yyyy-MM-dd"),
    },
    {
      label: "آخر 12 شهر",
      from: format(startOfMonth(subMonths(now, 11)), "yyyy-MM-dd"),
      to: format(endOfMonth(now), "yyyy-MM-dd"),
    },
  ];
}

/** الفترة السابقة بنفس طول الفترة الحالية (للمقارنة في المؤشرات) */
export function getPreviousPeriod(
  dateFrom: string,
  dateTo: string,
): { from: string; to: string } {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  const rangeDays =
    Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return {
    from: format(subDays(from, rangeDays), "yyyy-MM-dd"),
    to: format(subDays(from, 1), "yyyy-MM-dd"),
  };
}

/** نفس حدود الفترة في السنة السابقة للمقارنة السنوية. */
export function getSamePeriodPreviousYear(
  dateFrom: string,
  dateTo: string,
): { from: string; to: string } {
  return {
    from: format(subYears(new Date(dateFrom), 1), "yyyy-MM-dd"),
    to: format(subYears(new Date(dateTo), 1), "yyyy-MM-dd"),
  };
}
