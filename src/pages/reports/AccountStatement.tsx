import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/contexts/SettingsContext";
import { formatDisplayNumber } from "@/lib/posted-number-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/DatePickerInput";
import { Label } from "@/components/ui/label";
import { LookupCombobox } from "@/components/LookupCombobox";
import { Users, Truck, TrendingUp, TrendingDown, Coins, ArrowUpDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef, PaginationState } from "@tanstack/react-table";
import { ExportMenu } from "@/components/ExportMenu";

type EntityType = "customer" | "supplier";

interface Entity {
  id: string;
  code: string;
  name: string;
  balance: number;
}

interface StatementLine {
  line_date: string;
  line_type: string;
  doc_number: number;
  doc_posted_number: number | null;
  doc_status: string;
  doc_kind: string;
  description: string;
  debit: number;
  credit: number;
  running_balance: number;
}

interface AccountStatementProps {
  defaultEntityType?: EntityType;
  defaultEntityId?: string;
  lockEntityType?: boolean;
}

const fmt = (val: number) =>
  Number(val || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function AccountStatement({
  defaultEntityType,
  defaultEntityId,
  lockEntityType = false,
}: AccountStatementProps = {}) {
  const { settings } = useSettings();
  const [entityType, setEntityType] = useState<EntityType>(defaultEntityType || "customer");
  const [selectedEntity, setSelectedEntity] = useState(defaultEntityId || "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });

  // Reset page when filters change
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [entityType, selectedEntity, dateFrom, dateTo]);

  // Reset selection when entity type changes
  useEffect(() => {
    if (!defaultEntityId) setSelectedEntity("");
  }, [entityType, defaultEntityId]);

  // Entities list
  const { data: entities = [] } = useQuery({
    queryKey: ["statement-entities", entityType],
    queryFn: async () => {
      const table = entityType === "customer" ? "customers" : "suppliers";
      const { data, error } = await supabase
        .from(table)
        .select("id, code, name, balance")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return (data || []) as Entity[];
    },
  });

  const entity = entities.find((e) => e.id === selectedEntity);
  const entityName = entity?.name || "";

  // Server-side paginated statement
  const { data: pageData, isLoading: loading } = useQuery({
    queryKey: [
      "account-statement",
      entityType,
      selectedEntity,
      dateFrom,
      dateTo,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_account_statement", {
        p_entity_type: entityType,
        p_entity_id: selectedEntity,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_limit: pagination.pageSize,
        p_offset: pagination.pageIndex * pagination.pageSize,
      });
      if (error) throw error;
      return data as unknown as {
        lines: StatementLine[];
        total_count: number;
        total_debit: number;
        total_credit: number;
        final_balance: number;
      };
    },
    enabled: !!selectedEntity,
    placeholderData: (prev) => prev,
  });

  const lines = pageData?.lines ?? [];
  const totalCount = pageData?.total_count ?? 0;
  const totalDebit = pageData?.total_debit ?? 0;
  const totalCredit = pageData?.total_credit ?? 0;
  const finalBalance = pageData?.final_balance ?? 0;

  // Reference prefix per doc_kind
  const refPrefix = (kind: string): string => {
    switch (kind) {
      case "sales_invoice":
        return settings?.sales_invoice_prefix || "INV-";
      case "sales_return":
        return settings?.sales_return_prefix || "SRN-";
      case "customer_payment":
        return settings?.customer_payment_prefix || "CPV-";
      case "purchase_invoice":
        return settings?.purchase_invoice_prefix || "PUR-";
      case "purchase_return":
        return settings?.purchase_return_prefix || "PRN-";
      case "supplier_payment":
        return settings?.supplier_payment_prefix || "SPV-";
      default:
        return "";
    }
  };

  const columns: ColumnDef<StatementLine, any>[] = [
    {
      accessorKey: "line_date",
      header: "التاريخ",
      cell: ({ row }) => (
        <span className="text-sm font-mono text-muted-foreground whitespace-nowrap">{row.original.line_date}</span>
      ),
    },
    {
      accessorKey: "line_type",
      header: "النوع",
      cell: ({ row }) => <span className="text-sm">{row.original.line_type}</span>,
    },
    {
      id: "reference",
      header: "المرجع",
      cell: ({ row }) => (
        <span className="font-mono font-bold text-sm">
          {formatDisplayNumber(
            refPrefix(row.original.doc_kind),
            row.original.doc_posted_number,
            row.original.doc_number,
            row.original.doc_status,
          )}
        </span>
      ),
    },
    {
      accessorKey: "description",
      header: "البيان",
      cell: ({ row }) => <span className="text-sm">{row.original.description}</span>,
    },
    {
      accessorKey: "debit",
      header: "مدين",
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
      header: "دائن",
      cell: ({ row }) => (
        <span
          className={`font-mono text-sm ${row.original.credit > 0 ? "text-rose-600 font-bold" : "text-muted-foreground/30"}`}
        >
          {row.original.credit > 0 ? fmt(row.original.credit) : "-"}
        </span>
      ),
    },
    {
      accessorKey: "running_balance",
      header: "الرصيد",
      cell: ({ row }) => {
        const bal = Number(row.original.running_balance ?? 0);
        return (
          <span className={`font-mono text-sm font-black ${bal >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {bal >= 0 ? fmt(bal) : `(${fmt(Math.abs(bal))})`}
          </span>
        );
      },
    },
  ];

  // Lazy export
  const exportConfig = {
    filenamePrefix: `كشف-حساب-${entityName || ""}`,
    sheetName: "كشف حساب",
    pdfTitle: `كشف حساب: ${entityName}`,
    headers: ["التاريخ", "النوع", "المرجع", "البيان", "مدين", "دائن", "الرصيد"],
    rows: [] as any[][],
    settings,
    pdfOrientation: "landscape" as const,
  };

  const handleExportOpen = async () => {
    if (!selectedEntity) return;
    const { data } = await supabase.rpc("get_account_statement", {
      p_entity_type: entityType,
      p_entity_id: selectedEntity,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_limit: 100000,
      p_offset: 0,
    });
    const all = ((data as any)?.lines ?? []) as StatementLine[];
    exportConfig.rows = all.map((l) => [
      l.line_date,
      l.line_type,
      formatDisplayNumber(refPrefix(l.doc_kind), l.doc_posted_number, l.doc_number, l.doc_status),
      l.description,
      l.debit > 0 ? l.debit : "",
      l.credit > 0 ? l.credit : "",
      Number(l.running_balance ?? 0),
    ]);
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 ${lockEntityType ? "lg:grid-cols-4" : "lg:grid-cols-5"} gap-3 items-end`}
          >
            {!lockEntityType && (
              <div>
                <Label className="text-xs">نوع الحساب</Label>
                <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">
                      <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        عميل
                      </span>
                    </SelectItem>
                    <SelectItem value="supplier">
                      <span className="flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5" />
                        مورد
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">{entityType === "customer" ? "العميل" : "المورد"}</Label>
              <LookupCombobox
                items={entities.map((e) => ({
                  id: e.id,
                  name: `${e.code} - ${e.name}`,
                  searchKeywords: `${e.code} ${e.name}`,
                }))}
                value={selectedEntity}
                onValueChange={setSelectedEntity}
                placeholder={`اختر ${entityType === "customer" ? "عميلاً" : "مورداً"}...`}
                searchPlaceholder="ابحث بالكود أو الاسم..."
                emptyMessage="لا توجد نتائج"
              />
            </div>
            <div>
              <Label className="text-xs">من تاريخ</Label>
              <DatePickerInput value={dateFrom} onChange={setDateFrom} placeholder="من تاريخ" />
            </div>
            <div>
              <Label className="text-xs">إلى تاريخ</Label>
              <DatePickerInput value={dateTo} onChange={setDateTo} placeholder="إلى تاريخ" />
            </div>
            <ExportMenu
              config={exportConfig}
              onOpen={handleExportOpen}
              disabled={!selectedEntity || loading || totalCount === 0}
            />
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      {selectedEntity && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: "إجمالي الحركات",
              value: totalCount.toLocaleString("en-US"),
              icon: ArrowUpDown,
              color: "bg-primary/10 text-primary",
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
              label: "الرصيد النهائي",
              value: finalBalance >= 0 ? fmt(finalBalance) : `(${fmt(Math.abs(finalBalance))})`,
              icon: Coins,
              color: finalBalance >= 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600",
            },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <p className="text-2xl font-black text-foreground font-mono">{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Table */}
      {selectedEntity ? (
        <DataTable
          compactRows
          columns={columns}
          data={lines}
          isLoading={loading}
          emptyMessage="لا توجد حركات لهذا الحساب"
          manualPagination
          pageCount={Math.ceil(totalCount / pagination.pageSize)}
          totalRows={totalCount}
          pagination={pagination}
          onPaginationChange={setPagination}
          columnLabels={{
            line_date: "التاريخ",
            line_type: "النوع",
            reference: "المرجع",
            description: "البيان",
            debit: "مدين",
            credit: "دائن",
            running_balance: "الرصيد",
          }}
        />
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            اختر {entityType === "customer" ? "عميلاً" : "مورداً"} لعرض كشف الحساب
          </CardContent>
        </Card>
      )}
    </div>
  );
}
