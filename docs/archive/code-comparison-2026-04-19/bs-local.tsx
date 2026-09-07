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
import { toast } from "@/hooks/use-toast";
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
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  BALANCE_TOLERANCE,
  FISCAL_CLOSING_DESCRIPTION_PREFIX,
} from "@/lib/constants";

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
      toast({
        title: "خطأ",
        description: "فشل في تحميل بيانات الميزانية",
        variant: "destructive",
      });
    }
    if (accountsRes.data) setAccounts(accountsRes.data as Account[]);
    if (linesRes.data) setLines(linesRes.data);

    // Find last closing entry date if fiscal year closing is enabled
    if (settings?.enable_fiscal_year_closing) {
      const { data: closingEntries } = await supabase
        .from("journal_entries")
        .select("entry_date")
        .like("description", `%${FISCAL_CLOSING_DESCRIPTION_PREFIX}%`)
        .in("status", ["posted", "approved"])
        .order("entry_date", { ascending: false })
        .limit(1);
      if (closingEntries && closingEntries.length > 0) {
        setLastClosingDate(closingEntries[0].entry_date);
      } else {
        setLastClosingDate(null);
      }
    }
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
    const filtered = lines.filter((l: any) => {
      const d = (l.journal_entries as any)?.entry_date;
      if (!d) return false;
      if (asOfDate && d > format(asOfDate, "yyyy-MM-dd")) return false;
      return true;
    });

    const totals = new Map<string, number>();
    filtered.forEach((l: any) => {
      const acc = accounts.find((a) => a.id === l.account_id);
      if (!acc) return;
      const existing = totals.get(l.account_id) || 0;
      if (acc.account_type === "asset" || acc.account_type === "expense") {
        totals.set(
          l.account_id,
          existing + (Number(l.debit) - Number(l.credit)),
        );
      } else {
        totals.set(
          l.account_id,
          existing + (Number(l.credit) - Number(l.debit)),
        );
      }
    });

    // For net income: if fiscal year closing is enabled and there's a closing entry,
    // only compute revenue/expense from entries AFTER the last closing date
    const incomeFiltered =
      settings?.enable_fiscal_year_closing && lastClosingDate
        ? filtered.filter((l: any) => {
            const d = (l.journal_entries as any)?.entry_date;
            const desc = (l.journal_entries as any)?.description || "";
            // Exclude the closing entry itself and only include entries after closing date
            if (desc.includes(FISCAL_CLOSING_DESCRIPTION_PREFIX)) return false;
            return d > lastClosingDate;
          })
        : filtered;

    const incomeTotals = new Map<string, number>();
    incomeFiltered.forEach((l: any) => {
      const acc = accounts.find((a) => a.id === l.account_id);
      if (
        !acc ||
        (acc.account_type !== "revenue" && acc.account_type !== "expense")
      )
        return;
      const existing = incomeTotals.get(l.account_id) || 0;
      if (acc.account_type === "expense") {
        incomeTotals.set(
          l.account_id,
          existing + (Number(l.debit) - Number(l.credit)),
        );
      } else {
        incomeTotals.set(
          l.account_id,
          existing + (Number(l.credit) - Number(l.debit)),
        );
      }
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

  const isBalanced =
    Math.abs(totalAssets - (totalLiabilities + totalEquity)) <=
    BALANCE_TOLERANCE;
  const formatNum = (val: number) =>
    Math.abs(val).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const formatCurrency = (val: number) => `${formatNum(val)} ${currency}`;

  const handleExportPDF = async () => {
    const { exportReportPdf } = await import("@/lib/pdf-arabic");
    const allRows: (string | number)[][] = [];
    assetRows.forEach((r) =>
      allRows.push([
        r.account.code,
        r.account.name,
        "أصول",
        formatNum(r.balance),
      ]),
    );
    allRows.push(["", "إجمالي الأصول", "", formatNum(totalAssets)]);
    liabilityRows.forEach((r) =>
      allRows.push([
        r.account.code,
        r.account.name,
        "خصوم",
        formatNum(r.balance),
      ]),
    );
    allRows.push(["", "إجمالي الخصوم", "", formatNum(totalLiabilities)]);
    equityRows.forEach((r) =>
      allRows.push([
        r.account.code,
        r.account.name,
        "حقوق ملكية",
        formatNum(r.balance),
      ]),
    );
    if (netIncome !== 0)
      allRows.push([
        "",
        netIncome >= 0 ? "صافي الربح" : "صافي الخسارة",
        "",
        formatNum(netIncome),
      ]);
    allRows.push(["", "إجمالي حقوق الملكية", "", formatNum(totalEquity)]);
    await exportReportPdf({
      title: "الميزانية العمومية",
      settings,
      headers: ["الكود", "الحساب", "النوع", `المبلغ (${currency})`],
      rows: allRows,
      summaryCards: [
        { label: "إجمالي الأصول", value: formatCurrency(totalAssets) },
        { label: "إجمالي الخصوم", value: formatCurrency(totalLiabilities) },
        { label: "حقوق الملكية", value: formatCurrency(totalEquity) },
      ],
      filename: "Balance_Sheet",
    });
    toast({
      title: "تم التصدير",
      description: "تم تصدير الميزانية العمومية بصيغة PDF",
    });
    setExportMenuOpen(false);
  };

  const handleExportExcel = async () => {
    const { exportToExcel } = await import("@/lib/excel-export");
    const data: any[] = [];
    data.push({ القسم: "الأصول", الكود: "", الحساب: "", المبلغ: "" });
    assetRows.forEach((r) =>
      data.push({
        القسم: "",
        الكود: r.account.code,
        الحساب: r.account.name,
        المبلغ: r.balance,
      }),
    );
    data.push({
      القسم: "",
      الكود: "",
      الحساب: "إجمالي الأصول",
      المبلغ: totalAssets,
    });
    data.push({ القسم: "", الكود: "", الحساب: "", المبلغ: "" });
    data.push({ القسم: "الخصوم", الكود: "", الحساب: "", المبلغ: "" });
    liabilityRows.forEach((r) =>
      data.push({
        القسم: "",
        الكود: r.account.code,
        الحساب: r.account.name,
        المبلغ: r.balance,
      }),
    );
    data.push({
      القسم: "",
      الكود: "",
      الحساب: "إجمالي الخصوم",
      المبلغ: totalLiabilities,
    });
    data.push({ القسم: "", الكود: "", الحساب: "", المبلغ: "" });
    data.push({ القسم: "حقوق الملكية", الكود: "", الحساب: "", المبلغ: "" });
    equityRows.forEach((r) =>
      data.push({
        القسم: "",
        الكود: r.account.code,
        الحساب: r.account.name,
        المبلغ: r.balance,
      }),
    );
    if (netIncome !== 0)
      data.push({
        القسم: "",
        الكود: "",
        الحساب: netIncome >= 0 ? "صافي الربح" : "صافي الخسارة",
        المبلغ: netIncome,
      });
    data.push({
      القسم: "",
      الكود: "",
      الحساب: "إجمالي حقوق الملكية",
      المبلغ: totalEquity,
    });
    await exportToExcel(data, "Balance Sheet", "Balance_Sheet.xlsx");
    toast({
      title: "تم التصدير",
      description: "تم تصدير الميزانية العمومية بصيغة Excel",
    });
    setExportMenuOpen(false);
  };

  return (
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
        />
        <KpiCard
          icon={<Wallet className="h-5 w-5" />}
          iconBg="bg-amber-500/10 text-amber-600"
          label="إجمالي الالتزامات"
          value={formatCurrency(totalLiabilities)}
        />
        <KpiCard
          icon={<Shield className="h-5 w-5" />}
          iconBg="bg-purple-500/10 text-purple-600"
          label="إجمالي حقوق الملكية"
          value={formatCurrency(totalEquity)}
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
          value={formatCurrency(netIncome)}
        />
      </div>

      {/* Balance Indicator Bar */}
      <div className="bg-card p-4 rounded-xl flex items-center justify-center gap-8 border shadow-sm">
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
          {isBalanced ? "متوازنة" : "غير متوازنة"}
        </div>
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
            <div className="bg-muted/50 px-6 py-4 border-b">
              <h4 className="font-bold text-foreground">الأصول (Assets)</h4>
            </div>
            <div className="p-6">
              {assetRows.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8">
                  لا توجد حسابات أصول
                </p>
              ) : (
                <div className="space-y-4">
                  {assetRows.map((row) => (
                    <div
                      key={row.account.id}
                      className="flex justify-between text-sm"
                    >
                      <span className="text-muted-foreground">
                        {row.account.name}
                      </span>
                      <span className="font-medium text-foreground font-mono">
                        {formatCurrency(row.balance)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-8 pt-4 border-t-2 flex justify-between items-center">
                <span className="font-bold text-foreground">إجمالي الأصول</span>
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
              <div className="bg-muted/50 px-6 py-4 border-b">
                <h4 className="font-bold text-foreground">
                  الالتزامات (Liabilities)
                </h4>
              </div>
              <div className="p-6">
                {liabilityRows.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-4">
                    لا توجد التزامات
                  </p>
                ) : (
                  <div className="space-y-4">
                    {liabilityRows.map((row) => (
                      <div
                        key={row.account.id}
                        className="flex justify-between text-sm"
                      >
                        <span className="text-muted-foreground">
                          {row.account.name}
                        </span>
                        <span className="font-medium text-foreground font-mono">
                          {formatCurrency(row.balance)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Equity Card */}
            <div className="bg-card rounded-xl border overflow-hidden shadow-sm">
              <div className="bg-muted/50 px-6 py-4 border-b">
                <h4 className="font-bold text-foreground">
                  حقوق الملكية (Equity)
                </h4>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {equityRows.map((row) => (
                    <div
                      key={row.account.id}
                      className="flex justify-between text-sm"
                    >
                      <span className="text-muted-foreground">
                        {row.account.name}
                      </span>
                      <span className="font-medium text-foreground font-mono">
                        {formatCurrency(row.balance)}
                      </span>
                    </div>
                  ))}
                  {netIncome !== 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {netIncome >= 0
                          ? "صافي ربح الفترة"
                          : "صافي خسارة الفترة"}
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
                <div className="mt-8 pt-4 border-t-2 flex justify-between items-center">
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
  return (
    <div className="bg-card p-6 rounded-xl shadow-sm border">
      <div className="flex justify-between items-start mb-4">
        <div className={cn("p-2 rounded-lg", iconBg)}>{icon}</div>
      </div>
      <p className="text-sm text-muted-foreground font-medium">{label}</p>
      <h3 className="text-2xl font-black text-foreground mt-1 font-mono">
        {value}
      </h3>
    </div>
  );
}
