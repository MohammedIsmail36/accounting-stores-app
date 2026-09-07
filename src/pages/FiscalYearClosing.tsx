import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { createJournalEntry } from "@/lib/journal-writer";
import { useSettings } from "@/contexts/SettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import {
  Loader2,
  Lock,
  TrendingUp,
  TrendingDown,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Undo2,
  FileWarning,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ACCOUNT_CODES,
  FISCAL_CLOSING_DESCRIPTION_PREFIX,
  isBalanced,
} from "@/lib/constants";

interface AccountBalance {
  id: string;
  code: string;
  name: string;
  account_type: string;
  balance: number;
}

export default function FiscalYearClosing() {
  const { settings, currency, formatCurrency } = useSettings();
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [existingClosing, setExistingClosing] = useState<any>(null);
  const [draftCounts, setDraftCounts] = useState<{
    sales: number;
    purchases: number;
    returns: number;
    expenses: number;
  }>({ sales: 0, purchases: 0, returns: 0, expenses: 0 });
  const [closingStep, setClosingStep] = useState<0 | 1 | 2>(0);
  const [showClosingDialog, setShowClosingDialog] = useState(false);

  // Year selection: user can pick a previous fiscal year to close
  const currentCalYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const startMonth = settings?.fiscal_year_start || "01-01";
    const [mm, dd] = startMonth.split("-").map(Number);
    const now = new Date();
    let startYear = now.getFullYear();
    const fiscalStartThisYear = new Date(startYear, mm - 1, dd);
    if (now < fiscalStartThisYear) startYear--;
    // Default to PREVIOUS fiscal year (most common case: closing the year that just ended)
    return startYear - 1;
  });

  // Calculate fiscal year dates from selectedYear
  const fiscalYear = useMemo(() => {
    const startMonth = settings?.fiscal_year_start || "01-01";
    const [mm, dd] = startMonth.split("-").map(Number);
    const start = new Date(selectedYear, mm - 1, dd);
    const end = new Date(selectedYear + 1, mm - 1, dd - 1);
    return {
      startDate: start.toISOString().split("T")[0],
      endDate: end.toISOString().split("T")[0],
      label: `${selectedYear}/${selectedYear + 1}`,
      year: selectedYear,
    };
  }, [settings, selectedYear]);

  // Available years to choose from (last 5 years through current)
  const availableYears = useMemo(() => {
    const years: number[] = [];
    for (let y = currentCalYear; y >= currentCalYear - 5; y--) years.push(y);
    return years;
  }, [currentCalYear]);

  useEffect(() => {
    fetchData();
  }, [selectedYear]);

  const fetchData = async () => {
    setLoading(true);
    const [
      accountsRes,
      linesRes,
      closingRes,
      draftSales,
      draftPurchases,
      draftSalesReturns,
      draftPurchaseReturns,
      draftExpenses,
    ] = await Promise.all([
      supabase
        .from("accounts")
        .select("id, code, name, account_type")
        .eq("is_active", true)
        .eq("is_parent", false)
        .order("code"),
      supabase
        .from("journal_entry_lines")
        .select(
          "account_id, debit, credit, journal_entries!inner(entry_date, status)",
        )
        .in("journal_entries.status", ["posted", "approved"]),
      supabase
        .from("journal_entries")
        .select("id, entry_date, description, status")
        .like(
          "description",
          `%${FISCAL_CLOSING_DESCRIPTION_PREFIX} ${fiscalYear.year}%`,
        )
        .in("status", ["posted", "approved"])
        .limit(1),
      supabase
        .from("sales_invoices")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft"),
      supabase
        .from("purchase_invoices")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft"),
      supabase
        .from("sales_returns")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft"),
      supabase
        .from("purchase_returns")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft"),
      supabase
        .from("expenses")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft"),
    ]);
    if (accountsRes.data) setAccounts(accountsRes.data);
    if (linesRes.data) setLines(linesRes.data);
    if (closingRes.data && closingRes.data.length > 0)
      setExistingClosing(closingRes.data[0]);
    setDraftCounts({
      sales: draftSales.count || 0,
      purchases: draftPurchases.count || 0,
      returns:
        (draftSalesReturns.count || 0) + (draftPurchaseReturns.count || 0),
      expenses: draftExpenses.count || 0,
    });
    setLoading(false);
  };

  const {
    revenueAccounts,
    expenseAccounts,
    totalRevenue,
    totalExpenses,
    netIncome,
    retainedEarningsAccount,
  } = useMemo(() => {
    const filtered = lines.filter((l: any) => {
      const d = (l.journal_entries as any)?.entry_date;
      if (!d) return false;
      return d >= fiscalYear.startDate && d <= fiscalYear.endDate;
    });

    const totals = new Map<string, number>();
    filtered.forEach((l: any) => {
      const existing = totals.get(l.account_id) || 0;
      const acc = accounts.find((a) => a.id === l.account_id);
      if (!acc) return;
      if (acc.account_type === "expense") {
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

    const revenueAccounts: AccountBalance[] = [];
    const expenseAccounts: AccountBalance[] = [];
    let retainedEarningsAccount: any = null;

    accounts.forEach((acc) => {
      if (acc.code === ACCOUNT_CODES.RETAINED_EARNINGS)
        retainedEarningsAccount = acc;
      const balance = totals.get(acc.id) || 0;
      if (balance === 0) return;
      if (acc.account_type === "revenue")
        revenueAccounts.push({ ...acc, balance });
      else if (acc.account_type === "expense")
        expenseAccounts.push({ ...acc, balance });
    });

    const totalRevenue = revenueAccounts.reduce((s, a) => s + a.balance, 0);
    const totalExpenses = expenseAccounts.reduce((s, a) => s + a.balance, 0);
    const netIncome = totalRevenue - totalExpenses;

    return {
      revenueAccounts,
      expenseAccounts,
      totalRevenue,
      totalExpenses,
      netIncome,
      retainedEarningsAccount,
    };
  }, [accounts, lines, fiscalYear]);

  const totalDraftCount =
    draftCounts.sales +
    draftCounts.purchases +
    draftCounts.returns +
    draftCounts.expenses;

  const startClosingFlow = () => {
    setClosingStep(totalDraftCount > 0 ? 1 : 2);
    setShowClosingDialog(true);
  };

  const executeClosing = async () => {
    if (!retainedEarningsAccount) {
      notify.error(
        `حساب الأرباح المحتجزة (${ACCOUNT_CODES.RETAINED_EARNINGS}) غير موجود في شجرة الحسابات`,
      );
      return;
    }
    if (revenueAccounts.length === 0 && expenseAccounts.length === 0) {
      notify.error("لا توجد أرصدة لإقفالها في هذه الفترة");
      return;
    }

    setExecuting(true);
    setShowClosingDialog(false);
    try {
      // 1. Create journal entry
      const description = `${FISCAL_CLOSING_DESCRIPTION_PREFIX} ${fiscalYear.year} - ترحيل صافي ${netIncome >= 0 ? "الربح" : "الخسارة"} إلى الأرباح المحتجزة`;
      const totalDebit =
        revenueAccounts.reduce((s, a) => s + a.balance, 0) +
        (netIncome < 0 ? Math.abs(netIncome) : 0);
      const totalCredit =
        expenseAccounts.reduce((s, a) => s + a.balance, 0) +
        (netIncome >= 0 ? netIncome : 0);

      // Verify debit/credit balance before proceeding
      if (!isBalanced(totalDebit, totalCredit)) {
        notify.error(
          `قيد الإقفال غير متوازن: مدين ${totalDebit.toFixed(2)} ≠ دائن ${totalCredit.toFixed(2)}`,
        );
        setExecuting(false);
        return;
      }

      // 2. Build journal lines
      const journalLines: any[] = [];

      // Debit revenue accounts (to zero them out)
      revenueAccounts.forEach((acc) => {
        journalLines.push({
          account_id: acc.id,
          debit: acc.balance,
          credit: 0,
          description: `إقفال حساب إيرادات: ${acc.name}`,
        });
      });

      // Credit expense accounts (to zero them out)
      expenseAccounts.forEach((acc) => {
        journalLines.push({
          account_id: acc.id,
          debit: 0,
          credit: acc.balance,
          description: `إقفال حساب مصروفات: ${acc.name}`,
        });
      });

      // Net income/loss to retained earnings
      journalLines.push(
        netIncome >= 0
          ? {
              account_id: retainedEarningsAccount.id,
              debit: 0,
              credit: netIncome,
              description: `ترحيل صافي ربح السنة المالية ${fiscalYear.year}`,
            }
          : {
              account_id: retainedEarningsAccount.id,
              debit: Math.abs(netIncome),
              credit: 0,
              description: `ترحيل صافي خسارة السنة المالية ${fiscalYear.year}`,
            },
      );

      const closingEntryId = await createJournalEntry({
        entryDate: fiscalYear.endDate,
        description,
        status: "posted",
        lines: journalLines,
      });

      const { data: closingEntry } = await supabase
        .from("journal_entries")
        .select("entry_number")
        .eq("id", closingEntryId)
        .single();

      notify.success(
        `تم إقفال السنة المالية ${fiscalYear.label} بنجاح - قيد رقم ${closingEntry?.entry_number ?? ""}`,
      );
      setExistingClosing({ id: closingEntryId, description });
      fetchData();
    } catch (err: any) {
      notify.error("خطأ في تنفيذ الإقفال: " + err.message);
      console.error(err);
    }
    setExecuting(false);
  };

  const reverseClosing = async () => {
    if (!existingClosing) return;
    setReversing(true);
    try {
      // Delete journal entry lines first, then the entry itself
      const { error: linesErr } = await supabase
        .from("journal_entry_lines")
        .delete()
        .eq("journal_entry_id", existingClosing.id);
      if (linesErr) throw linesErr;

      const { error: entryErr } = await supabase
        .from("journal_entries")
        .delete()
        .eq("id", existingClosing.id);
      if (entryErr) throw entryErr;

      notify.success(
        `تم عكس قيد إقفال السنة المالية ${fiscalYear.label} وإعادة فتحها بنجاح`,
      );
      setExistingClosing(null);
      fetchData();
    } catch (err: any) {
      notify.error("خطأ في عكس قيد الإقفال: " + err.message);
      console.error(err);
    }
    setReversing(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8" dir="rtl">
      <PageHeader
        icon={Lock}
        title="إقفال السنة المالية"
        description={`السنة المالية: ${fiscalYear.label} (${fiscalYear.startDate} إلى ${fiscalYear.endDate})`}
      />

      {/* Year selector */}
      <div className="bg-card border rounded-xl p-4 flex items-center gap-3">
        <label className="text-sm font-semibold">اختر السنة المالية للإقفال:</label>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="border rounded-lg px-3 py-2 bg-background text-sm"
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>
              {y} / {y + 1}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          (عادةً تُقفل السنة المنتهية قبل بدء إدخال بيانات السنة الجديدة)
        </span>
      </div>

      {/* Warning if already closed */}
      {existingClosing && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-amber-700">
                تم إقفال هذه السنة المالية مسبقاً
              </p>
              <p className="text-sm text-amber-600 mt-1">
                {existingClosing.description}
              </p>
            </div>
          </div>
          <ConfirmDialog
            title="تأكيد عكس قيد الإقفال"
            description={
              <>
                سيتم حذف قيد إقفال السنة المالية نهائياً وإعادة أرصدة حسابات
                الإيرادات والمصروفات إلى وضعها السابق.
                <br />
                <br />
                سيتم أيضاً عكس المبلغ المرحّل إلى حساب الأرباح المحتجزة (
                {ACCOUNT_CODES.RETAINED_EARNINGS}).
                <br />
                <br />
                <strong>هل أنت متأكد من إعادة فتح السنة المالية؟</strong>
              </>
            }
            confirmText="تأكيد العكس"
            destructive
            onConfirm={reverseClosing}
            trigger={
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/10 shrink-0"
                disabled={reversing}
              >
                {reversing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Undo2 className="h-4 w-4" />
                )}
                عكس الإقفال
              </Button>
            }
          />

        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-card p-6 rounded-xl shadow-sm border">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
            </div>
            <span className="text-sm text-muted-foreground">
              إجمالي الإيرادات
            </span>
          </div>
          <p className="text-2xl font-black text-foreground font-mono">
            {formatCurrency(totalRevenue)}
          </p>
        </div>
        <div className="bg-card p-6 rounded-xl shadow-sm border">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-2 rounded-lg bg-red-500/10">
              <TrendingDown className="h-5 w-5 text-red-600" />
            </div>
            <span className="text-sm text-muted-foreground">
              إجمالي المصروفات
            </span>
          </div>
          <p className="text-2xl font-black text-foreground font-mono">
            {formatCurrency(totalExpenses)}
          </p>
        </div>
        <div className="bg-card p-6 rounded-xl shadow-sm border">
          <div className="flex items-center gap-2 mb-3">
            <div
              className={cn(
                "p-2 rounded-lg",
                netIncome >= 0 ? "bg-emerald-500/10" : "bg-destructive/10",
              )}
            >
              <DollarSign
                className={cn(
                  "h-5 w-5",
                  netIncome >= 0 ? "text-emerald-600" : "text-destructive",
                )}
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {netIncome >= 0 ? "صافي الربح" : "صافي الخسارة"}
            </span>
          </div>
          <p
            className={cn(
              "text-2xl font-black font-mono",
              netIncome >= 0 ? "text-emerald-600" : "text-destructive",
            )}
          >
            {formatCurrency(netIncome)}
          </p>
        </div>
      </div>

      {/* Details Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Accounts */}
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="bg-emerald-500/5 px-6 py-4 border-b">
            <h4 className="font-bold text-foreground">
              حسابات الإيرادات ({revenueAccounts.length})
            </h4>
          </div>
          <div className="p-6 space-y-3">
            {revenueAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                لا توجد إيرادات في هذه الفترة
              </p>
            ) : (
              revenueAccounts.map((acc) => (
                <div key={acc.id} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {acc.code} - {acc.name}
                  </span>
                  <span className="font-mono font-medium text-foreground">
                    {formatCurrency(acc.balance)}
                  </span>
                </div>
              ))
            )}
            <div className="pt-3 mt-3 border-t flex justify-between font-bold">
              <span>الإجمالي</span>
              <span className="font-mono">{formatCurrency(totalRevenue)}</span>
            </div>
          </div>
        </div>

        {/* Expense Accounts */}
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="bg-red-500/5 px-6 py-4 border-b">
            <h4 className="font-bold text-foreground">
              حسابات المصروفات ({expenseAccounts.length})
            </h4>
          </div>
          <div className="p-6 space-y-3">
            {expenseAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                لا توجد مصروفات في هذه الفترة
              </p>
            ) : (
              expenseAccounts.map((acc) => (
                <div key={acc.id} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {acc.code} - {acc.name}
                  </span>
                  <span className="font-mono font-medium text-foreground">
                    {formatCurrency(acc.balance)}
                  </span>
                </div>
              ))
            )}
            <div className="pt-3 mt-3 border-t flex justify-between font-bold">
              <span>الإجمالي</span>
              <span className="font-mono">{formatCurrency(totalExpenses)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Closing Entry Preview */}
      <div className="bg-card rounded-xl border shadow-sm p-6">
        <h4 className="font-bold text-foreground mb-4">ملخص قيد الإقفال</h4>
        <div className="text-sm space-y-2">
          <p className="text-muted-foreground">
            سيتم إنشاء قيد يومية بتاريخ{" "}
            <span className="font-bold text-foreground">
              {fiscalYear.endDate}
            </span>{" "}
            يتضمن:
          </p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground mr-4">
            <li>
              <span className="font-medium text-foreground">
                {revenueAccounts.length}
              </span>{" "}
              سطر مدين لتصفير حسابات الإيرادات
            </li>
            <li>
              <span className="font-medium text-foreground">
                {expenseAccounts.length}
              </span>{" "}
              سطر دائن لتصفير حسابات المصروفات
            </li>
            <li>
              سطر واحد لحساب الأرباح المحتجزة ({ACCOUNT_CODES.RETAINED_EARNINGS}
              ):{" "}
              <span
                className={cn(
                  "font-bold",
                  netIncome >= 0 ? "text-emerald-600" : "text-destructive",
                )}
              >
                {netIncome >= 0 ? "دائن" : "مدين"} بمبلغ{" "}
                {formatCurrency(netIncome)}
              </span>
            </li>
          </ul>
        </div>
      </div>

      {/* Draft invoices warning */}
      {totalDraftCount > 0 && !existingClosing && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 flex items-start gap-3">
          <FileWarning className="h-5 w-5 text-orange-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-bold text-orange-700">
              توجد مستندات مسودة لم تُرحّل بعد
            </p>
            <ul className="text-sm text-orange-600 mt-1 space-y-0.5 list-disc list-inside mr-3">
              {draftCounts.sales > 0 && (
                <li>{draftCounts.sales} فاتورة بيع مسودة</li>
              )}
              {draftCounts.purchases > 0 && (
                <li>{draftCounts.purchases} فاتورة شراء مسودة</li>
              )}
              {draftCounts.returns > 0 && (
                <li>{draftCounts.returns} مرتجع مسودة</li>
              )}
              {draftCounts.expenses > 0 && (
                <li>{draftCounts.expenses} مصروف مسودة</li>
              )}
            </ul>
            <p className="text-sm text-orange-600 mt-2">
              يُنصح بترحيل أو إلغاء جميع المسودات قبل إقفال السنة المالية لضمان
              دقة التقارير.
            </p>
          </div>
        </div>
      )}

      {/* Execute Button */}
      <div className="flex justify-center">
        <Button
          size="lg"
          className="gap-2 px-8 shadow-lg shadow-primary/20"
          disabled={
            executing ||
            !!existingClosing ||
            !retainedEarningsAccount ||
            (revenueAccounts.length === 0 && expenseAccounts.length === 0)
          }
          onClick={startClosingFlow}
        >
          {executing ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-5 w-5" />
          )}
          تنفيذ إقفال السنة المالية {fiscalYear.label}
        </Button>
      </div>

      {/* Multi-step Closing Confirmation Dialog */}
      <Dialog
        open={showClosingDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowClosingDialog(false);
            setClosingStep(0);
          }
        }}
      >
        <DialogContent dir="rtl" className="max-w-lg">
          {closingStep === 1 && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-orange-600">
                  <AlertTriangle className="h-5 w-5" />
                  تحذير: مستندات مسودة غير مرحّلة
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-3 pt-2">
                    <p>
                      توجد مستندات لا تزال في حالة مسودة ولن يتم تضمينها في
                      أرصدة الإقفال:
                    </p>
                    <ul className="list-disc list-inside space-y-1 mr-3">
                      {draftCounts.sales > 0 && (
                        <li>{draftCounts.sales} فاتورة بيع</li>
                      )}
                      {draftCounts.purchases > 0 && (
                        <li>{draftCounts.purchases} فاتورة شراء</li>
                      )}
                      {draftCounts.returns > 0 && (
                        <li>{draftCounts.returns} مرتجع</li>
                      )}
                      {draftCounts.expenses > 0 && (
                        <li>{draftCounts.expenses} مصروف</li>
                      )}
                    </ul>
                    <p className="font-medium text-destructive">
                      يجب ترحيل أو إلغاء جميع المسودات قبل إقفال السنة المالية.
                    </p>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-row-reverse gap-2 mt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowClosingDialog(false);
                    setClosingStep(0);
                  }}
                >
                  إغلاق
                </Button>
              </DialogFooter>
            </>
          )}
          {closingStep === 2 && (
            <>
              <DialogHeader>
                <DialogTitle>
                  تأكيد إقفال السنة المالية {fiscalYear.label}
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-4 pt-2">
                    <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>إجمالي الإيرادات</span>
                        <span className="font-mono font-bold text-emerald-600">
                          {formatCurrency(totalRevenue)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>إجمالي المصروفات</span>
                        <span className="font-mono font-bold text-red-600">
                          {formatCurrency(totalExpenses)}
                        </span>
                      </div>
                      <div className="border-t pt-2 flex justify-between font-bold">
                        <span>
                          {netIncome >= 0 ? "صافي الربح" : "صافي الخسارة"}
                        </span>
                        <span
                          className={cn(
                            "font-mono",
                            netIncome >= 0
                              ? "text-emerald-600"
                              : "text-destructive",
                          )}
                        >
                          {formatCurrency(netIncome)}
                        </span>
                      </div>
                    </div>
                    <div className="text-sm space-y-1">
                      <p>
                        سيتم إنشاء قيد إقفال بتاريخ{" "}
                        <span className="font-bold">{fiscalYear.endDate}</span>:
                      </p>
                      <ul className="list-disc list-inside mr-3 space-y-0.5">
                        <li>
                          تصفير {revenueAccounts.length} حساب إيرادات (مدين)
                        </li>
                        <li>
                          تصفير {expenseAccounts.length} حساب مصروفات (دائن)
                        </li>
                        <li>
                          ترحيل {netIncome >= 0 ? "الربح" : "الخسارة"} إلى
                          الأرباح المحتجزة ({ACCOUNT_CODES.RETAINED_EARNINGS})
                        </li>
                      </ul>
                    </div>
                    <p className="text-destructive font-bold text-sm">
                      ⚠ هذا الإجراء لا يمكن التراجع عنه بسهولة. هل أنت متأكد؟
                    </p>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-row-reverse gap-2 mt-4">
                <Button onClick={executeClosing} className="bg-primary">
                  تأكيد الإقفال
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowClosingDialog(false);
                    setClosingStep(0);
                  }}
                >
                  إلغاء
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
