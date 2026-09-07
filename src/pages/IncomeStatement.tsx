import React, { useState, useEffect, useMemo } from "react";
import { StatCard } from "@/components/StatCard";
import { formatNumber } from "@/lib/format";
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
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Download,
  CalendarIcon,
  X,
  ArrowUpRight,
  ArrowDownRight,
  Scale,
  CheckCircle,
  AlertTriangle,
  Shield,
  FileBarChart,
  Info,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  applyCurrentPeriod,
  fetchLastClosingDate,
  filterLinesByDate,
  sumNetByAccount,
  toReportDate,
} from "@/lib/report-period";
import { notify } from "@/lib/notify";
interface Account {
  id: string;
  code: string;
  name: string;
  account_type: string;
}

interface IncomeRow {
  account: Account;
  amount: number;
}

export default function IncomeStatement() {
  const { settings, currency } = useSettings();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
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
    if (accountsRes.data) setAccounts(accountsRes.data as Account[]);
    if (linesRes.data) setLines(linesRes.data);
    if (accountsRes.error || linesRes.error) {
      notify.error("خطأ", "فشل في جلب البيانات");
    }

    setLastClosingDate(
      await fetchLastClosingDate(settings?.enable_fiscal_year_closing),
    );

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const { revenueRows, expenseRows, totalRevenue, totalExpenses, netIncome } =
    useMemo(() => {
      const from = toReportDate(dateFrom);
      const to = toReportDate(dateTo);
      let filtered = filterLinesByDate(lines, from, to);

      // «الفترة الحالية»: استثناء قيود الإقفال وما قبلها عند عدم تحديد بداية يدوية
      if (settings?.enable_fiscal_year_closing && lastClosingDate) {
        filtered = applyCurrentPeriod(filtered, {
          lastClosingDate,
          manualDateFrom: from,
        });
      }

      const accountTypeOf = (id: string) =>
        accounts.find((a) => a.id === id)?.account_type;
      const allTotals = sumNetByAccount(filtered, accountTypeOf);
      const totals = new Map<string, number>();
      allTotals.forEach((v, id) => {
        const type = accountTypeOf(id);
        if (type === "revenue" || type === "expense") totals.set(id, v);
      });

      const revenueRows: IncomeRow[] = [];
      const expenseRows: IncomeRow[] = [];

      accounts.forEach((acc) => {
        const amount = totals.get(acc.id);
        if (amount === undefined || amount === 0) return;
        if (acc.account_type === "revenue")
          revenueRows.push({ account: acc, amount });
        else if (acc.account_type === "expense")
          expenseRows.push({ account: acc, amount });
      });

      const totalRevenue = revenueRows.reduce((s, r) => s + r.amount, 0);
      const totalExpenses = expenseRows.reduce((s, r) => s + r.amount, 0);

      return {
        revenueRows,
        expenseRows,
        totalRevenue,
        totalExpenses,
        netIncome: totalRevenue - totalExpenses,
      };
    }, [
      accounts,
      lines,
      dateFrom,
      dateTo,
      settings?.enable_fiscal_year_closing,
      lastClosingDate,
    ]);

  const profitMargin = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;
  /** قوائم الأرباح تُعرض بالقيمة المطلقة (الإشارة تُفهم من نوع السطر) */
  const formatNum = (val: number) => formatNumber(Math.abs(val));
  const formatCurrency = (val: number) => `${formatNum(val)} ${currency}`;

  const handleExportPDF = async () => {
    const { exportReportPdf } = await import("@/lib/pdf-arabic");
    const allRows: (string | number)[][] = [];
    revenueRows.forEach((r) =>
      allRows.push([
        r.account.code,
        r.account.name,
        "إيرادات",
        formatNum(r.amount),
      ]),
    );
    allRows.push(["", "إجمالي الإيرادات", "", formatNum(totalRevenue)]);
    expenseRows.forEach((r) =>
      allRows.push([
        r.account.code,
        r.account.name,
        "مصروفات",
        formatNum(r.amount),
      ]),
    );
    allRows.push(["", "إجمالي المصروفات", "", formatNum(totalExpenses)]);
    allRows.push([
      "",
      netIncome >= 0 ? "صافي الربح" : "صافي الخسارة",
      "",
      formatNum(netIncome),
    ]);
    await exportReportPdf({
      title: "قائمة الدخل",
      settings,
      headers: ["الكود", "الحساب", "النوع", `المبلغ (${currency})`],
      rows: allRows,
      summaryCards: [
        { label: "إجمالي الإيرادات", value: formatCurrency(totalRevenue) },
        { label: "إجمالي المصروفات", value: formatCurrency(totalExpenses) },
        {
          label: netIncome >= 0 ? "صافي الربح" : "صافي الخسارة",
          value: formatCurrency(Math.abs(netIncome)),
        },
      ],
      filename: "Income_Statement",
    });
    notify.success("تم التصدير", "تم تصدير قائمة الدخل بصيغة PDF");
    setExportMenuOpen(false);
  };

  const handleExportExcel = async () => {
    const { exportToExcel } = await import("@/lib/excel-export");
    const data: any[] = [];
    data.push({ القسم: "الإيرادات", الكود: "", الحساب: "", المبلغ: "" });
    revenueRows.forEach((r) =>
      data.push({
        القسم: "",
        الكود: r.account.code,
        الحساب: r.account.name,
        المبلغ: r.amount,
      }),
    );
    data.push({
      القسم: "",
      الكود: "",
      الحساب: "إجمالي الإيرادات",
      المبلغ: totalRevenue,
    });
    data.push({ القسم: "", الكود: "", الحساب: "", المبلغ: "" });
    data.push({ القسم: "المصروفات", الكود: "", الحساب: "", المبلغ: "" });
    expenseRows.forEach((r) =>
      data.push({
        القسم: "",
        الكود: r.account.code,
        الحساب: r.account.name,
        المبلغ: r.amount,
      }),
    );
    data.push({
      القسم: "",
      الكود: "",
      الحساب: "إجمالي المصروفات",
      المبلغ: totalExpenses,
    });
    data.push({ القسم: "", الكود: "", الحساب: "", المبلغ: "" });
    data.push({
      القسم: "",
      الكود: "",
      الحساب: netIncome >= 0 ? "صافي الربح" : "صافي الخسارة",
      المبلغ: netIncome,
    });
    await exportToExcel(data, "Income Statement", "Income_Statement.xlsx");
    notify.success("تم التصدير", "تم تصدير قائمة الدخل بصيغة Excel");
    setExportMenuOpen(false);
  };

  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader
        icon={FileBarChart}
        title="قائمة الدخل"
        description="بيان الإيرادات والمصروفات للفترة المحددة"
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
          icon={<ArrowUpRight className="h-5 w-5" />}
          iconBg="bg-emerald-500/10 text-emerald-600"
          label="إجمالي الإيرادات"
          value={formatCurrency(totalRevenue)}
        />
        <KpiCard
          icon={<ArrowDownRight className="h-5 w-5" />}
          iconBg="bg-red-500/10 text-red-600"
          label="إجمالي المصروفات"
          value={formatCurrency(totalExpenses)}
        />
        <KpiCard
          icon={
            netIncome >= 0 ? (
              <TrendingUp className="h-5 w-5" />
            ) : (
              <TrendingDown className="h-5 w-5" />
            )
          }
          iconBg={cn(
            netIncome >= 0
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-red-500/10 text-red-600",
          )}
          label={netIncome >= 0 ? "صافي الربح" : "صافي الخسارة"}
          value={formatCurrency(netIncome)}
        />
        <KpiCard
          icon={<Scale className="h-5 w-5" />}
          iconBg="bg-blue-500/10 text-blue-600"
          label="هامش الربح"
          value={`${profitMargin.toFixed(1)}%`}
        />
      </div>

      {/* Net Income Indicator Bar */}
      <div className="bg-card p-4 rounded-xl flex items-center justify-center gap-8 border shadow-sm">
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            إجمالي الإيرادات
          </p>
          <p className="text-xl font-bold text-foreground">
            {formatCurrency(totalRevenue)}
          </p>
        </div>
        <div className="text-center px-4">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            −
          </p>
          <p className="text-xl font-bold text-foreground">−</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            إجمالي المصروفات
          </p>
          <p className="text-xl font-bold text-foreground">
            {formatCurrency(totalExpenses)}
          </p>
        </div>
        <div className="text-center px-4">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            =
          </p>
          <p className="text-xl font-bold text-foreground">=</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            {netIncome >= 0 ? "صافي الربح" : "صافي الخسارة"}
          </p>
          <p
            className={cn(
              "text-xl font-bold",
              netIncome >= 0 ? "text-emerald-600" : "text-destructive",
            )}
          >
            {formatCurrency(netIncome)}
          </p>
        </div>
        <div
          className={cn(
            "hidden md:flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-bold",
            netIncome >= 0
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {netIncome >= 0 ? (
            <CheckCircle className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          {netIncome >= 0 ? "ربح" : "خسارة"}
        </div>
      </div>

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
      ) : (
        /* Two Column Layout */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Column 1: Revenue */}
          <div className="bg-card rounded-xl border overflow-hidden shadow-sm">
            <div className="bg-muted/50 px-6 py-4 border-b">
              <h4 className="font-bold text-foreground flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-emerald-600" />
                الإيرادات (Revenue)
              </h4>
            </div>
            <div className="p-6">
              {revenueRows.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8">
                  لا توجد إيرادات
                </p>
              ) : (
                <div className="space-y-4">
                  {revenueRows.map((row) => (
                    <div
                      key={row.account.id}
                      className="flex justify-between text-sm"
                    >
                      <span className="text-muted-foreground">
                        {row.account.name}
                      </span>
                      <span className="font-medium text-emerald-600 font-mono">
                        {formatCurrency(row.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-8 pt-4 border-t-2 flex justify-between items-center">
                <span className="font-bold text-foreground">
                  إجمالي الإيرادات
                </span>
                <span className="text-lg font-black text-emerald-600 font-mono">
                  {formatCurrency(totalRevenue)}
                </span>
              </div>
            </div>
          </div>

          {/* Column 2: Expenses */}
          <div className="bg-card rounded-xl border overflow-hidden shadow-sm">
            <div className="bg-muted/50 px-6 py-4 border-b">
              <h4 className="font-bold text-foreground flex items-center gap-2">
                <ArrowDownRight className="h-4 w-4 text-red-600" />
                المصروفات (Expenses)
              </h4>
            </div>
            <div className="p-6">
              {expenseRows.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8">
                  لا توجد مصروفات
                </p>
              ) : (
                <div className="space-y-4">
                  {expenseRows.map((row) => (
                    <div
                      key={row.account.id}
                      className="flex justify-between text-sm"
                    >
                      <span className="text-muted-foreground">
                        {row.account.name}
                      </span>
                      <span className="font-medium text-red-600 font-mono">
                        {formatCurrency(row.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-8 pt-4 border-t-2 flex justify-between items-center">
                <span className="font-bold text-foreground">
                  إجمالي المصروفات
                </span>
                <span className="text-lg font-black text-red-600 font-mono">
                  {formatCurrency(totalExpenses)}
                </span>
              </div>
            </div>
          </div>
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
