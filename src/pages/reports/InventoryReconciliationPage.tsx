import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Info,
  RefreshCw,
} from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { CreateInventoryRepairDialog } from "@/components/inventory-reconciliation/CreateInventoryRepairDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSettings } from "@/contexts/SettingsContext";
import { useDebouncedValue } from "@/hooks/use-paged-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, formatNumber } from "@/lib/format";
import {
  inventoryClassificationLabel,
  formatInventorySourceNumber,
  getInventorySourcePath,
  inventoryReasonLabel,
  inventoryReconciliationStatusLabel,
  inventorySourceStatusLabel,
  inventorySourceTypeLabel,
  isReconciliationSnapshotStale,
  parseInventoryReconciliationDiagnostic,
  type InventoryReconciliationDiagnostic,
  type InventoryReconciliationProductRow,
  type InventoryReconciliationSection,
  type InventoryReconciliationSourceRow,
  type InventoryReconciliationStatus,
  type InventoryDocumentPrefixes,
} from "@/lib/inventory-reconciliation-diagnostic";
import { notify } from "@/lib/notify";
import { formatProductDisplay } from "@/lib/product-utils";
import { canPrepareInventoryRepairDraft } from "@/lib/inventory-reconciliation-repair";
import { loadInventoryProductIdentities } from "@/lib/inventory-reconciliation-product-identity";

const PAGE_SIZE = 50;

const statusClasses: Record<InventoryReconciliationStatus, string> = {
  matched: "border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-950/20",
  rounding_only: "border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20",
  mismatch: "border-destructive/50 bg-destructive/5",
  unavailable: "border-muted-foreground/30 bg-muted/40",
};

const classificationVariant = (classification: string) =>
  classification === "matched"
    ? "secondary"
    : classification === "rounding"
      ? "outline"
      : "destructive";

const sourceLabel = (
  row: InventoryReconciliationSourceRow,
  prefixes: InventoryDocumentPrefixes,
) => {
  const type = inventorySourceTypeLabel[row.sourceType] ?? row.sourceType;
  const number = formatInventorySourceNumber(row, prefixes);
  return number === type ? type : `${type} ${number}`;
};

const rowReasons = (reasonCodes: string[]) =>
  reasonCodes.map((reason) => inventoryReasonLabel[reason] ?? reason).join(" • ");

