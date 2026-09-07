import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/DatePickerInput";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ColumnDef, PaginationState } from "@tanstack/react-table";
import {
  FileText,
  Plus,
  CheckCircle,
  Clock,
  BookOpen,
  X,
  Ban,
  ArrowUpCircle,
  ArrowDownCircle,
} from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import { formatDisplayNumber } from "@/lib/posted-number-utils";
import { useQuery } from "@tanstack/react-query";
import { usePagedQuery, useDebouncedValue } from "@/hooks/use-paged-query";
import { StatusChips } from "@/components/StatusChips";
import { notify } from "@/lib/notify";

interface JournalEntry {
  id: string;
  entry_number: number;
  posted_number: number | null;
  entry_date: string;
  description: string;
  status: string;
  total_debit: number;
  total_credit: number;
  created_at: string;
}

const PAGE_SIZE = 20;
const fmtNum = (n: number) => Number(n || 0).toLocaleString("en-US");

export default function Journal() {
  const { role } = useAuth();
  const { settings, currency, formatCurrency } = useSettings();
  const navigate = useNavigate();

  const canEdit = role === "admin" || role === "accountant";
  const prefix = (settings as any)?.journal_entry_prefix || "JV-";

  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });

  const { data: summary } = useQuery({
    queryKey: ["journal-summary", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_journal_summary" as any,
        {
          p_date_from: dateFrom || null,
          p_date_to: dateTo || null,
        },
      );
      if (error) throw error;
      return data as any;
    },
    staleTime: 30_000,
  });

  const { data: pagedData, isLoading } = usePagedQuery<JournalEntry>(
    [
      "journal-list",
      pagination.pageIndex,
      pagination.pageSize,
      statusFilter,
      dateFrom,
      dateTo,
      debouncedSearch,
    ] as const,
    async () => {
      const from = pagination.pageIndex * pagination.pageSize;
      const to = from + pagination.pageSize - 1;

      let q = (supabase.from("journal_entries") as any)
        .select(
          "id, entry_number, posted_number, entry_date, description, status, total_debit, total_credit, created_at",
          { count: "exact" },
        )
        .order("posted_number", { ascending: false, nullsFirst: true })
        .order("entry_date", { ascending: false })
        .order("entry_number", { ascending: false })
        .range(from, to);

      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (dateFrom) q = q.gte("entry_date", dateFrom);
      if (dateTo) q = q.lte("entry_date", dateTo);
      if (debouncedSearch.trim()) {
        const s = debouncedSearch.trim();
        const asNum = Number(s);
        if (!isNaN(asNum)) {
          q = q.or(`entry_number.eq.${asNum},posted_number.eq.${asNum}`);
        } else {
          q = q.ilike("description", `%${s}%`);
        }
      }

      const { data, error, count } = await q;
      if (error) {
        notify.error("خطأ", "فشل في جلب القيود");
        throw error;
      }
      return { rows: data || [], totalCount: count ?? 0 };
    },
  );

  const entries = pagedData?.rows ?? [];
  const totalCount = pagedData?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pagination.pageSize));

  React.useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [statusFilter, dateFrom, dateTo, debouncedSearch]);

  const fetchAllForExport = async (
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<JournalEntry[]> => {
    const { fetchAllPaged } = await import("@/lib/paged-fetch");
    return await fetchAllPaged<JournalEntry>(
      () => {
        let q = (supabase.from("journal_entries") as any)
          .select(
            "id, entry_number, posted_number, entry_date, description, status, total_debit, total_credit, created_at",
            { count: "exact" },
          )
          .order("posted_number", { ascending: false, nullsFirst: true })
          .order("entry_date", { ascending: false })
          .order("entry_number", { ascending: false });
        if (statusFilter !== "all") q = q.eq("status", statusFilter);
        if (dateFrom) q = q.gte("entry_date", dateFrom);
        if (dateTo) q = q.lte("entry_date", dateTo);
        return q;
      },
      { batchSize: 500, maxRows: 50000, onProgress },
    );
  };

  const [exportRows, setExportRows] = useState<any[][]>([]);
  React.useEffect(() => {
    setExportRows([]);
  }, [statusFilter, dateFrom, dateTo, debouncedSearch]);
  const handlePrepareExport = async (
    onProgress?: (loaded: number, total: number) => void,
  ) => {
    const all = await fetchAllForExport(onProgress);
    const rows = all.map((e) => [
      formatDisplayNumber(prefix, e.posted_number, e.entry_number, e.status),
      e.entry_date,
      e.description,
      e.status === "posted"
        ? "معتمد"
        : e.status === "cancelled"
          ? "ملغي"
          : "مسودة",
      Number(e.total_debit).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      Number(e.total_credit).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    ]);
    setExportRows(rows);
    return { rows };
  };

  const journalExportConfig = useMemo(
    () => ({
      filenamePrefix: "القيود-المحاسبية",
      sheetName: "القيود المحاسبية",
      pdfTitle: "القيود المحاسبية",
      headers: [
        "#",
        "التاريخ",
        "الوصف",
        "الحالة",
        `مدين (${currency})`,
        `دائن (${currency})`,
      ],
      rows: exportRows,
      settings,
      pdfOrientation: "landscape" as const,
    }),
    [exportRows, settings, currency],
  );

  const hasFilters =
    statusFilter !== "all" || dateFrom || dateTo || search.trim();
  const clearFilters = () => {
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
    setSearch("");
  };

  const columns: ColumnDef<JournalEntry, any>[] = [
    {
      accessorKey: "entry_number",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="رقم القيد" />
      ),
      cell: ({ row }) => (
        <span className="font-mono text-sm text-foreground">
          {formatDisplayNumber(
            prefix,
            row.original.posted_number,
            row.original.entry_number,
            row.original.status,
          )}
        </span>
      ),
    },
    {
      accessorKey: "entry_date",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="التاريخ" />
      ),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground font-mono">
          {row.original.entry_date}
        </span>
      ),
    },
    {
      accessorKey: "description",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="الوصف" />
      ),
      cell: ({ row }) => (
        <span className="text-sm font-bold text-foreground max-w-[200px] truncate block">
          {row.original.description}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "الحالة",
      cell: ({ row }) => {
        const s = row.original.status;
        const cfg: Record<string, { label: string; className: string }> = {
          posted: {
            label: "معتمد",
            className: "bg-green-500/10 text-green-600 border-green-500/20",
          },
          draft: {
            label: "مسودة",
            className: "bg-amber-500/10 text-amber-600 border-amber-500/20",
          },
          cancelled: {
            label: "ملغي",
            className:
              "bg-destructive/10 text-destructive border-destructive/20",
          },
        };
        const c = cfg[s] || cfg.draft;
        return (
          <Badge variant="secondary" className={c.className}>
            {c.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "total_debit",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="مدين" />
      ),
      cell: ({ row }) => (
        <span className="text-sm font-bold text-foreground font-mono">
          {formatCurrency(Number(row.original.total_debit))}
        </span>
      ),
    },
    {
      accessorKey: "total_credit",
      meta: { hideOnMobile: true },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="دائن" />
      ),
      cell: ({ row }) => (
        <span className="text-sm font-bold text-foreground font-mono">
          {formatCurrency(Number(row.original.total_credit))}
        </span>
      ),
    },
  ];

  const totalDebit = summary?.total_debit ?? 0;
  const totalCredit = summary?.total_credit ?? 0;

  const kpiCards = [
    {
      label: "إجمالي القيود",
      value: fmtNum(summary?.total_count ?? 0),
      icon: BookOpen,
      color: "bg-blue-500/10 text-blue-600",
    },
    {
      label: "إجمالي مدين",
      value: formatCurrency(totalDebit),
      icon: ArrowUpCircle,
      color: "bg-emerald-500/10 text-emerald-600",
    },
    {
      label: "إجمالي دائن",
      value: formatCurrency(totalCredit),
      icon: ArrowDownCircle,
      color: "bg-rose-500/10 text-rose-600",
    },
  ];

  const statusChips = [
    {
      label: "الكل",
      value: fmtNum(summary?.total_count ?? 0),
      filter: "all",
      icon: BookOpen,
      color: "bg-primary/10 text-primary",
    },
    {
      label: "مسودة",
      value: fmtNum(summary?.draft_count ?? 0),
      filter: "draft",
      icon: Clock,
      color: "bg-amber-500/10 text-amber-600",
    },
    {
      label: "معتمد",
      value: fmtNum(summary?.posted_count ?? 0),
      filter: "posted",
      icon: CheckCircle,
      color: "bg-emerald-500/10 text-emerald-600",
    },
    {
      label: "ملغي",
      value: fmtNum(summary?.cancelled_count ?? 0),
      filter: "cancelled",
      icon: Ban,
      color: "bg-destructive/10 text-destructive",
    },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={FileText}
        title="القيود المحاسبية"
        description={`${fmtNum(summary?.total_count ?? 0)} قيد في دفتر اليومية`}
        actions={
          <>
            <ExportMenu
              config={journalExportConfig}
              disabled={isLoading}
              onOpen={handlePrepareExport}
            />
            {canEdit && (
              <Button
                className="gap-2 shadow-md shadow-primary/20 font-bold"
                onClick={() => navigate("/journal/new")}
              >
                <Plus className="h-4 w-4" />
                قيد جديد
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {kpiCards.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="rounded-xl border p-4 bg-card transition-all hover:shadow-md"
          >
            <div className="flex items-center justify-between mb-2">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-xl font-black text-foreground font-mono">
                {value}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      <StatusChips
        chips={statusChips}
        active={statusFilter}
        onSelect={setStatusFilter}
      />

      <DataTable
        compactRows
        columns={columns}
        data={entries}
        searchPlaceholder="البحث في القيود..."
        isLoading={isLoading}
        emptyMessage="لا توجد قيود محاسبية"
        onRowClick={(entry) => navigate(`/journal/${entry.id}`)}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        manualPagination
        pageCount={pageCount}
        totalRows={totalCount}
        pagination={pagination}
        onPaginationChange={setPagination}
        pageSize={PAGE_SIZE}
        toolbarContent={
          <div className="flex gap-3 flex-wrap items-center">
            <DatePickerInput
              value={dateFrom}
              onChange={setDateFrom}
              placeholder="من تاريخ"
              className="w-[150px] h-9 text-sm"
            />
            <DatePickerInput
              value={dateTo}
              onChange={setDateTo}
              placeholder="إلى تاريخ"
              className="w-[150px] h-9 text-sm"
            />
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-9 gap-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                مسح الفلاتر
              </Button>
            )}
          </div>
        }
      />
    </div>
  );
}
