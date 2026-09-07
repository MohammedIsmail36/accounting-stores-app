import React, { useMemo } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { formatDisplayNumber } from "@/lib/posted-number-utils";
import { INVOICE_STATUS_LABELS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, RotateCcw, Clock, CheckCircle, Ban, DollarSign } from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import { useSettings } from "@/contexts/SettingsContext";
import { DocumentStatsStrip } from "@/components/DocumentStatsStrip";
import { DocumentListFilters } from "@/components/DocumentListFilters";
import { useDocumentList, useDocumentStatusSummary } from "@/hooks/use-document-list";

interface Return {
  id: string;
  return_number: number;
  posted_number: number | null;
  customer_id: string | null;
  customer_name?: string;
  return_date: string;
  status: string;
  total: number;
  reference?: string | null;
}

const fmtNum = (n: number) => Number(n || 0).toLocaleString("en-US");

export default function SalesReturns() {
  const navigate = useNavigate();
  const { settings, formatCurrency } = useSettings();
  const prefix = settings?.sales_return_prefix || "SRN-";

  const list = useDocumentList<Return>({
    queryKey: "sales-returns-list",
    table: "sales_returns",
    select: "*, customers:customer_id(name)",
    dateField: "return_date",
    numberField: "return_number",
    errorMessage: "فشل في تحميل المرتجعات",
    mapRow: (r: any) => ({ ...r, customer_name: r.customers?.name }),
    mapExportRow: (r) => [
      formatDisplayNumber(prefix, r.posted_number, r.return_number, r.status),
      r.reference || "—",
      r.customer_name || "—",
      r.return_date,
      formatCurrency(r.total),
      INVOICE_STATUS_LABELS[r.status] || r.status,
    ],
  });

  const { data: stats } = useDocumentStatusSummary({
    queryKey: "sales-returns-summary",
    table: "sales_returns",
    dateField: "return_date",
    dateFrom: list.dateFrom,
    dateTo: list.dateTo,
  });

  const exportConfig = useMemo(
    () => ({
      filenamePrefix: "مرتجعات-المبيعات",
      sheetName: "مرتجعات المبيعات",
      pdfTitle: "مرتجعات المبيعات",
      headers: ["رقم المرتجع", "رقم المرجع", "العميل", "التاريخ", "الإجمالي", "الحالة"],
      rows: list.exportRows,
      settings,
    }),
    [list.exportRows, settings],
  );

  const columns: ColumnDef<Return, any>[] = [
    {
      accessorKey: "return_number",
      header: ({ column }) => <DataTableColumnHeader column={column} title="رقم المرتجع" />,
      cell: ({ row }) => (
        <span className="font-mono">
          {formatDisplayNumber(prefix, row.original.posted_number, row.original.return_number, row.original.status)}
        </span>
      ),
    },
    {
      accessorKey: "reference",
      meta: { hideOnMobile: true },
      header: ({ column }) => <DataTableColumnHeader column={column} title="رقم المرجع" />,
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground">{row.original.reference || "—"}</span>
      ),
    },
    {
      accessorKey: "customer_name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="العميل" />,
      cell: ({ row }) => <span className="font-medium">{row.original.customer_name || "—"}</span>,
    },
    {
      accessorKey: "return_date",
      header: ({ column }) => <DataTableColumnHeader column={column} title="التاريخ" />,
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.return_date}</span>,
    },
    {
      accessorKey: "total",
      header: ({ column }) => <DataTableColumnHeader column={column} title="الإجمالي" />,
      cell: ({ row }) => (
        <span className="font-mono">
          {row.original.total.toLocaleString("en-US", {
            minimumFractionDigits: 2,
          })}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "الحالة",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={RotateCcw}
        title="مرتجعات المبيعات"
        description={`${fmtNum(stats?.total ?? 0)} مرتجع`}
        actions={
          <>
            <ExportMenu config={exportConfig} disabled={list.isLoading} onOpen={list.handlePrepareExport} />
            <Button
              onClick={() => navigate("/sales-returns/new")}
              className="gap-2 shadow-md shadow-primary/20 font-bold"
            >
              <Plus className="h-4 w-4" />
              مرتجع جديد
            </Button>
          </>
        }
      />

      <DocumentStatsStrip
        activeFilter={list.statusFilter}
        onFilterChange={list.setStatusFilter}
        items={[
          {
            label: "إجمالي المرتجعات",
            value: fmtNum(stats?.total ?? 0),
            icon: RotateCcw,
            color: "bg-primary/10 text-primary",
            filter: "all",
          },
          {
            label: "مسودات",
            value: fmtNum(stats?.draft ?? 0),
            icon: Clock,
            color: "bg-amber-500/10 text-amber-600",
            filter: "draft",
          },
          {
            label: "مُرحّلة",
            value: fmtNum(stats?.posted ?? 0),
            icon: CheckCircle,
            color: "bg-emerald-500/10 text-emerald-600",
            filter: "posted",
          },
          {
            label: "ملغاة",
            value: fmtNum(stats?.cancelled ?? 0),
            icon: Ban,
            color: "bg-destructive/10 text-destructive",
            filter: "cancelled",
          },
          {
            label: "إجمالي المبالغ",
            value: formatCurrency(stats?.totalAmount ?? 0),
            icon: DollarSign,
            color: "bg-blue-500/10 text-blue-600",
            filter: "",
          },
        ]}
      />

      <DataTable
        compactRows
        columns={columns}
        data={list.rows}
        searchPlaceholder="بحث..."
        isLoading={list.isLoading}
        emptyMessage="لا توجد مرتجعات"
        onRowClick={(r) => navigate(`/sales-returns/${r.id}`)}
        globalFilter={list.search}
        onGlobalFilterChange={list.setSearch}
        manualPagination
        pageCount={list.pageCount}
        totalRows={list.totalCount}
        pagination={list.pagination}
        onPaginationChange={list.setPagination}
        pageSize={list.pageSize}
        toolbarContent={
          <DocumentListFilters
            statusFilter={list.statusFilter}
            onStatusChange={list.setStatusFilter}
            dateFrom={list.dateFrom}
            onDateFromChange={list.setDateFrom}
            dateTo={list.dateTo}
            onDateToChange={list.setDateTo}
            hasFilters={list.hasFilters}
            onClear={list.clearFilters}
          />
        }
      />
    </div>
  );
}
