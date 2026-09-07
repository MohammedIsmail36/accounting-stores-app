import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/contexts/SettingsContext";
import { formatDisplayNumber } from "@/lib/posted-number-utils";
import { Card, CardContent } from "@/components/ui/card";
import { AccountCombobox } from "@/components/AccountCombobox";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/DatePickerInput";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ColumnDef, PaginationState } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { ExportMenu } from "@/components/ExportMenu";
import {
  Calculator,
  BookOpen,
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  X,
  Coins,
} from "lucide-react";

interface Account {
  id: string;
  code: string;
  name: string;
  account_type: string;
}

interface LedgerLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
  entry_number: number;
  entry_posted_number: number | null;
  entry_date: string;
  entry_description: string;
  entry_status: string;
  account_code: string;
  account_name: string;
  running_balance: number;
}

const fmt = (val: number) =>
  val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function Ledger() {
  const { settings } = useSettings();
  const jePrefix = (settings as any)?.journal_entry_prefix || "JV-";
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });

  // Reset to first page when filters change
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [selectedAccountId, dateFrom, dateTo]);

  // Active accounts (only ones with movements)
  const { data: accounts = [] } = useQuery({
    queryKey: ["ledger-active-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ledger_active_accounts");
      if (error) throw error;
      return (data as unknown) as Account[];
    },
  });

  // Paginated lines + summary in one RPC call
  const { data: pageData, isLoading: loading } = useQuery({
    queryKey: [
      "ledger-lines",
      selectedAccountId,
      dateFrom,
      dateTo,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ledger_lines", {
        p_account_id: selectedAccountId === "all" ? null : selectedAccountId,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_limit: pagination.pageSize,
        p_offset: pagination.pageIndex * pagination.pageSize,
      });
      if (error) throw error;
      return data as unknown as {
        lines: LedgerLine[];
        total_count: number;
        total_debit: number;
        total_credit: number;
        net_balance: number;
      };
    },
    placeholderData: (prev) => prev,
  });

  const lines = pageData?.lines ?? [];
  const totalCount = pageData?.total_count ?? 0;
  const totalDebit = pageData?.total_debit ?? 0;
  const totalCredit = pageData?.total_credit ?? 0;
  const netBalance = pageData?.net_balance ?? 0;

  const accountMap = useMemo(() => {
    const map = new Map<string, Account>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  const hasFilters = selectedAccountId !== "all" || dateFrom || dateTo;
  const clearFilters = () => {
    setSelectedAccountId("all");
    setDateFrom("");
    setDateTo("");
  };

  const columns: ColumnDef<LedgerLine, any>[] = [
    {
      accessorKey: "entry_number",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="رقم القيد" />
      ),
      cell: ({ row }) => (
        <span className="font-mono font-bold text-sm">
          {formatDisplayNumber(
            jePrefix,
            row.original.entry_posted_number,
            row.original.entry_number,
            row.original.entry_status,
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
        <span className="text-sm text-muted-foreground whitespace-nowrap font-mono">
          {row.original.entry_date}
        </span>
      ),
    },
    ...(selectedAccountId === "all"
      ? [
          {
            id: "account",
            header: "الحساب",
            cell: ({ row }: any) => (
              <button
                className="text-primary hover:text-primary/80 font-medium text-sm transition-colors"
                onClick={() => setSelectedAccountId(row.original.account_id)}
              >
                {row.original.account_code} - {row.original.account_name}
              </button>
            ),
          } as ColumnDef<LedgerLine, any>,
        ]
      : []),
    {
      accessorKey: "entry_description",
      header: "البيان",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.entry_description}</span>
      ),
    },
    {
      accessorKey: "debit",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="مدين" />
      ),
      cell: ({ row }) => (
        <span
          className={`font-mono text-sm ${row.original.debit > 0 ? "text-emerald-600 font-bold" : "text-muted-foreground/30"}`}
        >
          {row.original.debit > 0 ? fmt(row.original.debit) : "-"}
        </span>
      ),
    },
    {
      accessorKey: "credit",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="دائن" />
      ),
      cell: ({ row }) => (
        <span
          className={`font-mono text-sm ${row.original.credit > 0 ? "text-rose-600 font-bold" : "text-muted-foreground/30"}`}
        >
          {row.original.credit > 0 ? fmt(row.original.credit) : "-"}
        </span>
      ),
    },
    ...(selectedAccountId !== "all"
      ? [
          {
            id: "balance",
            header: "الرصيد",
            cell: ({ row }: any) => {
              const bal = Number(row.original.running_balance ?? 0);
              return (
                <span
                  className={`font-mono text-sm font-black ${bal >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                >
                  {bal >= 0 ? fmt(bal) : `(${fmt(Math.abs(bal))})`}
                </span>
              );
            },
          } as ColumnDef<LedgerLine, any>,
        ]
      : []),
  ];

  // Lazy export: fetch full dataset only when triggered
  const exportConfig = {
    filenamePrefix: "دفتر-الأستاذ",
    sheetName: "دفتر الأستاذ",
    pdfTitle:
      selectedAccountId !== "all" && accountMap.get(selectedAccountId)
        ? `دفتر الأستاذ - ${accountMap.get(selectedAccountId)!.code} ${accountMap.get(selectedAccountId)!.name}`
        : "دفتر الأستاذ العام",
    headers: [
      "رقم القيد",
      "التاريخ",
      "الحساب",
      "البيان",
      "مدين",
      "دائن",
      ...(selectedAccountId !== "all" ? ["الرصيد"] : []),
    ],
    rows: [] as any[][],
    settings,
    pdfOrientation: "landscape" as const,
  };

  const handleExportOpen = async () => {
    const { data } = await supabase.rpc("get_ledger_lines", {
      p_account_id: selectedAccountId === "all" ? null : selectedAccountId,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_limit: 100000,
      p_offset: 0,
    });
    const allLines = ((data as any)?.lines ?? []) as LedgerLine[];
    exportConfig.rows = allLines.map((l) => [
      formatDisplayNumber(
        jePrefix,
        l.entry_posted_number,
        l.entry_number,
        l.entry_status,
      ),
      l.entry_date,
      `${l.account_code} - ${l.account_name}`,
      l.entry_description,
      l.debit > 0 ? l.debit : "",
      l.credit > 0 ? l.credit : "",
      ...(selectedAccountId !== "all" ? [Number(l.running_balance ?? 0)] : []),
    ]);
  };

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Calculator}
        title="دفتر الأستاذ العام"
        description="حركة الحسابات وأرصدتها"
        actions={
          <ExportMenu
            config={exportConfig}
            onOpen={handleExportOpen}
            disabled={loading || totalCount === 0}
          />
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          {
            label: "حسابات نشطة",
            value: accounts.length.toLocaleString("en-US"),
            icon: BookOpen,
            color: "bg-primary/10 text-primary",
          },
          {
            label: "إجمالي الحركات",
            value: totalCount.toLocaleString("en-US"),
            icon: ArrowUpDown,
            color: "bg-blue-500/10 text-blue-600",
          },
          {
            label: "إجمالي المدين",
            value: fmt(totalDebit),
            icon: TrendingUp,
            color: "bg-emerald-500/10 text-emerald-600",
          },
          {
            label: "إجمالي الدائن",
            value: fmt(totalCredit),
            icon: TrendingDown,
            color: "bg-rose-500/10 text-rose-600",
          },
          {
            label: "صافي الرصيد",
            value:
              netBalance >= 0
                ? fmt(netBalance)
                : `(${fmt(Math.abs(netBalance))})`,
            icon: Coins,
            color:
              netBalance >= 0
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-rose-500/10 text-rose-600",
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}
                >
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-foreground font-mono">
                {value}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Data Table — server-side pagination */}
      <DataTable
        compactRows
        columns={columns}
        data={lines}
        isLoading={loading}
        emptyMessage="لا توجد حركات محاسبية"
        manualPagination
        pageCount={Math.ceil(totalCount / pagination.pageSize)}
        totalRows={totalCount}
        pagination={pagination}
        onPaginationChange={setPagination}
        toolbarContent={
          <div className="flex items-center gap-2 flex-wrap">
            <AccountCombobox
              accounts={accounts}
              value={selectedAccountId === "all" ? "" : selectedAccountId}
              onValueChange={(val) => setSelectedAccountId(val || "all")}
              placeholder="جميع الحسابات"
              className="w-56"
            />
            <DatePickerInput
              value={dateFrom}
              onChange={setDateFrom}
              placeholder="من تاريخ"
              className="w-[150px]"
            />
            <DatePickerInput
              value={dateTo}
              onChange={setDateTo}
              placeholder="إلى تاريخ"
              className="w-[150px]"
            />
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="gap-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                مسح الفلاتر
              </Button>
            )}
          </div>
        }
        columnLabels={{
          entry_number: "رقم القيد",
          entry_date: "التاريخ",
          account: "الحساب",
          entry_description: "البيان",
          debit: "مدين",
          credit: "دائن",
          balance: "الرصيد",
        }}
      />
    </div>
  );
}
