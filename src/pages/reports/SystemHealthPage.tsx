import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  HelpCircle,

  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatCard, StatGrid } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { useSettings } from "@/contexts/SettingsContext";
import { ACCOUNT_CODES, BALANCE_TOLERANCE } from "@/lib/constants";
import { ReportPurposeBar } from "@/components/shared/ReportPurposeBar";
import {
  checkDocumentsHaveJournal,
  checkEntityBalances,
  checkInventoryValue,
  checkJournalBalance,
  checkMovementsHaveSource,
  checkOrphanEntries,
  checkPostedNumberSequence,
  checkProductQuantities,
  checkTrialBalance,
  computeEntityBalanceDetails,
  summarizeChecks,
  type CheckResult,
} from "@/lib/reconciliation";


const num = (v: unknown) => Number(v ?? 0);

/** جلب كل الصفوف على دفعات (تجاوز حد 1000 صف) */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  chunk = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 60; page += 1) {
    const from = page * chunk;
    const { data, error } = await build(from, from + chunk - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < chunk) break;
  }
  return out;
}

export default function SystemHealthPage() {
  const { formatCurrency } = useSettings();
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [inventoryValues, setInventoryValues] = useState<{
    ledger: number | null;
    computed: number | null;
  }>({ ledger: null, computed: null });
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [
        products,
        movements,
        entries,
        lines,
        customers,
        suppliers,
        salesInvoices,
        purchaseInvoices,
        salesReturns,
        purchaseReturns,
        customerPayments,
        supplierPayments,
        salesReturnAllocs,
        purchaseReturnAllocs,
        balancesRes,
        valuationRes,
      ] = await Promise.all([
        fetchAll<any>((f, t) =>
          supabase
            .from("products")
            .select("id, code, name, quantity_on_hand, purchase_price, is_active")
            .range(f, t),
        ),
        fetchAll<any>((f, t) =>
          supabase
            .from("inventory_movements")
            .select(
              "id, product_id, movement_type, quantity, total_cost, movement_date, reference_id, reference_type",
            )
            .range(f, t),
        ),

        fetchAll<any>((f, t) =>
          supabase
            .from("journal_entries")
            .select("id, entry_number, posted_number, total_debit, total_credit, status")
            .range(f, t),
        ),
        fetchAll<any>((f, t) =>
          supabase
            .from("journal_entry_lines")
            .select("journal_entry_id, debit, credit")
            .range(f, t),
        ),
        fetchAll<any>((f, t) =>
          supabase.from("customers").select("id, code, name, balance, opening_balance").range(f, t),
        ),
        fetchAll<any>((f, t) =>
          supabase.from("suppliers").select("id, code, name, balance, opening_balance").range(f, t),
        ),
        fetchAll<any>((f, t) =>
          supabase
            .from("sales_invoices")
            .select("id, customer_id, total, status, posted_number, journal_entry_id")
            .range(f, t),
        ),
        fetchAll<any>((f, t) =>
          supabase
            .from("purchase_invoices")
            .select("id, supplier_id, total, status, posted_number, journal_entry_id")
            .range(f, t),
        ),
        fetchAll<any>((f, t) =>
          supabase
            .from("sales_returns")
            .select("id, customer_id, total, status, posted_number, journal_entry_id")
            .range(f, t),
        ),
        fetchAll<any>((f, t) =>
          supabase
            .from("purchase_returns")
            .select("id, supplier_id, total, status, posted_number, journal_entry_id")
            .range(f, t),
        ),

        fetchAll<any>((f, t) =>
          supabase
            .from("customer_payments")
            .select("id, customer_id, amount, status, posted_number")
            .range(f, t),
        ),
        fetchAll<any>((f, t) =>
          supabase
            .from("supplier_payments")
            .select("id, supplier_id, amount, status, posted_number")
            .range(f, t),
        ),
        fetchAll<any>((f, t) =>
          supabase
            .from("sales_return_payment_allocations")
            .select("payment_id, allocated_amount")
            .range(f, t),
        ),
        fetchAll<any>((f, t) =>
          supabase
            .from("purchase_return_payment_allocations")
            .select("payment_id, allocated_amount")
            .range(f, t),
        ),
        (supabase.rpc as any)("get_account_balances", { p_only_with_activity: false }),
        (supabase.rpc as any)("get_inventory_valuation", {
          p_as_of: new Date().toISOString().slice(0, 10),
        }),
      ]);

      // ── أرصدة دفتر الأستاذ: الدالة تُعيد المصفوفة تحت المفتاح rows
      const payload = balancesRes?.data;
      const balanceRows: any[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.rows)
          ? payload.rows
          : Array.isArray(payload?.accounts)
            ? payload.accounts
            : [];
      const inventoryRow = balanceRows.find(
        (r: any) => String(r.code ?? r.account_code) === ACCOUNT_CODES.INVENTORY,
      );
      // لا نستخدم || لأنها تبتلع الرصيد الصفري الصحيح
      const ledgerInventory: number | null = inventoryRow
        ? num(inventoryRow.debit) - num(inventoryRow.credit)
        : null;

      const totalDebit =
        payload && payload.total_debit !== undefined && payload.total_debit !== null
          ? num(payload.total_debit)
          : balanceRows.length > 0
            ? balanceRows.reduce((s: number, r: any) => s + num(r.debit), 0)
            : null;
      const totalCredit =
        payload && payload.total_credit !== undefined && payload.total_credit !== null
          ? num(payload.total_credit)
          : balanceRows.length > 0
            ? balanceRows.reduce((s: number, r: any) => s + num(r.credit), 0)
            : null;

      // ── قيمة المخزون من نفس مصدر تقرير التقييم (WAC)
      const valuation = valuationRes?.data as any;
      const computedInventory =
        valuation && valuation.total_value !== undefined && valuation.total_value !== null
          ? num(valuation.total_value)
          : null;

      const posted = (rows: any[]) => rows.filter((r) => r.status === "posted");
      const postedEntries = posted(entries);

      const openingMap = (rows: any[]) =>
        new Map<string, number>(rows.map((r) => [r.id, num(r.opening_balance)]));

      const customerDetails = computeEntityBalanceDetails({
        openingBalances: openingMap(customers),
        invoices: posted(salesInvoices).map((r) => ({
          entity_id: r.customer_id,
          total: r.total,
        })),
        returns: posted(salesReturns).map((r) => ({
          entity_id: r.customer_id,
          total: r.total,
        })),
        payments: posted(customerPayments).map((r) => ({
          id: r.id,
          entity_id: r.customer_id,
          amount: r.amount,
        })),
        returnAllocations: salesReturnAllocs,
      });

      const supplierDetails = computeEntityBalanceDetails({
        openingBalances: openingMap(suppliers),
        invoices: posted(purchaseInvoices).map((r) => ({
          entity_id: r.supplier_id,
          total: r.total,
        })),
        returns: posted(purchaseReturns).map((r) => ({
          entity_id: r.supplier_id,
          total: r.total,
        })),
        payments: posted(supplierPayments).map((r) => ({
          id: r.id,
          entity_id: r.supplier_id,
          amount: r.amount,
        })),
        returnAllocations: purchaseReturnAllocs,
      });

      const expectedFrom = (m: Map<string, { expected: number }>) =>
        new Map<string, number>([...m].map(([id, b]) => [id, b.expected]));

      const inventoryCheck = checkInventoryValue({
        computedValue: computedInventory,
        ledgerBalance: ledgerInventory,
        productsChecked: products.length,
      });
      setInventoryValues({
        ledger: inventoryCheck.ledgerValue,
        computed: inventoryCheck.computedValue,
      });

      const productLabel = new Map<string, string>(
        products.map((p: any) => [p.id, `[${p.code}] ${p.name}`]),
      );

      const docLabel = (prefix: string, r: any) =>
        `${prefix} #${r.posted_number ?? "بلا رقم"}`;

      setChecks([
        inventoryCheck,
        checkTrialBalance(totalDebit, totalCredit),
        checkProductQuantities(products, movements),
        checkJournalBalance(postedEntries, lines),
        checkOrphanEntries(postedEntries, lines),
        checkEntityBalances(
          customers,
          expectedFrom(customerDetails),
          "customer",
          undefined,
          customerDetails,
        ),
        checkEntityBalances(
          suppliers,
          expectedFrom(supplierDetails),
          "supplier",
          undefined,
          supplierDetails,
        ),
        checkDocumentsHaveJournal(
          salesInvoices.map((r: any) => ({
            id: r.id,
            label: docLabel("فاتورة بيع", r),
            status: r.status,
            journal_entry_id: r.journal_entry_id,
            link: `/sales/invoices/${r.id}`,
          })),
          "فواتير البيع",
        ),
        checkDocumentsHaveJournal(
          purchaseInvoices.map((r: any) => ({
            id: r.id,
            label: docLabel("فاتورة شراء", r),
            status: r.status,
            journal_entry_id: r.journal_entry_id,
            link: `/purchases/invoices/${r.id}`,
          })),
          "فواتير الشراء",
        ),
        checkDocumentsHaveJournal(
          [...salesReturns, ...purchaseReturns].map((r: any) => ({
            id: r.id,
            label: docLabel("مرتجع", r),
            status: r.status,
            journal_entry_id: r.journal_entry_id,
          })),
          "المرتجعات",
        ),
        checkMovementsHaveSource(
          movements.map((m: any) => ({
            id: m.id,
            product_label: productLabel.get(m.product_id) ?? null,
            reference_id: m.reference_id,
            reference_type: m.reference_type,
            movement_type: m.movement_type,
            movement_date: m.movement_date,
          })),
        ),
        checkPostedNumberSequence(salesInvoices, "فواتير البيع"),
        checkPostedNumberSequence(purchaseInvoices, "فواتير الشراء"),
        checkPostedNumberSequence(entries, "القيود"),
      ]);

      setLastRun(new Date());
    } catch (error) {
      notify.dbError("تعذّر تشغيل فحوص سلامة البيانات", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => summarizeChecks(checks), [checks]);

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        icon={ShieldCheck}
        title="سلامة البيانات"
        description="فحوص تلقائية تكشف أي انحراف بين المستندات والأرصدة والمخزون"
        badge={
          lastRun ? (
            <Badge variant="outline" className="font-normal">
              آخر فحص {lastRun.toLocaleTimeString("en-GB")}
            </Badge>
          ) : undefined
        }
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 ml-2", loading && "animate-spin")} />
            إعادة الفحص
          </Button>
        }
      />

      {loading ? (
        <LoadingState />
      ) : checks.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="لم يتم تشغيل الفحوص"
          description="اضغط إعادة الفحص لبدء تحليل سلامة البيانات."
        />
      ) : (
        <>
          <ReportPurposeBar
            what="فحوص مطابقة بين المستندات والقيود والمخزون وأرصدة العملاء والموردين، مع بيان السجلات المسبّبة لكل انحراف."
            decision="تحديد ما يحتاج تصحيحًا فعليًا قبل الاعتماد على التقارير المالية أو إغلاق الفترة."
            basis="القيود المرحّلة فقط + حركات المخزون + تقييم WAC من دالة تقييم المخزون (نفس مصدر تقرير التقييم)."
            note={`حد التسامح لتوازن القيود وبقية الفروق المالية والكميات ${BALANCE_TOLERANCE.toFixed(2)}، ولمطابقة قيمة المخزون 1.00. الفحوص التي لا يتوفّر مصدر بياناتها تُعرض كـ «تعذّر الفحص» ولا تُحسب انحرافًا.${
              lastRun ? ` آخر فحص: ${lastRun.toLocaleString("en-GB")}.` : ""
            }`}
          />

          <StatGrid>
            <StatCard
              icon={summary.healthy ? CheckCircle2 : AlertTriangle}
              tone={summary.healthy ? "emerald" : summary.errors > 0 ? "red" : "amber"}
              label="الحالة العامة"
              value={
                summary.healthy
                  ? "سليم"
                  : summary.errors > 0
                    ? "يحتاج تصحيحًا"
                    : "ملاحظات"
              }
              sub={`${summary.passed} من ${summary.total} فحص مطابق`}
              hint="يظهر «سليم» فقط عند نجاح جميع الفحوص بلا تحذيرات أو فحوص متعذّرة."
            />
            <StatCard
              icon={XCircle}
              tone="red"
              label="انحرافات حرجة"
              value={summary.errors}
              sub={`${summary.totalIssues} سجل مسبّب`}
            />
            <StatCard
              icon={AlertTriangle}
              tone="amber"
              label="تحذيرات وملاحظات"
              value={summary.warnings + summary.info}
              sub={
                summary.unavailable > 0
                  ? `${summary.unavailable} فحص تعذّر تنفيذه`
                  : "فروق محدودة أو معلومات ترقيم"
              }
            />
            <StatCard
              icon={Activity}
              tone="blue"
              label="قيمة المخزون (WAC)"
              value={
                inventoryValues.computed === null
                  ? "غير متاح"
                  : formatCurrency(inventoryValues.computed)
              }
              sub={`الدفتر (1104): ${
                inventoryValues.ledger === null
                  ? "غير متاح"
                  : formatCurrency(inventoryValues.ledger)
              }`}
              hint="قيمة التقييم بمتوسط التكلفة المرجّح مقابل رصيد حساب المخزون في دفتر الأستاذ."
            />
          </StatGrid>

          <div className="space-y-3">
            {checks.map((check) => (
              <CheckCard key={check.key} check={check} formatCurrency={formatCurrency} />
            ))}

          </div>
        </>
      )}
    </div>
  );
}

