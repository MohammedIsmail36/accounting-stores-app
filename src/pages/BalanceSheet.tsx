import { notify } from "@/lib/notify";
import { StatCard } from "@/components/StatCard";
import { formatNumber } from "@/lib/format";
import React, { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettings } from "@/contexts/SettingsContext";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Landmark,
  Download,
  CalendarIcon,
  X,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Shield,
  Wallet,
  Scale,
  Info,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BALANCE_TOLERANCE } from "@/lib/constants";
import {
  applyCurrentPeriod,
  fetchLastClosingDate,
  filterLinesByDate,
  sumNetByAccount,
  toReportDate,
} from "@/lib/report-period";

interface Account {
  id: string;
  code: string;
  name: string;
  account_type: string;
}

interface BalanceRow {
  account: Account;
  balance: number;
}

/** طبيعة الحساب المتوقعة */
const naturalSide = (type: string) => (type === "asset" ? "مدين" : "دائن");
/** طبيعة الرصيد الفعلي: الرصيد مُطبَّع على الطبيعة، فالسالب يعني الجانب المعاكس */
const actualSide = (type: string, balance: number) =>
  balance >= 0
    ? naturalSide(type)
    : naturalSide(type) === "مدين"
      ? "دائن"
      : "مدين";
const isContra = (balance: number) => balance < 0;