export default function InventoryReconciliationPage() {
  const { formatCurrency, settings } = useSettings();
  const requestId = useRef(0);
  const fingerprintRef = useRef<string | null>(null);

  const [section, setSection] = useState<InventoryReconciliationSection>("products");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [diagnostic, setDiagnostic] = useState<InventoryReconciliationDiagnostic | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [repairTarget, setRepairTarget] = useState<InventoryReconciliationProductRow | InventoryReconciliationSourceRow | null>(null);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setErrorMessage(null);

      const fetchPage = async (expectedFingerprint?: string) => {
        const { data, error } = await supabase.rpc("get_inventory_reconciliation_diagnostic", {
          p_section: section,
          p_only_issues: onlyIssues,
          p_search: debouncedSearch.trim() || undefined,
          p_limit: PAGE_SIZE,
          p_offset: pageIndex * PAGE_SIZE,
          p_expected_fingerprint: expectedFingerprint,
        });
        if (error) throw error;
        const parsed = parseInventoryReconciliationDiagnostic(data);
        if (section !== "products") return parsed;
        const identities = await loadInventoryProductIdentities(
          parsed.rows.flatMap((row) => row.kind === "product" ? [row.productId] : []),
        );
        return {
          ...parsed,
          rows: parsed.rows.map((row) => row.kind === "product"
            ? { ...row, ...identities.get(row.productId) }
            : row),
        };
      };

      try {
        let result: InventoryReconciliationDiagnostic;
        try {
          result = await fetchPage(fingerprintRef.current ?? undefined);
        } catch (error) {
          if (!isReconciliationSnapshotStale(error)) throw error;
          result = await fetchPage();
          if (!cancelled && currentRequest === requestId.current) {
            notify.info("تغيرت بيانات المخزون", "تم تحديث التقرير إلى أحدث لقطة تلقائياً.");
          }
        }

        if (cancelled || currentRequest !== requestId.current) return;
        setDiagnostic(result);
        fingerprintRef.current = result.fingerprint;
      } catch (error) {
        if (cancelled || currentRequest !== requestId.current) return;
        const message = error instanceof Error ? error.message : "تعذر قراءة تشخيص مطابقة المخزون";
        setDiagnostic(null);
        setErrorMessage(message);
        notify.dbError("تعذر تحميل مطابقة المخزون", error, message);
      } finally {
        if (!cancelled && currentRequest === requestId.current) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [section, onlyIssues, debouncedSearch, pageIndex, refreshVersion]);

  const resetSnapshot = () => {
    setPageIndex(0);
    fingerprintRef.current = null;
  };

  const changeSection = (value: string) => {
    setSection(value as InventoryReconciliationSection);
    setSearch("");
    resetSnapshot();
  };

  const changeIssuesFilter = () => {
    setOnlyIssues((value) => !value);
    resetSnapshot();
  };

  const refresh = () => {
    fingerprintRef.current = null;
    setRefreshVersion((value) => value + 1);
  };

  const productRows = (diagnostic?.rows ?? []).filter(
    (row): row is InventoryReconciliationProductRow => row.kind === "product",
  );
  const sourceRows = (diagnostic?.rows ?? []).filter(
    (row): row is InventoryReconciliationSourceRow => row.kind === "source",
  );
  const totalCount = diagnostic?.page.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const totals = diagnostic?.totals;
  const status = diagnostic?.status ?? "unavailable";
  const sourcePrefixes: InventoryDocumentPrefixes = {
    salesInvoice: settings?.sales_invoice_prefix || "INV-",
    purchaseInvoice: settings?.purchase_invoice_prefix || "PUR-",
    salesReturn: settings?.sales_return_prefix || "SRN-",
    purchaseReturn: settings?.purchase_return_prefix || "PRN-",
    journalEntry: settings?.journal_entry_prefix || "JV-",
  };

  useEffect(() => {
    setPageIndex(0);
    fingerprintRef.current = null;
  }, [debouncedSearch]);

  return (
    <div className="space-y-5" dir="rtl">
      <PageHeader
        icon={RefreshCw}
        title="مطابقة المخزون (تشخيصية)"
        description="مقارنة موحدة وآمنة بين بطاقة المنتج وحركات المخزون وحساب 1104، دون إجراء أي تعديل على البيانات"
        actions={(
          <Button asChild variant="outline">
            <Link to="/reports/inventory-reconciliation/repairs">
              <ClipboardList className="ml-2 h-4 w-4" />
              سجل المعالجات
            </Link>
          </Button>
        )}
      />

      {totals && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">قيمة المخزون من الحركات</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(totals.movementBookValue)}</div>
                <p className="mt-1 text-xs text-muted-foreground">القيمة الدفترية المستخرجة من جميع الحركات</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">رصيد حساب المخزون 1104</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(totals.ledger1104Balance)}</div>
                <p className="mt-1 text-xs text-muted-foreground">من القيود اليومية المرحّلة</p>
              </CardContent>
            </Card>

            <Card className={statusClasses[status]}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                  {status === "matched" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : status === "rounding_only" ? (
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  )}
                  فرق 1104 عن الحركات
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(totals.movementToLedgerDifference)}</div>
                <p className="mt-1 text-xs">{inventoryReconciliationStatusLabel[status]}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">سلامة الكميات والمصادر</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-3 text-2xl font-bold">
                  <span>{totals.productIssueCount}</span>
                  <span className="text-sm font-normal text-muted-foreground">منتجات</span>
                  <span>{totals.sourceIssueCount}</span>
                  <span className="text-sm font-normal text-muted-foreground">مصادر</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  فرق الكمية: {formatNumber(totals.quantityDifference)} • غير مرتبط: {totals.unlinkedMovementCount + totals.unlinkedJournalCount}
                </p>
              </CardContent>
            </Card>
          </div>

          <Alert className="border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
              <div>
                <AlertTitle>تقييم WAC معلومة تحليلية وليس اختبار سلامة</AlertTitle>
                <AlertDescription className="text-muted-foreground">
                  تقييم WAC الحالي {formatCurrency(totals.wacValuation)}، والفرق عن القيمة الدفترية للحركات {formatCurrency(totals.wacToMovementDifference)}. لا يُصنف هذا الفرق وحده كمنتج غير متطابق ولا يُستخدم لتغيير الكمية.
                </AlertDescription>
              </div>
            </div>
          </Alert>
        </>
      )}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs value={section} onValueChange={changeSection} dir="rtl">
              <TabsList>
                <TabsTrigger value="products">
                  المنتجات {totals ? `(${totals.productIssueCount} مشكلة)` : ""}
                </TabsTrigger>
                <TabsTrigger value="sources">
                  المصادر والمستندات {totals ? `(${totals.sourceIssueCount} ملاحظة)` : ""}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                placeholder={section === "products" ? "بحث بكود المنتج أو اسمه..." : "بحث بنوع المصدر أو رقمه..."}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full sm:w-72"
              />
              <Button variant={onlyIssues ? "default" : "outline"} size="sm" onClick={changeIssuesFilter}>
                {onlyIssues ? "عرض جميع السجلات" : "الملاحظات فقط"}
              </Button>
              <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                <RefreshCw className={`ml-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                تحديث
              </Button>
            </div>
          </div>

          {errorMessage ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>تعذر تحميل التقرير</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : loading && !diagnostic ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className={`overflow-x-auto rounded-md border ${loading ? "opacity-60" : ""}`}>
                {section === "products" ? (
                  <ProductsTable rows={productRows} formatCurrency={formatCurrency} onlyIssues={onlyIssues} onPrepare={setRepairTarget} />
                ) : (
                  <SourcesTable
                    rows={sourceRows}
                    formatCurrency={formatCurrency}
                    onlyIssues={onlyIssues}
                    prefixes={sourcePrefixes}
                    onPrepare={setRepairTarget}
                  />
                )}
              </div>

              <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {totalCount.toLocaleString("en-US")} سجل • لقطة {diagnostic ? formatDate(diagnostic.snapshotAt) : "—"}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="الصفحة السابقة"
                    disabled={pageIndex === 0 || loading}
                    onClick={() => setPageIndex((value) => Math.max(0, value - 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <span className="min-w-24 text-center">صفحة {pageIndex + 1} من {pageCount}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="الصفحة التالية"
                    disabled={pageIndex + 1 >= pageCount || loading}
                    onClick={() => setPageIndex((value) => value + 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <CreateInventoryRepairDialog
        open={repairTarget !== null}
        onOpenChange={(open) => !open && setRepairTarget(null)}
        row={repairTarget}
        rowLabel={repairTarget?.kind === "product"
          ? formatProductDisplay(
            repairTarget.name,
            repairTarget.brandName,
            repairTarget.modelNumber,
            repairTarget.code,
          )
          : repairTarget ? sourceLabel(repairTarget, sourcePrefixes) : ""}
        diagnostic={diagnostic}
      />
    </div>
  );
}

function ProductsTable({
  rows,
  formatCurrency,
  onlyIssues,
  onPrepare,
}: {
  rows: InventoryReconciliationProductRow[];
  formatCurrency: (value: number) => string;
  onlyIssues: boolean;
  onPrepare: (row: InventoryReconciliationProductRow) => void;
}) {
  if (rows.length === 0) {
    return <EmptyDiagnostic message={onlyIssues ? "لا توجد مشاكل سلامة في أرصدة المنتجات." : "لا توجد منتجات ضمن نطاق البحث."} />;
  }

  return (
    <Table className="[&_th]:h-9 [&_th]:px-3 [&_td]:px-3 [&_td]:py-1.5">
      <TableHeader>
        <TableRow>
          <TableHead>المنتج</TableHead>
          <TableHead className="text-center">كمية البطاقة</TableHead>
          <TableHead className="text-center">صافي الحركات</TableHead>
          <TableHead className="text-center">فرق الكمية</TableHead>
          <TableHead className="text-center">قيمة الحركات</TableHead>
          <TableHead className="text-center">تقييم WAC</TableHead>
          <TableHead className="text-center">فرق تحليلي</TableHead>
          <TableHead>حالة السلامة</TableHead>
          <TableHead className="w-32">الإجراء</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.productId}>
            <TableCell>
              <div className="min-w-52 whitespace-nowrap font-medium">
                {formatProductDisplay(row.name, row.brandName, row.modelNumber, row.code)}
              </div>
            </TableCell>
            <TableCell className="text-center">{formatNumber(row.cardQuantity)}</TableCell>
            <TableCell className="text-center">{formatNumber(row.movementQuantity)}</TableCell>
            <TableCell className="text-center">
              {row.quantityDifference === 0 ? <span className="text-muted-foreground">0</span> : <Badge variant="destructive">{formatNumber(row.quantityDifference)}</Badge>}
            </TableCell>
            <TableCell className="text-center">{formatCurrency(row.movementBookValue)}</TableCell>
            <TableCell className="text-center">{formatCurrency(row.wacValuation)}</TableCell>
            <TableCell className="text-center text-muted-foreground">{formatCurrency(row.wacToMovementDifference)}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <Badge variant={classificationVariant(row.classification)}>
                  {inventoryClassificationLabel[row.classification] ?? row.classification}
                </Badge>
                {row.reasonCodes.length > 0 && (
                  <span className="max-w-40 truncate text-xs text-muted-foreground" title={rowReasons(row.reasonCodes)}>
                    {rowReasons(row.reasonCodes)}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell>
              {canPrepareInventoryRepairDraft(row) ? (
                <Button size="sm" variant="outline" onClick={() => onPrepare(row)}>إعداد مسودة</Button>
              ) : <span className="text-muted-foreground">—</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SourcesTable({
  rows,
  formatCurrency,
  onlyIssues,
  prefixes,
  onPrepare,
}: {
  rows: InventoryReconciliationSourceRow[];
  formatCurrency: (value: number) => string;
  onlyIssues: boolean;
  prefixes: InventoryDocumentPrefixes;
  onPrepare: (row: InventoryReconciliationSourceRow) => void;
}) {
  if (rows.length === 0) {
    return <EmptyDiagnostic message={onlyIssues ? "لا توجد ملاحظات في روابط المستندات والقيود والحركات." : "لا توجد مصادر ضمن نطاق البحث."} />;
  }

  return (
    <Table className="[&_th]:h-9 [&_th]:px-3 [&_td]:px-3 [&_td]:py-1.5">
      <TableHeader>
        <TableRow>
          <TableHead>المصدر</TableHead>
          <TableHead>التاريخ / الحالة</TableHead>
          <TableHead className="text-center">الحركات</TableHead>
          <TableHead className="text-center">قيمة الحركات</TableHead>
          <TableHead className="text-center">أثر 1104</TableHead>
          <TableHead className="text-center">الفرق</TableHead>
          <TableHead>التشخيص</TableHead>
          <TableHead className="w-32">الإجراء</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const sourcePath = getInventorySourcePath(row);
          return (
          <TableRow key={row.sourceKey}>
            <TableCell>
              {sourcePath ? (
                <Link to={sourcePath} className="font-medium text-primary underline-offset-4 hover:underline">
                  {sourceLabel(row, prefixes)}
                </Link>
              ) : (
                <div className="font-medium">{sourceLabel(row, prefixes)}</div>
              )}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span>{formatDate(row.sourceDate)}</span>
                <span className="text-xs text-muted-foreground">
                {row.sourceStatus ? inventorySourceStatusLabel[row.sourceStatus] ?? row.sourceStatus : "—"}
                </span>
              </div>
            </TableCell>
            <TableCell className="text-center">
              <span className="whitespace-nowrap">{row.movementCount.toLocaleString("en-US")}</span>
              <span className="mr-2 whitespace-nowrap text-xs text-muted-foreground">صافي {formatNumber(row.movementQuantity)}</span>
            </TableCell>
            <TableCell className="text-center">{formatCurrency(row.movementBookValue)}</TableCell>
            <TableCell className="text-center">{formatCurrency(row.ledger1104Value)}</TableCell>
            <TableCell className="text-center">
              <span className={row.sourceDifference === 0 ? "text-muted-foreground" : "font-semibold text-amber-700 dark:text-amber-400"}>
                {formatCurrency(row.sourceDifference)}
              </span>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <Badge variant={classificationVariant(row.classification)}>
                  {inventoryClassificationLabel[row.classification] ?? row.classification}
                </Badge>
                {row.reasonCodes.length > 0 && (
                  <span className="max-w-40 truncate text-xs text-muted-foreground" title={rowReasons(row.reasonCodes)}>
                    {rowReasons(row.reasonCodes)}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell>
              {canPrepareInventoryRepairDraft(row) ? (
                <Button size="sm" variant="outline" onClick={() => onPrepare(row)}>إعداد مسودة</Button>
              ) : <span className="text-muted-foreground">—</span>}
            </TableCell>
          </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function EmptyDiagnostic({ message }: { message: string }) {
  return (
    <div className="p-12 text-center text-muted-foreground">
      <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-600" />
      {message}
    </div>
  );
}
