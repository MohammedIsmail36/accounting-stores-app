import { useEffect, useMemo, useState } from "react";
import { ColumnDef, PaginationState } from "@tanstack/react-table";
import { ClipboardList, Info, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue, usePagedQuery } from "@/hooks/use-paged-query";
import { formatDate } from "@/lib/format";
import {
  inventoryRepairNumber,
  inventoryRepairStatusClass,
  inventoryRepairStatusLabel,
  parseInventoryRepairListRow,
  type InventoryRepairListRow,
  type InventoryRepairStatus,
} from "@/lib/inventory-reconciliation-repair";

const PAGE_SIZE = 20;
const ALL_STATUSES = "all";

export default function InventoryReconciliationRepairsPage() {
  const navigate = useNavigate();
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(ALL_STATUSES);
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    setPagination((value) => ({ ...value, pageIndex: 0 }));
  }, [debouncedSearch, status]);

  const queryKey = [
    "inventory-reconciliation-repairs",
    pagination.pageIndex,
    pagination.pageSize,
    debouncedSearch,
    status,
  ] as const;

  const { data, isLoading, isFetching, refetch } = usePagedQuery<InventoryRepairListRow>(
    queryKey,
    async () => {
      const from = pagination.pageIndex * pagination.pageSize;
      const to = from + pagination.pageSize - 1;
      let query = (supabase.from("inventory_reconciliation_repairs" as any) as any)
        .select(
          "id, repair_number, status, title, explanation, version, prepared_at, submitted_at, approved_at, updated_at",
          { count: "exact" },
        );

      if (status !== ALL_STATUSES) query = query.eq("status", status);

      const term = debouncedSearch.trim();
      if (term) {
        const numericSearch = Number(term.replace(/^IR-/i, ""));
        query = Number.isSafeInteger(numericSearch) && numericSearch > 0
          ? query.eq("repair_number", numericSearch)
          : query.ilike("title", `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
      }

      const result = await query
        .order("repair_number", { ascending: false })
        .range(from, to);
      if (result.error) throw result.error;

      return {
        rows: (result.data ?? []).map(parseInventoryRepairListRow),
        totalCount: result.count ?? 0,
      };
    },
  );

  const columns = useMemo<ColumnDef<InventoryRepairListRow, unknown>[]>(() => [
    {
      accessorKey: "repairNumber",
      header: ({ column }) => <DataTableColumnHeader column={column} title="رقم المعالجة" />,
      cell: ({ row }) => (
        <span className="font-mono font-semibold tabular-nums text-primary">
          {inventoryRepairNumber(row.original.repairNumber)}
        </span>
      ),
    },
    {
      accessorKey: "title",
      header: "الموضوع",
      cell: ({ row }) => (
        <div className="max-w-md">
          <div className="font-medium">{row.original.title}</div>
          <div className="truncate text-xs text-muted-foreground">{row.original.explanation}</div>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "الحالة",
      cell: ({ row }) => (
        <Badge variant="outline" className={inventoryRepairStatusClass[row.original.status]}>
          {inventoryRepairStatusLabel[row.original.status]}
        </Badge>
      ),
    },
    {
      accessorKey: "preparedAt",
      header: ({ column }) => <DataTableColumnHeader column={column} title="تاريخ الإعداد" />,
      cell: ({ row }) => <span className="text-sm">{formatDate(row.original.preparedAt)}</span>,
      meta: { hideOnMobile: true },
    },
    {
      accessorKey: "version",
      header: "الإصدار",
      cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.version}</span>,
      meta: { hideOnMobile: true },
    },
  ], []);

  const totalCount = data?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pagination.pageSize));

  return (
    <div className="space-y-5" dir="rtl">
      <PageHeader
        icon={ClipboardList}
        title="سجل معالجات مطابقة المخزون"
        description="تتبع المسودات والمراجعات والاعتمادات دون تنفيذ أي تعديل فعلي على المخزون"
        actions={(
          <Button asChild variant="outline">
            <Link to="/reports/inventory-reconciliation">العودة إلى التشخيص</Link>
          </Button>
        )}
      />

      <Alert className="border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20">
        <Info className="h-4 w-4 text-amber-700" />
        <AlertTitle>مرحلة الاعتماد فقط</AlertTitle>
        <AlertDescription>
          التنفيذ المحاسبي والمخزني غير مفعّل في هذه المرحلة؛ اعتماد الطلب لا يغيّر المنتجات أو الحركات أو القيود.
        </AlertDescription>
      </Alert>

      <DataTable
        columns={columns}
        data={data?.rows ?? []}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        searchPlaceholder="بحث برقم المعالجة أو عنوانها..."
        isLoading={isLoading || isFetching}
        emptyMessage="لا توجد طلبات معالجة حتى الآن"
        manualPagination
        pageCount={pageCount}
        totalRows={totalCount}
        pagination={pagination}
        onPaginationChange={setPagination}
        showColumnToggle={false}
        compactRows
        onRowClick={(row) => navigate(`/reports/inventory-reconciliation/repairs/${row.id}`)}
        toolbarContent={(
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Select value={status} onValueChange={setStatus} dir="rtl">
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="كل الحالات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STATUSES}>كل الحالات</SelectItem>
                {(Object.keys(inventoryRepairStatusLabel) as InventoryRepairStatus[]).map((value) => (
                  <SelectItem key={value} value={value}>{inventoryRepairStatusLabel[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              aria-label="تحديث سجل المعالجات"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        )}
      />
    </div>
  );
}
