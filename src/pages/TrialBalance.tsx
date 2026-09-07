import { notify } from "@/lib/notify";
import { StatCard } from "@/components/StatCard";
import { formatNumber as formatNum } from "@/lib/format";
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Scale,
  Download,
  CalendarIcon,
  X,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  BookOpen,
  Layers,
  Info,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BALANCE_TOLERANCE } from "@/lib/constants";
import {
  excludeClosingEntries,
  fetchLastClosingDate,
  filterLinesByDate,
  isResultAccountType,
  sumDebitCreditByAccount,
  toReportDate,
} from "@/lib/report-period";

interface Account {
  id: string;
  code: string;
  name: string;
  account_type: string;
}

interface TrialBalanceRow {
  account: Account;
  totalDebit: number;
  totalCredit: number;
  balanceDebit: number;
  balanceCredit: number;
}

export default function TrialBalance() {
  const { settings, currency, formatCurrency } = useSettings();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [lastClosingDate, setLastClosingDate] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);

    // Last closing date (used to exclude pre-closing revenue/expense activity)
    const closingDate = await fetchLastClosingDate(
      settings?.enable_fiscal_year_closing,
    );
    setLastClosingDate(closingDate);

    // Fetch accounts (light) in parallel with lines
    const accountsPromise = supabase
      .from("accounts")
      .select("id, code, name, account_type")
      .eq("is_active", true)
      .eq("is_parent", false)
      .order("code");

    // When no fiscal-year closing logic is needed AND no manual filters,
    // use the fast aggregated RPC. Otherwise we need raw lines for the
    // per-account closing filter.
    const needsRawLines =
      !!closingDate || !!dateFrom || !!dateTo;

    if (!needsRawLines) {
      const [accountsRes, balRes] = await Promise.all([
        accountsPromise,
        (supabase.rpc as any)("get_account_balances", {
          p_only_with_activity: true,
        }),
      ]);
      if (accountsRes.data) setAccounts(accountsRes.data as Account[]);
      // Adapt aggregated rows -> minimal "lines" shape consumed by the memo:
      // one synthetic line per account with the precomputed totals.
      const rows = (balRes.data?.rows ?? []) as Array<{
        id: string;
        debit: number;
        credit: number;
      }>;
      const synthetic = rows.map((r) => ({
        account_id: r.id,
        debit: Number(r.debit),
        credit: Number(r.credit),
        journal_entries: { entry_date: "9999-12-31", description: "" },
      }));
      setLines(synthetic);
      if (accountsRes.error || balRes.error) {
        notify.error("خطأ", "فشل في جلب البيانات");
      }
      setLoading(false);
      return;
    }

    // Fallback: raw lines (closing-aware path)
    const [accountsRes, linesRes] = await Promise.all([
      accountsPromise,
      supabase
        .from("journal_entry_lines")
        .select(
          "account_id, debit, credit, journal_entry_id, journal_entries!inner(entry_date, status, description)",
        )
        .in("journal_entries.status", ["posted", "approved"]),
    ]);

    if (accountsRes.data) setAccounts(accountsRes.data as Account[]);
    if (linesRes.data) setLines(linesRes.data);
    if (accountsRes.error || linesRes.error) {
      notify.error("خطأ", "فشل في جلب البيانات");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.enable_fiscal_year_closing, dateFrom, dateTo]);

  const trialBalanceData = useMemo(() => {
    const from = toReportDate(dateFrom);
    const to = toReportDate(dateTo);
    const filteredLines = excludeClosingEntries(
      filterLinesByDate(lines, from, to),
    );

    const accountTypeMap = new Map<string, string>();
    accounts.forEach((acc) => accountTypeMap.set(acc.id, acc.account_type));

    // حسابات النتيجة: تُستبعد الحركة قبل آخر إقفال إن لم يحدّد المستخدم بداية
    const periodLines = filteredLines.filter((l: any) => {
      if (!isResultAccountType(accountTypeMap.get(l.account_id))) return true;
      if (!lastClosingDate || from) return true;
      return (l.journal_entries as any)?.entry_date > lastClosingDate;
    });

    const accountTotals = sumDebitCreditByAccount(periodLines);

    const rows: TrialBalanceRow[] = [];
    accounts.forEach((acc) => {
      const totals = accountTotals.get(acc.id);
      if (!totals) return;
      const net = totals.totalDebit - totals.totalCredit;
      rows.push({
        account: acc,
        totalDebit: totals.totalDebit,
        totalCredit: totals.totalCredit,
        balanceDebit: net > 0 ? net : 0,
        balanceCredit: net < 0 ? Math.abs(net) : 0,
      });
    });

    return rows;
  }, [accounts, lines, dateFrom, dateTo, lastClosingDate]);

  const grandTotalDebit = trialBalanceData.reduce(
    (s, r) => s + r.totalDebit,
    0,
  );
  const grandTotalCredit = trialBalanceData.reduce(
    (s, r) => s + r.totalCredit,
    0,
  );
  const grandBalanceDebit = trialBalanceData.reduce(
    (s, r) => s + r.balanceDebit,
    0,
  );
  const grandBalanceCredit = trialBalanceData.reduce(
    (s, r) => s + r.balanceCredit,
    0,
  );
  const isBalanced =
    Math.abs(grandBalanceDebit - grandBalanceCredit) <= BALANCE_TOLERANCE;


  const getAccountTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      asset: "أصول",
      liability: "خصوم",
      equity: "حقوق ملكية",
      revenue: "إيرادات",
      expense: "مصروفات",
      assets: "أصول",
      liabilities: "خصوم",
      expenses: "مصروفات",
    };
    return map[type] || type;
  };

  const handleExportPDF = async () => {
    const { exportReportPdf } = await import("@/lib/pdf-arabic");
    const tableData = trialBalanceData.map((r) => [
      r.account.code,
      r.account.name,
      getAccountTypeLabel(r.account.account_type),
      formatNum(r.totalDebit),
      formatNum(r.totalCredit),
      formatNum(r.balanceDebit),
      formatNum(r.balanceCredit),
    ]);
    tableData.push([
      "",
      "",
      "الإجمالي",
      formatNum(grandTotalDebit),
      formatNum(grandTotalCredit),
      formatNum(grandBalanceDebit),
      formatNum(grandBalanceCredit),
    ]);
    await exportReportPdf({
      title: "ميزان المراجعة",
      settings,
      headers: [
        "الكود",
        "الحساب",
        "النوع",
        "إجمالي مدين",
        "إجمالي دائن",
        "رصيد مدين",
        "رصيد دائن",
      ],
      rows: tableData,
      orientation: "landscape",
      filename: "Trial_Balance",
    });
    notify.success("تم التصدير");
    setExportMenuOpen(false);
  };

  const handleExportExcel = async () => {
    const { exportToExcel } = await import("@/lib/excel-export");
    const data = trialBalanceData.map((r) => ({
      Code: r.account.code,
      Account: r.account.name,
      Type: r.account.account_type,
      "Total Debit": r.totalDebit,
      "Total Credit": r.totalCredit,
      "Balance Debit": r.balanceDebit,
      "Balance Credit": r.balanceCredit,
    }));
    data.push({
      Code: "",
      Account: "",
      Type: "Total",
      "Total Debit": grandTotalDebit,
      "Total Credit": grandTotalCredit,
      "Balance Debit": grandBalanceDebit,
      "Balance Credit": grandBalanceCredit,
    });
    await exportToExcel(data, "Trial Balance", "Trial_Balance.xlsx");
    notify.success("تم التصدير");
    setExportMenuOpen(false);
  };

  // Fixed sections - always show all account types in their correct side
  const fixedSections = [
    "asset",
    "liability",
    "equity",
    "revenue",
    "expense",
  ] as const;
  const sectionColumns = [
    {
      id: "debit",
      title: "الجانب المدين",
      description: "الأصول والمصروفات",
      sections: ["asset", "expense"] as const,
    },
    {
      id: "credit",
      title: "الجانب الدائن",
      description: "الخصوم وحقوق الملكية والإيرادات",
      sections: ["liability", "equity", "revenue"] as const,
    },
  ] as const;

  const normalizeAccountType = (type: string) => {
    if (type === "assets") return "asset";
    if (type === "liabilities") return "liability";
    if (type === "expenses") return "expense";
    return type;
  };

  const groupedRows = useMemo(() => {
    const groups: Record<string, TrialBalanceRow[]> = {};
    fixedSections.forEach((type) => {
      groups[type] = [];
    });

    trialBalanceData.forEach((row) => {
      const normalized = normalizeAccountType(row.account.account_type);
      if (!groups[normalized]) groups[normalized] = [];
      groups[normalized].push(row);
    });

    return groups;
  }, [trialBalanceData]);

  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader
        icon={Scale}
        title="ميزان المراجعة"
        description="أرصدة الحسابات والتوازن المحاسبي"
        actions={<>
          {/* Date filter */}
          <div className="flex items-center gap-2 bg-card p-1.5 rounded-xl border shadow-sm">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "gap-2 text-sm",
                    !dateFrom && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="h-4 w-4" />
                  {dateFrom ? format(dateFrom, "yyyy-MM-dd") : "من تاريخ"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateFrom}
                  onSelect={setDateFrom}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <span className="text-xs text-muted-foreground">إلى</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "gap-2 text-sm",
                    !dateTo && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="h-4 w-4" />
                  {dateTo ? format(dateTo, "yyyy-MM-dd") : "إلى تاريخ"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateTo}
                  onSelect={setDateTo}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            {(dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setDateFrom(undefined);
                  setDateTo(undefined);
                }}
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
        </>}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard
          icon={<TrendingUp className="h-5 w-5" />}
          iconBg="bg-emerald-500/10 text-emerald-600"
          label="إجمالي المدين"
          value={formatCurrency(grandTotalDebit)}
        />
        <KpiCard
          icon={<TrendingDown className="h-5 w-5" />}
          iconBg="bg-red-500/10 text-red-600"
          label="إجمالي الدائن"
          value={formatCurrency(grandTotalCredit)}
        />
        <KpiCard
          icon={<BookOpen className="h-5 w-5" />}
          iconBg="bg-blue-500/10 text-blue-600"
          label="رصيد مدين"
          value={formatCurrency(grandBalanceDebit)}
        />
        <KpiCard
          icon={<Layers className="h-5 w-5" />}
          iconBg="bg-purple-500/10 text-purple-600"
          label="رصيد دائن"
          value={formatCurrency(grandBalanceCredit)}
        />
      </div>

      {/* Balance Indicator Bar */}
      <div className="bg-card p-4 rounded-xl flex items-center justify-center gap-8 border shadow-sm">
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            رصيد مدين
          </p>
          <p className="text-xl font-bold text-foreground">
            {formatCurrency(grandBalanceDebit)}
          </p>
        </div>
        <div className="text-primary">
          <Scale className="h-9 w-9" />
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            رصيد دائن
          </p>
          <p className="text-xl font-bold text-foreground">
            {formatCurrency(grandBalanceCredit)}
          </p>
        </div>
        <div
          className={cn(
            "hidden md:flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold",
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
          {isBalanced ? "متوازن" : "غير متوازن"}
        </div>
      </div>

      {!isBalanced && !loading && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            ميزان المراجعة غير متوازن! الفرق بين الأرصدة المدينة والدائنة:{" "}
            {formatCurrency(Math.abs(grandBalanceDebit - grandBalanceCredit))}
          </AlertDescription>
        </Alert>
      )}

      {/* Current Period Alert */}
      {settings?.enable_fiscal_year_closing && lastClosingDate && !dateFrom && (
        <Alert className="border-blue-500/30 bg-blue-500/5">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-sm text-blue-700 dark:text-blue-400">
            البيانات المعروضة للفترة الجارية فقط بعد آخر إقفال بتاريخ{" "}
            <span className="font-bold">{lastClosingDate}</span>
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="p-6 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : trialBalanceData.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground">
          <Scale className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>لا توجد حركات مالية معتمدة</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {sectionColumns.map((column) => (
            <div key={column.id} className="space-y-6">
              <div className="rounded-xl border bg-card px-5 py-4 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-black text-foreground">
                      {column.title}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {column.description}
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {column.sections.reduce(
                      (count, type) => count + groupedRows[type].length,
                      0,
                    )}{" "}
                    حساب
                  </Badge>
                </div>
              </div>

              {column.sections.map((type) => {
                const rows = groupedRows[type] || [];
                const groupDebit = rows.reduce((s, r) => s + r.balanceDebit, 0);
                const groupCredit = rows.reduce(
                  (s, r) => s + r.balanceCredit,
                  0,
                );

                return (
                  <TrialBalanceSectionCard
                    key={type}
                    title={getAccountTypeLabel(type)}
                    rows={rows}
                    groupDebit={groupDebit}
                    groupCredit={groupCredit}
                    formatNum={formatNum}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  iconBg,
  label,
  value,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
}) {
  return <StatCard size="lg" icon={icon} iconBg={iconBg} label={label} value={value} />;
}


function TrialBalanceSectionCard({
  title,
  rows,
  groupDebit,
  groupCredit,
  formatNum,
}: {
  title: string;
  rows: TrialBalanceRow[];
  groupDebit: number;
  groupCredit: number;
  formatNum: (val: number) => string;
}) {
  return (
    <div className="bg-card rounded-xl border overflow-hidden shadow-sm min-h-[22rem]">
      <div className="bg-muted/50 px-6 py-4 border-b flex items-center justify-between">
        <h4 className="font-bold text-foreground">{title}</h4>
        <Badge variant="secondary" className="text-xs">
          {rows.length} حساب
        </Badge>
      </div>

      <div className="p-6 flex flex-col h-[calc(100%-4.5rem)]">
        <div className="grid grid-cols-[1fr_auto_auto] gap-4 text-xs font-medium text-muted-foreground mb-3 pb-2 border-b">
          <span>الحساب</span>
          <span className="w-28 text-left">رصيد مدين</span>
          <span className="w-28 text-left">رصيد دائن</span>
        </div>

        <div className="flex-1">
          {rows.length === 0 ? (
            <div className="h-full min-h-[12rem] rounded-xl border border-dashed bg-muted/30 flex flex-col items-center justify-center text-center px-4">
              <BookOpen className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="font-medium text-foreground">
                لا توجد حسابات في هذا القسم
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                سيبقى هذا القسم ثابتاً هنا حتى عند عدم وجود بيانات.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div
                  key={row.account.id}
                  className="grid grid-cols-[1fr_auto_auto] gap-4 text-sm items-center"
                >
                  <span className="text-muted-foreground">
                    <span className="font-mono text-xs text-foreground/50 ml-2">
                      {row.account.code}
                    </span>
                    {row.account.name}
                  </span>
                  <span
                    className={cn(
                      "w-28 text-left font-mono",
                      row.balanceDebit > 0
                        ? "text-emerald-600 font-medium"
                        : "text-muted-foreground/40",
                    )}
                  >
                    {row.balanceDebit > 0 ? formatNum(row.balanceDebit) : "—"}
                  </span>
                  <span
                    className={cn(
                      "w-28 text-left font-mono",
                      row.balanceCredit > 0
                        ? "text-red-600 font-medium"
                        : "text-muted-foreground/40",
                    )}
                  >
                    {row.balanceCredit > 0 ? formatNum(row.balanceCredit) : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t-2 grid grid-cols-[1fr_auto_auto] gap-4 items-center">
          <span className="font-bold text-foreground">الإجمالي</span>
          <span className="w-28 text-left font-mono font-black text-foreground">
            {groupDebit > 0 ? formatNum(groupDebit) : "—"}
          </span>
          <span className="w-28 text-left font-mono font-black text-foreground">
            {groupCredit > 0 ? formatNum(groupCredit) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