const TONE: Record<
  string,
  { border: string; chip: string; badge: "outline" | "secondary" | "destructive"; label: string }
> = {
  ok: {
    border: "border-border",
    chip: "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    badge: "outline",
    label: "مطابق",
  },
  info: {
    border: "border-sky-300 dark:border-sky-500/40",
    chip: "bg-sky-100 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400",
    badge: "secondary",
    label: "للعلم فقط",
  },
  warning: {
    border: "border-amber-300 dark:border-amber-500/40",
    chip: "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400",
    badge: "secondary",
    label: "تحذير",
  },
  error: {
    border: "border-red-300 dark:border-red-500/40",
    chip: "bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400",
    badge: "destructive",
    label: "انحراف",
  },
  unavailable: {
    border: "border-border",
    chip: "bg-muted text-muted-foreground",
    badge: "outline",
    label: "تعذّر الفحص",
  },
};

function CheckCard({
  check,
  formatCurrency,
}: {
  check: CheckResult;
  formatCurrency: (v: number) => string;
}) {
  const [open, setOpen] = useState(check.severity === "error");
  const tone = TONE[check.severity] ?? TONE.ok;
  const isOk = check.severity === "ok";
  const isUnavailable = check.severity === "unavailable";
  const Icon = isOk
    ? CheckCircle2
    : isUnavailable
      ? HelpCircle
      : check.severity === "error"
        ? XCircle
        : AlertTriangle;

  const fmt = (v: number | string | undefined, unit?: string) => {
    if (v === undefined || v === null) return "—";
    if (typeof v !== "number") return v;
    if (unit === "currency") return formatCurrency(v);
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v);
  };

  return (
    <Card className={cn("rounded-xl overflow-hidden border", tone.border)}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-start gap-3 p-4 text-right hover:bg-muted/40 transition-colors"
            disabled={isOk}
          >
            <span
              className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                tone.chip,
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground">{check.title}</span>
                <Badge variant={tone.badge} className="font-normal">
                  {isOk || isUnavailable
                    ? tone.label
                    : `${check.issues.length} ${tone.label}`}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  ({new Intl.NumberFormat("en-US").format(check.checked)} سجل مفحوص)
                </span>
              </span>
              <span className="block text-sm text-muted-foreground mt-1 leading-relaxed">
                {isUnavailable ? check.unavailableReason : check.meaning}
              </span>
            </span>
            {!isOk && (
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground shrink-0 mt-2 transition-transform",
                  open && "rotate-180",
                )}
              />
            )}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-3">
            {(check.formula || check.action) && (
              <div className="rounded-lg bg-muted/40 p-3 text-xs space-y-1">
                {check.formula && (
                  <p>
                    <span className="text-muted-foreground">طريقة الحساب: </span>
                    {check.formula}
                  </p>
                )}
                {check.action && !isUnavailable && check.issues.length > 0 && (
                  <p>
                    <span className="text-muted-foreground">الإجراء المقترح: </span>
                    {check.action}
                  </p>
                )}
              </div>
            )}

            {check.issues.length > 0 && (
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-right">السجل</TableHead>
                      <TableHead className="text-right">المتوقع</TableHead>
                      <TableHead className="text-right">الفعلي</TableHead>
                      <TableHead className="text-right">الفرق</TableHead>
                      <TableHead className="text-right w-24">المستند</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {check.issues.slice(0, 100).map((issue, i) => (
                      <TableRow key={`${issue.id}-${i}`}>
                        <TableCell className="font-medium">
                          {issue.label}
                          {issue.note && (
                            <span className="block text-xs text-muted-foreground font-normal mt-0.5">
                              {issue.note}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {fmt(issue.expected, issue.unit)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {fmt(issue.actual, issue.unit)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "tabular-nums font-semibold",
                            (issue.diff ?? 0) !== 0 &&
                              check.severity === "error" &&
                              "text-red-600 dark:text-red-400",
                          )}
                        >
                          {issue.diff === undefined ? "—" : fmt(issue.diff, issue.unit)}
                        </TableCell>
                        <TableCell>
                          {issue.link ? (
                            <Button asChild variant="ghost" size="sm">
                              <Link to={issue.link}>
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {check.issues.length > 100 && (
              <p className="text-xs text-muted-foreground">
                يتم عرض أول 100 سجل من {check.issues.length}.
              </p>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>

    </Card>
  );
}
