import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { formatProductDisplay } from "@/lib/product-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/DatePickerInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { ColumnDef, PaginationState } from "@tanstack/react-table";
import {
  Package,
  TrendingUp,
  TrendingDown,
  Activity,
  Coins,
  ExternalLink,
  Check,
  ChevronsUpDown,
  Search,
  X,
} from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import { useSettings } from "@/contexts/SettingsContext";
import { cn } from "@/lib/utils";
import {
  MOVEMENT_TYPE_LABELS,
  MOVEMENT_TYPE_COLORS,
  MOVEMENT_IN_TYPES,
  REFERENCE_ROUTE_MAP,
} from "@/lib/constants";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { usePagedQuery, useDebouncedValue } from "@/hooks/use-paged-query";
import { StatusChips } from "@/components/StatusChips";

interface MovementRow {
  id: string;
  product_id: string;
  movement_type: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  movement_date: string;
  notes: string | null;
  reference_id: string | null;
  reference_type: string | null;
  products: {
    code: string;
    name: string;
    model_number?: string;
    product_brands?: { name: string } | null;
  } | null;
}

const PAGE_SIZE = 20;
const fmtInt = (n: number) => Number(n || 0).toLocaleString("en-US");
const fmtNum = (n: number) =>
  Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function InventoryMovements() {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [selectedProduct, setSelectedProduct] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [productComboOpen, setProductComboOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });

  // Products lookup (with brand + model for full display & search)
  const { data: products = [] } = useQuery({
    queryKey: ["products-list-with-brand"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, code, name, model_number, product_brands(name)")
        .order("code");
      if (error) throw error;
      return data as Array<{
        id: string;
        code: string;
        name: string;
        model_number: string | null;
        product_brands: { name: string } | null;
      }>;
    },
    staleTime: 60_000,
  });

  // KPI summary
  const { data: summary } = useQuery({
    queryKey: [
      "inventory-movements-summary",
      selectedProduct,
      dateFrom,
      dateTo,
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_inventory_movements_summary" as any,
        {
          p_product_id: selectedProduct === "all" ? null : selectedProduct,
          p_date_from: dateFrom || null,
          p_date_to: dateTo || null,
        },
      );
      if (error) throw error;
      return data as any;
    },
    staleTime: 30_000,
  });

  // Paged movements
  const { data: pagedData, isLoading } = usePagedQuery<MovementRow>(
    [
      "inventory-movements",
      pagination.pageIndex,
      pagination.pageSize,
      selectedProduct,
      selectedType,
      dateFrom,
      dateTo,
      debouncedSearch,
    ] as const,
    async () => {
      const from = pagination.pageIndex * pagination.pageSize;
      const to = from + pagination.pageSize - 1;

      let query = (supabase.from("inventory_movements") as any)
        .select(
          "*, products(code, name, model_number, product_brands(name))",
          { count: "exact" },
        )
        .order("movement_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (selectedProduct !== "all")
        query = query.eq("product_id", selectedProduct);
      if (selectedType !== "all")
        query = query.eq("movement_type", selectedType);
      if (dateFrom) query = query.gte("movement_date", dateFrom);
      if (dateTo) query = query.lte("movement_date", dateTo);
      if (debouncedSearch.trim()) {
        const s = debouncedSearch.trim();
        // Pre-resolve product IDs matching name/code/model/brand (PostgREST .or doesn't filter embedded relations)
        const { data: brandMatches } = await supabase
          .from("product_brands")
          .select("id")
          .ilike("name", `%${s}%`);
        const brandIds = (brandMatches || []).map((b: any) => b.id);

        const prodQuery = supabase.from("products").select("id");
        const orParts = [
          `name.ilike.%${s}%`,
          `code.ilike.%${s}%`,
          `model_number.ilike.%${s}%`,
          `barcode.ilike.%${s}%`,
        ];
        if (brandIds.length > 0) {
          orParts.push(`brand_id.in.(${brandIds.join(",")})`);
        }
        const { data: prodMatches } = await prodQuery.or(orParts.join(","));
        const productIds = (prodMatches || []).map((p: any) => p.id);

        if (productIds.length > 0) {
          query = query.or(
            `notes.ilike.%${s}%,product_id.in.(${productIds.join(",")})`,
          );
        } else {
          query = query.ilike("notes", `%${s}%`);
        }
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data || []) as MovementRow[], totalCount: count ?? 0 };
    },
  );

  const movements = pagedData?.rows ?? [];
  const totalCount = pagedData?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pagination.pageSize));

  React.useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [selectedProduct, selectedType, dateFrom, dateTo, debouncedSearch]);

  const handleReferenceClick = (
    referenceType: string | null,
    referenceId: string | null,
  ) => {
    if (!referenceType || !referenceId) return;
    const basePath = REFERENCE_ROUTE_MAP[referenceType];
    if (basePath) navigate(`${basePath}/${referenceId}`);
  };

  const getReferenceLabel = (referenceType: string | null): string => {
    if (!referenceType) return "-";
    const labels: Record<string, string> = {
      purchase_invoice: "فاتورة شراء",
      sales_invoice: "فاتورة بيع",
      purchase_return: "مرتجع شراء",
      sales_return: "مرتجع بيع",
      inventory_adjustment: "تسوية مخزون",
    };
    return labels[referenceType] || referenceType;
  };

  const columns: ColumnDef<MovementRow, any>[] = [
    {
      accessorKey: "movement_date",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="التاريخ" />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground whitespace-nowrap font-mono">
          {row.original.movement_date}
        </span>
      ),
    },
    {
      id: "reference",
      header: "المرجع",
      cell: ({ row }) => {
        const { reference_type, reference_id } = row.original;
        if (!reference_type || !reference_id)
          return <span className="text-muted-foreground">-</span>;
        const hasRoute = !!REFERENCE_ROUTE_MAP[reference_type];
        return hasRoute ? (
          <button
            onClick={() => handleReferenceClick(reference_type, reference_id)}
            className="flex items-center gap-1.5 text-primary hover:text-primary/80 font-medium text-xs transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {getReferenceLabel(reference_type)}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {getReferenceLabel(reference_type)}
          </span>
        );
      },
    },
    {
      accessorKey: "movement_type",
      header: "نوع الحركة",
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={MOVEMENT_TYPE_COLORS[row.original.movement_type] || ""}
        >
          {MOVEMENT_TYPE_LABELS[row.original.movement_type] ||
            row.original.movement_type}
        </Badge>
      ),
    },
    {
      id: "product",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="المنتج" />
      ),
      accessorFn: (row) => row.products?.name || "",
      cell: ({ row }) => {
        const p = row.original.products as any;
        const displayName = p
          ? formatProductDisplay(p.name, p.product_brands?.name, p.model_number)
          : "";
        return (
          <div>
            <div className="font-bold text-foreground">{displayName}</div>
          </div>
        );
      },
    },
    {
      id: "in_qty",
      header: "الوارد",
      cell: ({ row }) => {
        const mt = row.original.movement_type;
        const qty = Number(row.original.quantity);
        const isIn =
          mt === "adjustment" ? qty > 0 : MOVEMENT_IN_TYPES.includes(mt);
        return isIn ? (
          <span className="font-bold text-emerald-600 font-mono">
            +{fmtInt(Math.abs(qty))}
          </span>
        ) : (
          <span className="text-muted-foreground/30">-</span>
        );
      },
    },
    {
      id: "out_qty",
      header: "الصادر",
      cell: ({ row }) => {
        const mt = row.original.movement_type;
        const qty = Number(row.original.quantity);
        const isOut =
          mt === "adjustment" ? qty < 0 : !MOVEMENT_IN_TYPES.includes(mt);
        return isOut ? (
          <span className="font-bold text-rose-600 font-mono">
            -{fmtInt(Math.abs(qty))}
          </span>
        ) : (
          <span className="text-muted-foreground/30">-</span>
        );
      },
    },
    {
      accessorKey: "unit_cost",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="التكلفة" />
      ),
      cell: ({ row }) => (
        <span className="font-mono">{fmtNum(Number(row.original.unit_cost))}</span>
      ),
    },
    {
      accessorKey: "total_cost",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="القيمة" />
      ),
      cell: ({ row }) => (
        <span className="font-mono font-bold">
          {fmtNum(Number(row.original.total_cost))}
        </span>
      ),
    },
    {
      accessorKey: "notes",
      header: "ملاحظات",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground max-w-[120px] truncate block">
          {row.original.notes || "-"}
        </span>
      ),
    },
  ];

  // Lazy export with batching + progress
  const fetchAllForExport = async (
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<MovementRow[]> => {
    const { fetchAllPaged } = await import("@/lib/paged-fetch");
    return await fetchAllPaged<MovementRow>(
      () => {
        let q = (supabase.from("inventory_movements") as any)
          .select(
            "*, products(code, name, model_number, product_brands(name))",
            { count: "exact" },
          )
          .order("movement_date", { ascending: true })
          .order("created_at", { ascending: true });
        if (selectedProduct !== "all") q = q.eq("product_id", selectedProduct);
        if (selectedType !== "all") q = q.eq("movement_type", selectedType);
        if (dateFrom) q = q.gte("movement_date", dateFrom);
        if (dateTo) q = q.lte("movement_date", dateTo);
        return q;
      },
      { batchSize: 500, maxRows: 50000, onProgress },
    );
  };

  const [exportRows, setExportRows] = useState<any[][]>([]);
  React.useEffect(() => {
    setExportRows([]);
  }, [selectedProduct, selectedType, dateFrom, dateTo, debouncedSearch]);
  const handlePrepareExport = async (
    onProgress?: (loaded: number, total: number) => void,
  ) => {
    const all = await fetchAllForExport(onProgress);
    // Build cumulative balance per product (for export only)
    const balances: Record<string, number> = {};
    const rows = all.map((m) => {
      const pid = m.product_id;
      if (!(pid in balances)) balances[pid] = 0;
      if (m.movement_type === "adjustment") {
        balances[pid] += Number(m.quantity);
      } else {
        const isIn = MOVEMENT_IN_TYPES.includes(m.movement_type);
        balances[pid] += isIn ? Number(m.quantity) : -Number(m.quantity);
      }
      const p = m.products as any;
      const isInRow =
        m.movement_type === "adjustment"
          ? Number(m.quantity) > 0
          : MOVEMENT_IN_TYPES.includes(m.movement_type);
      const isOutRow =
        m.movement_type === "adjustment"
          ? Number(m.quantity) < 0
          : !MOVEMENT_IN_TYPES.includes(m.movement_type);
      return [
        m.movement_date,
        p
          ? formatProductDisplay(
              p.name,
              p.product_brands?.name,
              p.model_number,
            )
          : "",
        p?.code || "",
        MOVEMENT_TYPE_LABELS[m.movement_type] || m.movement_type,
        isInRow ? fmtInt(Math.abs(Number(m.quantity))) : "",
        isOutRow ? fmtInt(Math.abs(Number(m.quantity))) : "",
        fmtNum(Number(m.unit_cost)),
        fmtNum(Number(m.total_cost)),
        fmtInt(balances[pid]),
      ];
    });
    setExportRows(rows);
    return { rows };
  };

  const exportConfig = {
    filenamePrefix: "حركات-المخزون",
    sheetName: "حركات المخزون",
    pdfTitle: "حركات المخزون",
    headers: [
      "التاريخ",
      "المنتج",
      "الكود",
      "نوع الحركة",
      "الوارد",
      "الصادر",
      "التكلفة",
      "القيمة",
      "الرصيد التراكمي",
    ],
    rows: exportRows,
    settings,
    pdfOrientation: "landscape" as const,
  };

  const totalIn = summary?.total_in ?? 0;
  const totalOut = summary?.total_out ?? 0;
  const totalValue = summary?.total_value ?? 0;
  const totalMovements = summary?.total_count ?? 0;

  const kpiCards = [
    {
      label: "إجمالي الحركات",
      value: fmtInt(totalMovements),
      icon: Activity,
      color: "bg-primary/10 text-primary",
    },
    {
      label: "قيمة الحركة",
      value: fmtNum(totalValue),
      icon: Coins,
      color: "bg-blue-500/10 text-blue-600",
    },
    {
      label: "الوارد",
      value: `+${fmtInt(totalIn)}`,
      icon: TrendingUp,
      color: "bg-emerald-500/10 text-emerald-600",
    },
    {
      label: "الصادر",
      value: `-${fmtInt(totalOut)}`,
      icon: TrendingDown,
      color: "bg-rose-500/10 text-rose-600",
    },
    {
      label: "صافي الحركة",
      value: fmtInt(totalIn - totalOut),
      icon: Package,
      color:
        totalIn - totalOut >= 0
          ? "bg-emerald-500/10 text-emerald-600"
          : "bg-rose-500/10 text-rose-600",
    },
  ];

  const statusChips = [
    {
      label: "كل الأنواع",
      value: fmtInt(totalMovements),
      filter: "all",
      icon: Package,
      color: "bg-primary/10 text-primary",
    },
    ...Object.entries(MOVEMENT_TYPE_LABELS).map(([k, v]) => ({
      label: v as string,
      value: fmtInt(summary?.by_type?.[k] ?? 0),
      filter: k,
      icon: Activity,
      color:
        MOVEMENT_IN_TYPES.includes(k)
          ? "bg-emerald-500/10 text-emerald-600"
          : "bg-rose-500/10 text-rose-600",
    })),
  ];

  const hasFilters =
    selectedProduct !== "all" ||
    selectedType !== "all" ||
    dateFrom ||
    dateTo ||
    search.trim();
  const clearFilters = () => {
    setSelectedProduct("all");
    setSelectedType("all");
    setDateFrom("");
    setDateTo("");
    setSearch("");
  };

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Package}
        title="حركة المخزون"
        description="متابعة تفصيلية لعمليات التوريد والمنصرف"
        actions={
          <ExportMenu
            config={exportConfig}
            disabled={isLoading}
            onOpen={handlePrepareExport}
          />
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
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

      {/* Status chips (movement types) */}
      <StatusChips
        chips={statusChips}
        active={selectedType}
        onSelect={setSelectedType}
      />

      <DataTable
        columns={columns}
        data={movements}
        searchPlaceholder="بحث بالكود، الاسم، الماركة، الموديل أو الملاحظات..."
        isLoading={isLoading}
        emptyMessage="لا توجد حركات مخزون"
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        manualPagination
        pageCount={pageCount}
        totalRows={totalCount}
        pagination={pagination}
        onPaginationChange={setPagination}
        pageSize={PAGE_SIZE}
        toolbarContent={
          <div className="flex gap-2 flex-wrap">
            <Popover open={productComboOpen} onOpenChange={setProductComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={productComboOpen}
                  className={cn(
                    "w-80 justify-between h-9 font-normal text-sm",
                    selectedProduct === "all" && "text-muted-foreground",
                  )}
                >
                  <span className="truncate flex-1 text-right">
                    {selectedProduct !== "all"
                      ? (() => {
                          const p = products.find(
                            (p) => p.id === selectedProduct,
                          );
                          return p
                            ? `${p.code} - ${formatProductDisplay(p.name, p.product_brands?.name, p.model_number)}`
                            : "جميع المنتجات";
                        })()
                      : "جميع المنتجات"}
                  </span>
                  <ChevronsUpDown className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[--radix-popover-trigger-width] p-0"
                align="start"
                sideOffset={5}
              >
                <Command dir="rtl">
                  <CommandInput
                    placeholder="ابحث بالكود أو الاسم أو الماركة أو الموديل..."
                    className="h-10 text-sm"
                  />
                  <CommandList>
                    <CommandEmpty>
                      <div className="flex flex-col items-center gap-1.5">
                        <Search className="h-5 w-5 text-muted-foreground/40" />
                        <span>لا توجد نتائج</span>
                      </div>
                    </CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="جميع المنتجات"
                        onSelect={() => {
                          setSelectedProduct("all");
                          setProductComboOpen(false);
                        }}
                        className="gap-2.5"
                      >
                        <span className="flex-1">جميع المنتجات</span>
                        <Check
                          className={cn(
                            "mr-auto h-4 w-4 shrink-0 text-primary transition-opacity",
                            selectedProduct === "all"
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                      </CommandItem>
                      {products.map((p) => {
                        const display = formatProductDisplay(
                          p.name,
                          p.product_brands?.name,
                          p.model_number,
                        );
                        return (
                          <CommandItem
                            key={p.id}
                            value={`${p.code} ${p.name} ${p.product_brands?.name ?? ""} ${p.model_number ?? ""}`}
                            onSelect={() => {
                              setSelectedProduct(p.id);
                              setProductComboOpen(false);
                            }}
                            className="gap-2.5"
                          >
                            <span className="inline-flex items-center justify-center min-w-[3rem] rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                              {p.code}
                            </span>
                            <span className="flex-1 truncate">{display}</span>
                            <Check
                              className={cn(
                                "mr-auto h-4 w-4 shrink-0 text-primary transition-opacity",
                                selectedProduct === p.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
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