export default function BalanceSheet() {
  const { settings, currency } = useSettings();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [asOfDate, setAsOfDate] = useState<Date | undefined>(undefined);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const [lastClosingDate, setLastClosingDate] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const [accountsRes, linesRes] = await Promise.all([
      supabase
        .from("accounts")
        .select("id, code, name, account_type")
        .eq("is_active", true)
        .eq("is_parent", false)
        .order("code"),
      supabase
        .from("journal_entry_lines")
        .select(
          "account_id, debit, credit, journal_entries!inner(entry_date, status, description)",
        )
        .in("journal_entries.status", ["posted", "approved"]),
    ]);
    if (accountsRes.error || linesRes.error) {
      notify.error("خطأ", "فشل في تحميل بيانات الميزانية");
    }
    if (accountsRes.data) setAccounts(accountsRes.data as Account[]);
    if (linesRes.data) setLines(linesRes.data);

    setLastClosingDate(
      await fetchLastClosingDate(settings?.enable_fiscal_year_closing),
    );

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const {
    assetRows,
    liabilityRows,
    equityRows,
    totalAssets,
    totalLiabilities,
    totalEquity,
    netIncome,
  } = useMemo(() => {
    const asOf = toReportDate(asOfDate);
    const filtered = filterLinesByDate(lines, undefined, asOf);

    const accountTypeOf = (id: string) =>
      accounts.find((a) => a.id === id)?.account_type;
    const totals = sumNetByAccount(filtered, accountTypeOf);

    // صافي الربح يُحسب من نشاط الفترة الحالية فقط (بعد آخر إقفال)
    const incomeFiltered =
      settings?.enable_fiscal_year_closing && lastClosingDate
        ? applyCurrentPeriod(filtered, { lastClosingDate })
        : filtered;

    const incomeTotals = new Map<string, number>();
    sumNetByAccount(incomeFiltered, accountTypeOf).forEach((v, id) => {
      const type = accountTypeOf(id);
      if (type === "revenue" || type === "expense") incomeTotals.set(id, v);
    });

    const assetRows: BalanceRow[] = [];
    const liabilityRows: BalanceRow[] = [];
    const equityRows: BalanceRow[] = [];
    let revenueTotal = 0;
    let expenseTotal = 0;

    accounts.forEach((acc) => {
      const balance = totals.get(acc.id);
      if (acc.account_type === "revenue") {
        revenueTotal += incomeTotals.get(acc.id) || 0;
        return;
      }
      if (acc.account_type === "expense") {
        expenseTotal += incomeTotals.get(acc.id) || 0;
        return;
      }
      if (balance === undefined || balance === 0) return;
      if (acc.account_type === "asset")
        assetRows.push({ account: acc, balance });
      else if (acc.account_type === "liability")
        liabilityRows.push({ account: acc, balance });
      else if (acc.account_type === "equity")
        equityRows.push({ account: acc, balance });
    });

    const netIncome = revenueTotal - expenseTotal;
    const totalAssets = assetRows.reduce((s, r) => s + r.balance, 0);
    const totalLiabilities = liabilityRows.reduce((s, r) => s + r.balance, 0);
    const totalEquity =
      equityRows.reduce((s, r) => s + r.balance, 0) + netIncome;

    return {
      assetRows,
      liabilityRows,
      equityRows,
      totalAssets,
      totalLiabilities,
      totalEquity,
      netIncome,
    };
  }, [
    accounts,
    lines,
    asOfDate,
    settings?.enable_fiscal_year_closing,
    lastClosingDate,
  ]);

  /** تصنيف الأصول والالتزامات إلى متداول / غير متداول حسب بادئة الكود */
  const {
    currentAssets,
    nonCurrentAssets,
    shortTermLiabilities,
    longTermLiabilities,
    totalCurrentAssets,
    totalNonCurrentAssets,
    totalShortTermLiabilities,
    totalLongTermLiabilities,
    contraRows,
  } = useMemo(() => {
    const currentAssets = assetRows.filter((r) =>
      r.account.code.startsWith("11"),
    );
    const nonCurrentAssets = assetRows.filter(
      (r) => !r.account.code.startsWith("11"),
    );
    const shortTermLiabilities = liabilityRows.filter((r) =>
      r.account.code.startsWith("21"),
    );
    const longTermLiabilities = liabilityRows.filter(
      (r) => !r.account.code.startsWith("21"),
    );
    const sum = (rows: BalanceRow[]) =>
      rows.reduce((s, r) => s + r.balance, 0);
    return {
      currentAssets,
      nonCurrentAssets,
      shortTermLiabilities,
      longTermLiabilities,
      totalCurrentAssets: sum(currentAssets),
      totalNonCurrentAssets: sum(nonCurrentAssets),
      totalShortTermLiabilities: sum(shortTermLiabilities),
      totalLongTermLiabilities: sum(longTermLiabilities),
      contraRows: [...assetRows, ...liabilityRows, ...equityRows].filter((r) =>
        isContra(r.balance),
      ),
    };
  }, [assetRows, liabilityRows, equityRows]);

  const isBalanced =
    Math.abs(totalAssets - (totalLiabilities + totalEquity)) <=
    BALANCE_TOLERANCE;

  /** تنسيق محاسبي: القيم السالبة (المعاكسة للطبيعة) بين قوسين */
  const formatNum = (val: number) => {
    const abs = formatNumber(Math.abs(val));
    return val < 0 ? `(${abs})` : abs;
  };
  const formatCurrency = (val: number) => `${formatNum(val)} ${currency}`;
  const asOfLabel = asOfDate
    ? format(asOfDate, "yyyy-MM-dd")
    : format(new Date(), "yyyy-MM-dd");

  const liquidityRatio =
    totalShortTermLiabilities !== 0
      ? totalCurrentAssets / totalShortTermLiabilities
      : null;
  const equityRatio = totalAssets !== 0 ? totalEquity / totalAssets : null;
  const formatRatio = (v: number | null, suffix = "") =>
    v === null ? "—" : `${v.toFixed(2)}${suffix}`;

  const handleExportPDF = async () => {
    const { exportReportPdf } = await import("@/lib/pdf-arabic");
    const allRows: (string | number)[][] = [];
    const rowEmphasis: (undefined | "subtotal" | "total")[] = [];
    const pushRow = (r: BalanceRow, section: string) => {
      allRows.push([
        r.account.code,
        r.account.name,
        section,
        actualSide(r.account.account_type, r.balance),
        formatNum(r.balance),
      ]);
      rowEmphasis.push(undefined);
    };
    const pushTotal = (
      label: string,
      value: number,
      level: "subtotal" | "total" = "subtotal",
    ) => {
      allRows.push(["", label, "", "", formatNum(value)]);
      rowEmphasis.push(level);
    };

    currentAssets.forEach((r) => pushRow(r, "أصول متداولة"));
    if (currentAssets.length)
      pushTotal("إجمالي الأصول المتداولة", totalCurrentAssets);
    nonCurrentAssets.forEach((r) => pushRow(r, "أصول غير متداولة"));
    if (nonCurrentAssets.length)
      pushTotal("إجمالي الأصول غير المتداولة", totalNonCurrentAssets);
    pushTotal("إجمالي الأصول", totalAssets, "total");

    shortTermLiabilities.forEach((r) => pushRow(r, "التزامات قصيرة الأجل"));
    if (shortTermLiabilities.length)
      pushTotal("إجمالي الالتزامات قصيرة الأجل", totalShortTermLiabilities);
    longTermLiabilities.forEach((r) => pushRow(r, "التزامات طويلة الأجل"));
    if (longTermLiabilities.length)
      pushTotal("إجمالي الالتزامات طويلة الأجل", totalLongTermLiabilities);
    pushTotal("إجمالي الالتزامات", totalLiabilities, "total");

    equityRows.forEach((r) => pushRow(r, "حقوق ملكية"));
    if (netIncome !== 0) {
      allRows.push([
        "",
        netIncome >= 0 ? "صافي ربح الفترة" : "صافي خسارة الفترة",
        "حقوق ملكية",
        netIncome >= 0 ? "دائن" : "مدين",
        formatNum(netIncome),
      ]);
      rowEmphasis.push(undefined);
    }
    pushTotal("إجمالي حقوق الملكية", totalEquity, "total");

    await exportReportPdf({
      title: "الميزانية العمومية",
      settings,
      headers: [
        "الكود",
        "الحساب",
        "القسم",
        "طبيعة الرصيد",
        `المبلغ (${currency})`,
      ],
      rows: allRows,
      rowEmphasis,
      summaryCards: [
        { label: "إجمالي الأصول", value: formatCurrency(totalAssets) },
        { label: "إجمالي الالتزامات", value: formatCurrency(totalLiabilities) },
        { label: "حقوق الملكية", value: formatCurrency(totalEquity) },
        {
          label: netIncome >= 0 ? "صافي الربح" : "صافي الخسارة",
          value: formatCurrency(netIncome),
        },
      ],
      reconciliationTitle: "مطابقة معادلة الميزانية",
      reconciliationRows: [
        {
          label: "إجمالي الأصول",
          value: formatCurrency(totalAssets),
          tone: "primary",
        },
        {
          label: "الالتزامات + حقوق الملكية",
          value: formatCurrency(totalLiabilities + totalEquity),
          tone: "primary",
        },
        {
          label: "الفرق",
          value: formatCurrency(totalAssets - (totalLiabilities + totalEquity)),
          tone: isBalanced ? "positive" : "negative",
        },
        {
          label: "حالة التوازن",
          value: isBalanced ? "متوازنة" : "غير متوازنة",
          tone: isBalanced ? "positive" : "negative",
        },
      ],
      footerNoteTitle: "قواعد عرض الأرصدة",
      footerNoteBlocks: [
        {
          label: "قواعد العرض",
          segments: [
            { text: "الأصول" },
            { text: "مدين", highlight: true },
            { text: "الالتزامات وحقوق الملكية" },
            { text: "دائن", highlight: true },
            { text: "الأرقام بين قوسين رصيد معاكس" },
            { text: `عددها: ${contraRows.length}`, highlight: true },
            { text: "كما في" },
            { text: asOfLabel, highlight: true },
          ],
        },
      ],
      filename: "Balance_Sheet",
    });
    notify.success("تم التصدير", "تم تصدير الميزانية العمومية بصيغة PDF");
    setExportMenuOpen(false);
  };

  const handleExportExcel = async () => {
    const { exportToExcel } = await import("@/lib/excel-export");
    const data: any[] = [];
    const row = (
      section: string,
      code: string,
      name: string,
      side: string,
      amount: number | string,
    ) => data.push({ القسم: section, الكود: code, الحساب: name, "طبيعة الرصيد": side, المبلغ: amount });
    const blank = () => row("", "", "", "", "");

    row("الأصول", "", "", "", "");
    currentAssets.forEach((r) =>
      row(
        "أصول متداولة",
        r.account.code,
        r.account.name,
        actualSide(r.account.account_type, r.balance),
        r.balance,
      ),
    );
    if (currentAssets.length)
      row("", "", "إجمالي الأصول المتداولة", "", totalCurrentAssets);
    nonCurrentAssets.forEach((r) =>
      row(
        "أصول غير متداولة",
        r.account.code,
        r.account.name,
        actualSide(r.account.account_type, r.balance),
        r.balance,
      ),
    );
    if (nonCurrentAssets.length)
      row("", "", "إجمالي الأصول غير المتداولة", "", totalNonCurrentAssets);
    row("", "", "إجمالي الأصول", "", totalAssets);
    blank();

    row("الالتزامات", "", "", "", "");
    shortTermLiabilities.forEach((r) =>
      row(
        "التزامات قصيرة الأجل",
        r.account.code,
        r.account.name,
        actualSide(r.account.account_type, r.balance),
        r.balance,
      ),
    );
    if (shortTermLiabilities.length)
      row("", "", "إجمالي الالتزامات قصيرة الأجل", "", totalShortTermLiabilities);
    longTermLiabilities.forEach((r) =>
      row(
        "التزامات طويلة الأجل",
        r.account.code,
        r.account.name,
        actualSide(r.account.account_type, r.balance),
        r.balance,
      ),
    );
    if (longTermLiabilities.length)
      row("", "", "إجمالي الالتزامات طويلة الأجل", "", totalLongTermLiabilities);
    row("", "", "إجمالي الالتزامات", "", totalLiabilities);
    blank();

    row("حقوق الملكية", "", "", "", "");
    equityRows.forEach((r) =>
      row(
        "حقوق ملكية",
        r.account.code,
        r.account.name,
        actualSide(r.account.account_type, r.balance),
        r.balance,
      ),
    );
    if (netIncome !== 0)
      row(
        "حقوق ملكية",
        "",
        netIncome >= 0 ? "صافي ربح الفترة" : "صافي خسارة الفترة",
        netIncome >= 0 ? "دائن" : "مدين",
        netIncome,
      );
    row("", "", "إجمالي حقوق الملكية", "", totalEquity);

    await exportToExcel(data, "Balance Sheet", "Balance_Sheet.xlsx");
    notify.success("تم التصدير", "تم تصدير الميزانية العمومية بصيغة Excel");
    setExportMenuOpen(false);
  };

  return (
    <TooltipProvider>
      <div className="space-y-8" dir="rtl">
        <PageHeader
          icon={Landmark}
          title="الميزانية العمومية"
          description="بيان المركز المالي للفترة المنتهية"
          actions={
            <>
              {/* Date filter */}
              <div className="flex items-center gap-2 bg-card p-1.5 rounded-xl border shadow-sm">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      className={cn(
                        "gap-2 text-sm",
                        !asOfDate && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="h-4 w-4" />
                      {asOfDate ? format(asOfDate, "yyyy-MM-dd") : "حتى اليوم"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={asOfDate}
                      onSelect={setAsOfDate}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                {asOfDate && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setAsOfDate(undefined)}
                    aria-label="مسح التاريخ"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {/* Export */}
              <div className="relative">
                <Button
                  className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg"
                  onClick={() => setExportMenuOpen(!exportMenuOpen)}
                >
                  <Download className="h-4 w-4" />
                  تصدير
                </Button>
                {exportMenuOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 bg-popover border rounded-xl shadow-lg p-1 min-w-[140px]">
                    <button
                      onClick={handleExportPDF}
                      className="w-full text-right px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors"
                    >
                      PDF تصدير
                    </button>
                    <button
                      onClick={handleExportExcel}
                      className="w-full text-right px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors"
                    >
                      Excel تصدير
                    </button>
                  </div>
                )}
              </div>
            </>
          }
        />

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <KpiCard
            icon={<Landmark className="h-5 w-5" />}
            iconBg="bg-blue-500/10 text-blue-600"
            label="إجمالي الأصول"
            value={formatCurrency(totalAssets)}
            hint="طبيعتها مدينة"
          />
          <KpiCard
            icon={<Wallet className="h-5 w-5" />}
            iconBg="bg-amber-500/10 text-amber-600"
            label="إجمالي الالتزامات"
            value={formatCurrency(totalLiabilities)}
            hint="طبيعتها دائنة"
          />
          <KpiCard
            icon={<Shield className="h-5 w-5" />}
            iconBg="bg-purple-500/10 text-purple-600"
            label="إجمالي حقوق الملكية"
            value={formatCurrency(totalEquity)}
            hint="طبيعتها دائنة"
          />
          <KpiCard
            icon={
              netIncome >= 0 ? (
                <TrendingUp className="h-5 w-5" />
              ) : (
                <TrendingDown className="h-5 w-5" />
              )
            }
            iconBg={
              netIncome >= 0
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-destructive/10 text-destructive"
            }
            label={netIncome >= 0 ? "صافي الربح" : "صافي الخسارة"}
            value={formatCurrency(Math.abs(netIncome))}
            hint={netIncome >= 0 ? "يزيد حقوق الملكية" : "يخفض حقوق الملكية"}
          />
        </div>

        {/* Balance Indicator Bar */}
        <div className="bg-card p-4 rounded-xl flex flex-wrap items-center justify-center gap-6 md:gap-8 border shadow-sm">
          <div className="text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-widest">
              إجمالي الأصول
            </p>
            <p className="text-xl font-bold text-foreground">
              {formatCurrency(totalAssets)}
            </p>
          </div>
          <div className="text-primary">
            <Scale className="h-9 w-9" />
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-widest">
              الالتزامات + حقوق الملكية
            </p>
            <p className="text-xl font-bold text-foreground">
              {formatCurrency(totalLiabilities + totalEquity)}
            </p>
          </div>
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold",
              isBalanced
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {isBalanced ? (
              <CheckCircle className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            {isBalanced
              ? "متوازنة"
              : `غير متوازنة · الفرق ${formatCurrency(totalAssets - (totalLiabilities + totalEquity))}`}
          </div>
          <div className="flex items-center gap-6 border-r pr-6">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">نسبة السيولة</p>
              <p className="text-base font-bold font-mono text-foreground">
                {formatRatio(liquidityRatio)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">نسبة الملكية</p>
              <p className="text-base font-bold font-mono text-foreground">
                {equityRatio === null
                  ? "—"
                  : `${(equityRatio * 100).toFixed(1)}%`}
              </p>
            </div>
          </div>
        </div>

        {/* Display legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5" />
            الأرقام بين قوسين ( ) تعني رصيداً معاكساً لطبيعة الحساب
          </span>
          <SideBadge side="مدين" />
          <SideBadge side="دائن" />
        </div>

        {!isBalanced && !loading && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              الميزانية العمومية غير متوازنة! الفرق:{" "}
              {formatCurrency(
                Math.abs(totalAssets - (totalLiabilities + totalEquity)),
              )}
            </AlertDescription>
          </Alert>
        )}

        {contraRows.length > 0 && !loading && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <span className="font-semibold">
                حسابات برصيد معاكس لطبيعتها ({contraRows.length}):
              </span>{" "}
              {contraRows
                .map(
                  (r) =>
                    `${r.account.code} ${r.account.name} → ${actualSide(
                      r.account.account_type,
                      r.balance,
                    )} ${formatNum(Math.abs(r.balance))}`,
                )
                .join(" • ")}
            </AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          /* Two Column Layout */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Column 1: Assets */}
            <div className="bg-card rounded-xl border overflow-hidden shadow-sm">
              <div className="bg-muted/50 px-6 py-4 border-b flex items-center justify-between">
                <h4 className="font-bold text-foreground">الأصول (Assets)</h4>
                <span className="text-xs text-muted-foreground">
                  الطبيعة: مدين
                </span>
              </div>
              <div className="p-6">
                {assetRows.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-8">
                    لا توجد حسابات أصول
                  </p>
                ) : (
                  <div className="space-y-6">
                    <SectionGroup
                      title="أصول متداولة"
                      rows={currentAssets}
                      total={totalCurrentAssets}
                      totalLabel="إجمالي الأصول المتداولة"
                      formatCurrency={formatCurrency}
                    />
                    <SectionGroup
                      title="أصول غير متداولة"
                      rows={nonCurrentAssets}
                      total={totalNonCurrentAssets}
                      totalLabel="إجمالي الأصول غير المتداولة"
                      formatCurrency={formatCurrency}
                    />
                  </div>
                )}
                <div className="mt-8 pt-4 border-t-2 flex justify-between items-center">
                  <span className="font-bold text-foreground">
                    إجمالي الأصول
                  </span>
                  <span className="text-lg font-black text-foreground font-mono">
                    {formatCurrency(totalAssets)}
                  </span>
                </div>
              </div>
            </div>

            {/* Column 2: Liabilities & Equity */}
            <div className="space-y-8">
              {/* Liabilities Card */}
              <div className="bg-card rounded-xl border overflow-hidden shadow-sm">
                <div className="bg-muted/50 px-6 py-4 border-b flex items-center justify-between">
                  <h4 className="font-bold text-foreground">
                    الالتزامات (Liabilities)
                  </h4>
                  <span className="text-xs text-muted-foreground">
                    الطبيعة: دائن
                  </span>
                </div>
                <div className="p-6">
                  {liabilityRows.length === 0 ? (
                    <p className="text-center text-muted-foreground text-sm py-4">
                      لا توجد التزامات
                    </p>
                  ) : (
                    <div className="space-y-6">
                      <SectionGroup
                        title="التزامات قصيرة الأجل"
                        rows={shortTermLiabilities}
                        total={totalShortTermLiabilities}
                        totalLabel="إجمالي الالتزامات قصيرة الأجل"
                        formatCurrency={formatCurrency}
                      />
                      <SectionGroup
                        title="التزامات طويلة الأجل"
                        rows={longTermLiabilities}
                        total={totalLongTermLiabilities}
                        totalLabel="إجمالي الالتزامات طويلة الأجل"
                        formatCurrency={formatCurrency}
                      />
                      <div className="pt-3 border-t flex justify-between items-center">
                        <span className="font-bold text-foreground text-sm">
                          إجمالي الالتزامات
                        </span>
                        <span className="font-black text-foreground font-mono">
                          {formatCurrency(totalLiabilities)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Equity Card */}
              <div className="bg-card rounded-xl border overflow-hidden shadow-sm">
                <div className="bg-muted/50 px-6 py-4 border-b flex items-center justify-between">
                  <h4 className="font-bold text-foreground">
                    حقوق الملكية (Equity)
                  </h4>
                  <span className="text-xs text-muted-foreground">
                    الطبيعة: دائن
                  </span>
                </div>
                <div className="p-6">
                  <div className="space-y-3">
                    {equityRows.map((row) => (
                      <AccountLine
                        key={row.account.id}
                        row={row}
                        formatCurrency={formatCurrency}
                      />
                    ))}
                    {netIncome !== 0 && (
                      <div className="flex justify-between items-center text-sm gap-3">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          {netIncome >= 0
                            ? "صافي ربح الفترة"
                            : "صافي خسارة الفترة"}
                          <SideBadge side={netIncome >= 0 ? "دائن" : "مدين"} />
                        </span>
                        <span
                          className={cn(
                            "font-medium font-mono",
                            netIncome >= 0
                              ? "text-emerald-600"
                              : "text-destructive",
                          )}
                        >
                          {formatCurrency(netIncome)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-6 pt-3 border-t flex justify-between items-center">
                    <span className="font-bold text-foreground text-sm">
                      إجمالي حقوق الملكية
                    </span>
                    <span className="font-black text-foreground font-mono">
                      {formatCurrency(totalEquity)}
                    </span>
                  </div>
                  <div className="mt-6 pt-4 border-t-2 flex justify-between items-center">
                    <span className="font-bold text-foreground">
                      إجمالي الالتزامات وحقوق الملكية
                    </span>
                    <span className="text-lg font-black text-foreground font-mono">
                      {formatCurrency(totalLiabilities + totalEquity)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function SideBadge({ side }: { side: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold border",
        side === "مدين"
          ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
          : "bg-amber-500/10 text-amber-600 border-amber-500/20",
      )}
    >
      {side}
    </span>
  );
}

function AccountLine({
  row,
  formatCurrency,
}: {
  row: BalanceRow;
  formatCurrency: (v: number) => string;
}) {
  const side = actualSide(row.account.account_type, row.balance);
  const contra = isContra(row.balance);
  return (
    <div className="flex justify-between items-center text-sm gap-3">
      <span className="flex items-center gap-2 min-w-0">
        <span className="text-muted-foreground truncate">
          {row.account.name}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <SideBadge side={side} />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            الطبيعة المتوقعة: {naturalSide(row.account.account_type)} — الرصيد
            الفعلي: {side}
            {contra ? " (رصيد معاكس يستوجب المراجعة)" : ""}
          </TooltipContent>
        </Tooltip>
      </span>
      <span
        className={cn(
          "font-medium font-mono shrink-0",
          contra ? "text-destructive" : "text-foreground",
        )}
      >
        {formatCurrency(row.balance)}
      </span>
    </div>
  );
}

function SectionGroup({
  title,
  rows,
  total,
  totalLabel,
  formatCurrency,
}: {
  title: string;
  rows: BalanceRow[];
  total: number;
  totalLabel: string;
  formatCurrency: (v: number) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
        {title}
      </p>
      <div className="space-y-3">
        {rows.map((row) => (
          <AccountLine
            key={row.account.id}
            row={row}
            formatCurrency={formatCurrency}
          />
        ))}
      </div>
      <div className="mt-3 pt-2 border-t flex justify-between items-center text-sm">
        <span className="font-semibold text-foreground">{totalLabel}</span>
        <span className="font-bold text-foreground font-mono">
          {formatCurrency(total)}
        </span>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  iconBg,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <StatCard size="lg" icon={icon} iconBg={iconBg} label={label} value={value} sub={hint} />
  );
}
