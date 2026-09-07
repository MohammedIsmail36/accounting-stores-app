import React, { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataTable, DataTableColumnHeader } from "@/components/ui/data-table";
import { deleteStorageFiles } from "@/lib/storage-cleanup";
import { ColumnDef, PaginationState } from "@tanstack/react-table";
import {
  Package,
  Plus,
  Pencil,
  AlertTriangle,
  Archive,
  Eye,
  Upload,
  ChevronLeft,
  CheckCircle2,
  XCircle,
  DollarSign,
  X,
  Trash2,
  List,
  LayoutGrid,
  Search,
  Barcode,
} from "lucide-react";
import { BarcodePrintDialog } from "@/components/BarcodePrintDialog";
import { TelegramPublishButton } from "@/components/products/TelegramPublishButton";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { ProductsGrid } from "@/components/products/ProductsGrid";
import { ExportMenu } from "@/components/ExportMenu";
import { useSettings } from "@/contexts/SettingsContext";
import { formatNumber as fmtNum, formatInt as fmtInt } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { usePagedQuery, useDebouncedValue } from "@/hooks/use-paged-query";
import { StatusChips } from "@/components/StatusChips";
import { buildCategoryTree, getDescendantIds, CategoryNode } from "@/lib/category-utils";
import { notify } from "@/lib/notify";

interface ProductRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  barcode: string | null;
  model_number: string | null;
  main_image_url: string | null;
  purchase_price: number;
  selling_price: number;
  quantity_on_hand: number;
  min_stock_level: number;
  is_active: boolean;
  created_at: string;
  brand_id: string | null;
  category_id: string | null;
  unit_id: string | null;
  product_categories?: { name: string } | null;
  product_units?: { name: string } | null;
  product_brands?: { name: string } | null;
}

const PAGE_SIZE = 20;

function renderCategoryOptions(nodes: CategoryNode[], depth = 0): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  for (const node of nodes) {
    const prefix = depth > 0 ? "─ ".repeat(depth) : "";
    result.push(
      <SelectItem key={node.id} value={node.id}>
        <span className="flex items-center gap-1">
          {depth > 0 && <ChevronLeft className="h-3 w-3 text-muted-foreground inline" />}
          {prefix}
          {node.name}
        </span>
      </SelectItem>,
    );
    result.push(...renderCategoryOptions(node.children, depth + 1));
  }
  return result;
}

export default function Products() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { settings, formatCurrency } = useSettings();

  const [searchParams, setSearchParams] = useSearchParams();

  const updateParams = (updates: Record<string, string | null>) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(updates).forEach(([k, v]) => {
          if (v === null || v === undefined || v === "") next.delete(k);
          else next.set(k, v);
        });
        return next;
      },
      { replace: true },
    );
  };

  const search = searchParams.get("q") ?? "";
  const categoryFilter = searchParams.get("cat") ?? "all";
  const stockFilter = (searchParams.get("stock") as "all" | "low" | "out") || "all";
  const statusFilter = (searchParams.get("status") as "active" | "inactive" | "all") || "active";
  const pageIndex = Math.max(0, (parseInt(searchParams.get("page") ?? "1", 10) || 1) - 1);
  const pageSize = Math.max(1, parseInt(searchParams.get("size") ?? String(PAGE_SIZE), 10) || PAGE_SIZE);

  const setSearch = (v: string) => updateParams({ q: v || null, page: null });
  const setCategoryFilter = (v: string) => updateParams({ cat: v === "all" ? null : v, page: null });
  const setStockFilter = (v: "all" | "low" | "out") => updateParams({ stock: v === "all" ? null : v, page: null });
  const setStatusFilter = (v: "active" | "inactive" | "all") =>
    updateParams({ status: v === "active" ? null : v, page: null });

  const debouncedSearch = useDebouncedValue(search, 300);

  const pagination: PaginationState = { pageIndex, pageSize };
  const setPagination = (
    updater: PaginationState | ((p: PaginationState) => PaginationState),
  ) => {
    const next = typeof updater === "function" ? (updater as any)(pagination) : updater;
    updateParams({
      page: next.pageIndex === 0 ? null : String(next.pageIndex + 1),
      size: next.pageSize === PAGE_SIZE ? null : String(next.pageSize),
    });
  };

  const [categories, setCategories] = useState<
    { id: string; name: string; parent_id: string | null; is_active: boolean }[]
  >([]);

  const canEdit = role === "admin" || role === "accountant";
  const isAdmin = role === "admin";

  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "grid";
    const v = window.localStorage.getItem("products-view-mode");
    return v === "list" ? "list" : "grid";
  });
  React.useEffect(() => {
    window.localStorage.setItem("products-view-mode", viewMode);
  }, [viewMode]);

  // Barcode print dialog
  const [printOpen, setPrintOpen] = useState(false);
  const [printProducts, setPrintProducts] = useState<ProductRow[]>([]);
  const openPrintFor = (rows: ProductRow[]) => {
    setPrintProducts(rows);
    setPrintOpen(true);
  };

  // KPI Summary (RPC)
  const { data: summary, refetch: refetchSummary } = useQuery({
    queryKey: ["products-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_products_summary" as any);
      if (error) throw error;
      return data as any;
    },
    staleTime: 30_000,
  });

  // Categories (small lookup)
  useEffect(() => {
    (async () => {
      const { data } = await (supabase.from("product_categories" as any) as any)
        .select("id, name, parent_id, is_active")
        .order("name");
      setCategories(data || []);
    })();
  }, []);

  const categoryTree = useMemo(
    () => buildCategoryTree(categories.filter((c) => c.is_active)),
    [categories],
  );

  const matchingCategoryIds = useMemo(() => {
    if (categoryFilter === "all") return null;
    return getDescendantIds(categoryTree, categoryFilter);
  }, [categoryFilter, categoryTree]);

  // Paged products
  const {
    data: pagedData,
    isLoading,
    refetch: refetchList,
  } = usePagedQuery<ProductRow>(
    [
      "products-list",
      pagination.pageIndex,
      pagination.pageSize,
      statusFilter,
      stockFilter,
      categoryFilter,
      matchingCategoryIds?.join(",") || "all",
      debouncedSearch,
    ] as const,
    async () => {
      const from = pagination.pageIndex * pagination.pageSize;
      const to = from + pagination.pageSize - 1;

      let q = (supabase.from("products") as any)
        .select(
          "id, code, name, description, barcode, barcode_label, barcode_price, model_number, main_image_url, purchase_price, selling_price, quantity_on_hand, min_stock_level, is_active, created_at, brand_id, category_id, unit_id, product_categories(name), product_units(name), product_brands(name)",
          { count: "exact" },
        )
        .order("code")
        .range(from, to);

      if (statusFilter === "active") q = q.eq("is_active", true);
      else if (statusFilter === "inactive") q = q.eq("is_active", false);

      if (stockFilter === "out") q = q.lte("quantity_on_hand", 0);
      // 'low' (qty>0 AND qty<min) is filtered client-side because Supabase
      // can't do col-vs-col comparison directly in select chain.

      if (matchingCategoryIds && matchingCategoryIds.length > 0) {
        q = q.in("category_id", matchingCategoryIds);
      }

      if (debouncedSearch.trim()) {
        const s = debouncedSearch.trim();
        // Look up brand IDs whose name matches the search term so we can
        // include products of those brands in the results.
        const { data: brandRows } = await (supabase.from("product_brands") as any).select("id").ilike("name", `%${s}%`);
        const brandIds: string[] = (brandRows || []).map((b: any) => b.id);
        const orParts = [`name.ilike.%${s}%`, `code.ilike.%${s}%`, `barcode.ilike.%${s}%`, `model_number.ilike.%${s}%`];
        if (brandIds.length > 0) {
          orParts.push(`brand_id.in.(${brandIds.join(",")})`);
        }
        q = q.or(orParts.join(","));
      }

      const { data, error, count } = await q;
      if (error) {
        notify.error("خطأ", "فشل في جلب المنتجات");
        throw error;
      }
      let rows = (data || []) as ProductRow[];
      if (stockFilter === "low") {
        rows = rows.filter((p) => p.quantity_on_hand > 0 && p.quantity_on_hand < p.min_stock_level);
      }
      return { rows, totalCount: count ?? 0 };
    },
  );

  const products = pagedData?.rows ?? [];
  const totalCount = pagedData?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pagination.pageSize));

  // Fetch usage counts for products on the current page (to decide delete vs disable visibility)
  const productIds = useMemo(() => products.map((p) => p.id), [products]);
  const { data: usageMap = {} as Record<string, number> } = useQuery({
    queryKey: ["products-usage", productIds.join(",")],
    enabled: productIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const tables = [
        "sales_invoice_items",
        "purchase_invoice_items",
        "sales_return_items",
        "purchase_return_items",
        "inventory_movements",
        "inventory_adjustment_items",
      ];
      const results = await Promise.all(
        tables.map((t) => (supabase.from(t as any) as any).select("product_id").in("product_id", productIds)),
      );
      const map: Record<string, number> = {};
      productIds.forEach((id) => (map[id] = 0));
      results.forEach(({ data }) => {
        (data || []).forEach((row: any) => {
          if (row.product_id && map[row.product_id] !== undefined) {
            map[row.product_id] += 1;
          }
        });
      });
      return map;
    },
  });

  // (page reset is handled inside each filter setter; no effect needed)

  const toggleProductStatus = async (product: ProductRow) => {
    const newStatus = !product.is_active;
    // منع التعطيل إذا كانت الكمية المتاحة أكبر من صفر
    if (!newStatus && Number(product.quantity_on_hand || 0) > 0) {
      notify.error("لا يمكن التعطيل", `لا يمكن تعطيل المنتج "${product.name}" لأن الكمية المتاحة (${fmtNum(product.quantity_on_hand)}) أكبر من صفر. قم بتصفير المخزون أولاً.`);
      return;
    }
    const { error } = await supabase.from("products").update({ is_active: newStatus }).eq("id", product.id);
    if (error) {
      notify.error("خطأ", "فشل في تحديث حالة المنتج");
    } else {
      notify.success(newStatus ? "تم التفعيل" : "تم التعطيل", newStatus ? "تم تفعيل المنتج بنجاح" : "تم تعطيل المنتج بنجاح");
      refetchList();
      refetchSummary();
    }
  };

  // حذف نهائي: يفحص أن المنتج لم يُستخدم في أي وثيقة أو حركة قبل الحذف
  const hardDeleteProduct = async (product: ProductRow) => {
    try {
      const checks = await Promise.all([
        supabase.from("sales_invoice_items").select("id", { count: "exact", head: true }).eq("product_id", product.id),
        supabase
          .from("purchase_invoice_items")
          .select("id", { count: "exact", head: true })
          .eq("product_id", product.id),
        supabase.from("sales_return_items").select("id", { count: "exact", head: true }).eq("product_id", product.id),
        supabase
          .from("purchase_return_items")
          .select("id", { count: "exact", head: true })
          .eq("product_id", product.id),
        supabase.from("inventory_movements").select("id", { count: "exact", head: true }).eq("product_id", product.id),
        supabase
          .from("inventory_adjustment_items")
          .select("id", { count: "exact", head: true })
          .eq("product_id", product.id),
      ]);
      const totalUsage = checks.reduce((sum, r) => sum + (r.count || 0), 0);
      if (totalUsage > 0) {
        notify.error("لا يمكن الحذف النهائي", `المنتج "${product.name}" مستخدم في ${totalUsage} عملية/حركة. يمكن تعطيله بدلاً من حذفه.`);
        return;
      }
      if (Number(product.quantity_on_hand || 0) !== 0) {
        notify.error("لا يمكن الحذف النهائي", "الكمية المتاحة للمنتج ليست صفراً.");
        return;
      }
      // جمع كل عناوين الصور (الرئيسية + المعرض) لحذفها من Storage
      const { data: galleryImgs } = await supabase
        .from("product_images")
        .select("image_url")
        .eq("product_id", product.id);
      const urls = [
        (product as any).main_image_url,
        ...((galleryImgs || []).map((g: any) => g.image_url)),
      ];
      await deleteStorageFiles(urls);

      // حذف الصور المرتبطة أولاً ثم المنتج
      await supabase.from("product_images").delete().eq("product_id", product.id);
      const { error } = await supabase.from("products").delete().eq("id", product.id);
      if (error) throw error;
      notify.success("تم الحذف", `تم حذف المنتج "${product.name}" نهائياً`);
      refetchList();
      refetchSummary();
    } catch (err: any) {
      notify.error("خطأ في الحذف", err.message || "تعذر حذف المنتج");
    }
  };

  const getCategoryName = (p: ProductRow) => (p as any).product_categories?.name || "-";
  const getBrandName = (p: ProductRow) => (p as any).product_brands?.name || "-";

  const getStockBadge = (product: ProductRow) => {
    if (product.quantity_on_hand <= 0)
      return (
        <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-destructive/10 text-destructive">
          نفذت الكمية
        </span>
      );
    if (product.quantity_on_hand < product.min_stock_level)
      return (
        <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
          مخزون منخفض
        </span>
      );
    return (
      <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400">
        متوفر
      </span>
    );
  };

  // Lazy export with batching + progress
  const fetchAllForExport = async (onProgress?: (loaded: number, total: number) => void): Promise<ProductRow[]> => {
    const { fetchAllPaged } = await import("@/lib/paged-fetch");
    // Resolve brand IDs matching the search once so it can be reused across pages
    let brandIds: string[] = [];
    const s = debouncedSearch.trim();
    if (s) {
      const { data: brandRows } = await (supabase.from("product_brands") as any)
        .select("id")
        .ilike("name", `%${s}%`);
      brandIds = (brandRows || []).map((b: any) => b.id);
    }
    const rows = await fetchAllPaged<ProductRow>(
      () => {
        let q = (supabase.from("products") as any)
          .select(
            "id, code, name, description, barcode, barcode_label, barcode_price, model_number, main_image_url, purchase_price, selling_price, quantity_on_hand, min_stock_level, is_active, created_at, brand_id, category_id, unit_id, product_categories(name), product_units(name), product_brands(name)",
            { count: "exact" },
          )
          .order("code");
        if (statusFilter === "active") q = q.eq("is_active", true);
        else if (statusFilter === "inactive") q = q.eq("is_active", false);
        if (stockFilter === "out") q = q.lte("quantity_on_hand", 0);
        if (matchingCategoryIds && matchingCategoryIds.length > 0) {
          q = q.in("category_id", matchingCategoryIds);
        }
        if (s) {
          const orParts = [
            `name.ilike.%${s}%`,
            `code.ilike.%${s}%`,
            `barcode.ilike.%${s}%`,
            `model_number.ilike.%${s}%`,
          ];
          if (brandIds.length > 0) {
            orParts.push(`brand_id.in.(${brandIds.join(",")})`);
          }
          q = q.or(orParts.join(","));
        }
        return q;
      },
      { batchSize: 500, maxRows: 50000, onProgress },
    );
    let result = rows;
    if (stockFilter === "low") {
      result = result.filter((p: any) => p.quantity_on_hand > 0 && p.quantity_on_hand < p.min_stock_level);
    }
    return result;
  };

  const [exportRows, setExportRows] = useState<any[][]>([]);
  React.useEffect(() => {
    setExportRows([]);
  }, [statusFilter, stockFilter, categoryFilter, debouncedSearch]);
  // Build full category path (e.g. "ملابس / قمصان") for round-trip export/import
  const categoryPathById = useMemo(() => {
    const map = new Map<string, { name: string; parent_id: string | null }>();
    categories.forEach((c) => map.set(c.id, c));
    const getPath = (id: string): string => {
      const parts: string[] = [];
      let cur = map.get(id);
      while (cur) {
        parts.unshift(cur.name);
        cur = cur.parent_id ? map.get(cur.parent_id) : undefined;
      }
      return parts.join(" / ");
    };
    const out = new Map<string, string>();
    categories.forEach((c) => out.set(c.id, getPath(c.id)));
    return out;
  }, [categories]);

  const handlePrepareExport = async (onProgress?: (loaded: number, total: number) => void) => {
    const all = await fetchAllForExport(onProgress);
    // Use the SAME column order/headers as the import template so the file is round-trippable
    const rows = all.map((p) => [
      p.code,
      p.name,
      p.description || "",
      (p.category_id && categoryPathById.get(p.category_id)) || (getCategoryName(p) === "-" ? "" : getCategoryName(p)),
      (p as any).product_units?.name || "",
      getBrandName(p) === "-" ? "" : getBrandName(p),
      p.model_number || "",
      p.barcode || "",
      (p as any).barcode_label || "",
      (p as any).barcode_price != null ? Number((p as any).barcode_price) : "",
      Number(p.purchase_price || 0),
      Number(p.selling_price || 0),
      Number(p.quantity_on_hand || 0),
      Number(p.min_stock_level || 0),
    ]);
    setExportRows(rows);
    return { rows };
  };

  const exportConfig = {
    filenamePrefix: "المنتجات",
    sheetName: "المنتجات",
    pdfTitle: "قائمة المنتجات",
    headers: [
      "الكود",
      "الاسم",
      "الوصف",
      "التصنيف",
      "الوحدة",
      "الماركة",
      "رقم الموديل",
      "الباركود",
      "مسمى الباركود",
      "سعر الباركود",
      "سعر الشراء",
      "سعر البيع",
      "الكمية",
      "الحد الأدنى",
    ],
    rows: exportRows,
    settings,
    pdfOrientation: "landscape" as const,
  };

  const columns = useMemo<ColumnDef<ProductRow, any>[]>(
    () => [
      {
        id: "product_info",
        header: ({ column }) => <DataTableColumnHeader column={column} title="المنتج" />,
        accessorKey: "name",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            {row.original.main_image_url ? (
              <img
                src={row.original.main_image_url}
                alt={row.original.name}
                className="h-10 w-10 rounded-lg object-cover border border-border"
              />
            ) : (
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center border border-border">
                <Package className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div>
              <p className="text-sm font-bold text-foreground">{row.original.name}</p>
              <p className="text-xs text-muted-foreground">
                {getBrandName(row.original) !== "-" ? getBrandName(row.original) : ""}
                {row.original.model_number && getBrandName(row.original) !== "-" ? " - " : ""}
                {row.original.model_number || ""}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: "active_status",
        meta: { hideOnMobile: true },
        header: "النشاط",
        cell: ({ row }) =>
          row.original.is_active ? (
            <Badge
              variant="secondary"
              className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
            >
              نشط
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-muted text-muted-foreground">
              غير نشط
            </Badge>
          ),
      },
      {
        accessorKey: "code",
        meta: { hideOnMobile: true },
        header: ({ column }) => <DataTableColumnHeader column={column} title="كود الصنف" />,
        cell: ({ row }) => <span className="font-mono text-sm text-foreground">{row.original.code}</span>,
      },
      {
        id: "category",
        meta: { hideOnMobile: true },
        header: "التصنيف",
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{getCategoryName(row.original)}</span>,
      },
      {
        accessorKey: "selling_price",
        header: ({ column }) => <DataTableColumnHeader column={column} title="سعر الوحدة" />,
        cell: ({ row }) => (
          <span className="text-sm font-bold text-foreground font-mono">
            {formatCurrency(row.original.selling_price)}
          </span>
        ),
      },
      {
        accessorKey: "quantity_on_hand",
        header: ({ column }) => <DataTableColumnHeader column={column} title="الكمية" />,
        cell: ({ row }) => (
          <span className="text-sm text-foreground font-mono">
            {fmtInt(row.original.quantity_on_hand)} {row.original.product_units?.name || "وحدة"}
          </span>
        ),
      },
      {
        id: "stock_status",
        header: "حالة المخزون",
        cell: ({ row }) => getStockBadge(row.original),
      },
      {
        id: "actions",
        header: "الإجراءات",
        enableHiding: false,
        cell: ({ row }) => {
          const usage = usageMap[row.original.id] ?? 0;
          const qty = Number(row.original.quantity_on_hand || 0);
          const canHardDelete = canEdit && usage === 0 && qty === 0;
          // التعطيل/التفعيل: يُسمح فقط إذا كان للمنتج حركات (لا يمكن حذفه) والمخزون = صفر،
          // أو إذا كان المنتج معطّلاً بالفعل (للسماح بإعادة التفعيل)
          const canToggle = canEdit && (!row.original.is_active || (usage > 0 && qty === 0));
          return (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {row.original.barcode && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="طباعة ملصق الباركود"
                      className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/5"
                      onClick={() => openPrintFor([row.original])}
                    >
                      <Barcode className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>طباعة ملصق الباركود</p>
                  </TooltipContent>
                </Tooltip>
              )}
              <TelegramPublishButton
                product={{
                  id: row.original.id,
                  name: row.original.name,
                  code: row.original.code,
                  main_image_url: row.original.main_image_url,
                  quantity_on_hand: row.original.quantity_on_hand,
                  is_active: row.original.is_active,
                }}
              />

              {canToggle && (
                <ConfirmDialog
                  title={row.original.is_active ? "تعطيل المنتج" : "تفعيل المنتج"}
                  description={
                    row.original.is_active
                      ? `هل تريد تعطيل منتج "${row.original.name}"؟`
                      : `هل تريد تفعيل منتج "${row.original.name}"؟`
                  }
                  confirmText={row.original.is_active ? "تعطيل" : "تفعيل"}
                  destructive={row.original.is_active}
                  onConfirm={() => toggleProductStatus(row.original)}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={row.original.is_active ? "أرشفة المنتج" : "تفعيل المنتج"}
                      className={`h-8 w-8 ${row.original.is_active ? "text-muted-foreground hover:text-destructive hover:bg-destructive/5" : "text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50"}`}
                    >
                      {row.original.is_active ? <Archive className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    </Button>
                  }
                />

              )}
              {canHardDelete && (
                <ConfirmDialog
                  title="حذف المنتج نهائياً"
                  description={`سيتم حذف المنتج "${row.original.name}" نهائياً من قاعدة البيانات. هذا الإجراء لا يمكن التراجع عنه.`}
                  confirmText="حذف نهائي"
                  destructive
                  onConfirm={() => hardDeleteProduct(row.original)}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="حذف نهائي"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  }
                />

              )}
            </div>
          );
        },
      },
    ],
    [canEdit, navigate, role, usageMap],
  );

  // KPI cards
  const kpiCards = [
    {
      label: "إجمالي الأصناف",
      value: fmtInt(summary?.total_count ?? 0),
      icon: Package,
      color: "bg-blue-500/10 text-blue-600",
    },
    {
      label: "قيمة المخزون",
      value: formatCurrency(summary?.total_value ?? 0),
      icon: DollarSign,
      color: "bg-emerald-500/10 text-emerald-600",
    },
    {
      label: "متوفر",
      value: fmtInt(summary?.available_count ?? 0),
      icon: CheckCircle2,
      color: "bg-teal-500/10 text-teal-600",
    },
    {
      label: "مخزون منخفض",
      value: fmtInt(summary?.low_stock_count ?? 0),
      icon: AlertTriangle,
      color: "bg-amber-500/10 text-amber-600",
    },
    {
      label: "نفذ المخزون",
      value: fmtInt(summary?.out_of_stock_count ?? 0),
      icon: XCircle,
      color: "bg-destructive/10 text-destructive",
    },
  ];

  const statusChips = [
    {
      label: "نشط",
      value: fmtInt(summary?.active_count ?? 0),
      filter: "active",
      icon: CheckCircle2,
      color: "bg-emerald-500/10 text-emerald-600",
    },
    {
      label: "غير نشط",
      value: fmtInt(summary?.inactive_count ?? 0),
      filter: "inactive",
      icon: Archive,
      color: "bg-muted text-muted-foreground",
    },
    {
      label: "الكل",
      value: fmtInt(summary?.total_count ?? 0),
      filter: "all",
      icon: Package,
      color: "bg-primary/10 text-primary",
    },
  ];

  const hasFilters = categoryFilter !== "all" || stockFilter !== "all" || statusFilter !== "active" || search.trim();
  const clearFilters = () => {
    updateParams({ q: null, cat: null, stock: null, status: null, page: null });
  };

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Package}
        title="إدارة المخزون والمنتجات"
        description="عرض وتتبع كافة الأصناف المتوفرة في المخازن."
        actions={
          <>
            {canEdit && (
              <>
                <Button variant="outline" className="gap-2 shadow-sm" onClick={() => navigate("/products/import")}>
                  <Upload className="h-4 w-4" />
                  استيراد البيانات
                </Button>
                <ExportMenu config={exportConfig} disabled={isLoading} onOpen={handlePrepareExport} />
                <Button
                  className="gap-2 shadow-md shadow-primary/20 font-bold"
                  onClick={() => navigate("/products/new")}
                >
                  <Plus className="h-4 w-4" />
                  إضافة منتج جديد
                </Button>
              </>
            )}
            {!canEdit && <ExportMenu config={exportConfig} disabled={isLoading} onOpen={handlePrepareExport} />}
          </>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {kpiCards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border p-4 bg-card transition-all hover:shadow-md">
            <div className="flex items-center justify-between mb-2">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-xl font-black text-foreground font-mono">{value}</span>
            </div>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      <StatusChips chips={statusChips} active={statusFilter} onSelect={(f) => setStatusFilter(f as any)} />

      {(() => {
        // Unified toolbar shared between list & grid views.
        // Layout (RTL): [Search] [Category] [Stock] [Clear]  …spacer…  [ViewToggle]
        // In list view, DataTable also appends its built-in [Columns] button (mr-auto → far left).
        const SearchBox = (
          <div className="relative w-full sm:w-72 shrink-0">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم، الكود، الماركة، الموديل..."
              className="pr-8 h-8 text-sm bg-card"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="مسح البحث"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );

        const ViewToggle = (
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(v) => v && setViewMode(v as "list" | "grid")}
            className="border rounded-lg p-0.5 bg-card shrink-0"
          >
            <ToggleGroupItem
              value="list"
              size="sm"
              className="h-7 px-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              aria-label="عرض قائمة"
            >
              <List className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="grid"
              size="sm"
              className="h-7 px-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              aria-label="عرض شبكي"
            >
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        );

        const FilterControls = (
          <>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[200px] bg-card border-border h-8 text-sm shrink-0">
                <SelectValue placeholder="كافة التصنيفات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كافة التصنيفات</SelectItem>
                {renderCategoryOptions(categoryTree)}
              </SelectContent>
            </Select>
            <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as any)}>
              <SelectTrigger className="w-36 bg-card border-border h-8 text-sm shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">حالة المخزون</SelectItem>
                <SelectItem value="low">مخزون منخفض</SelectItem>
                <SelectItem value="out">نفذت الكمية</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={String(pageSize)}
              onValueChange={(v) =>
                setPagination({ pageIndex: 0, pageSize: parseInt(v, 10) || PAGE_SIZE })
              }
            >
              <SelectTrigger className="w-28 bg-card border-border h-8 text-sm shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} / صفحة
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="h-8 gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive shrink-0 font-medium"
              >
                <Trash2 className="h-3.5 w-3.5" />
                مسح الفلاتر
              </Button>
            )}
          </>
        );

        if (viewMode === "list") {
          // Pass our own search + filters through toolbarContent; disable DataTable's built-in search.
          // DataTable still renders the [Columns] toggle (mr-auto pushes it to the far end).
          const toolbar = (
            <>
              {SearchBox}
              {FilterControls}
              <div className="flex-1" />
              {ViewToggle}
            </>
          );
          return (
            <DataTable
              columns={columns}
              data={products}
              showSearch={false}
              isLoading={isLoading}
              emptyMessage="لا توجد منتجات"
              onRowClick={(p) =>
                navigate(`/products/${p.id}`, { state: { returnTo: location.search } })
              }
              globalFilter={search}
              onGlobalFilterChange={setSearch}
              manualPagination
              pageCount={pageCount}
              totalRows={totalCount}
              pagination={pagination}
              onPaginationChange={setPagination}
              pageSize={pageSize}
              toolbarContent={toolbar}
            />
          );
        }

        // Grid view — same layout, no Columns toggle.
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {SearchBox}
              {FilterControls}
              <div className="flex-1" />
              {ViewToggle}
            </div>

            <ProductsGrid
              products={products as any}
              isLoading={isLoading}
              usageMap={usageMap as Record<string, number>}
              canEdit={canEdit}
              isAdmin={isAdmin}
              onView={(p) =>
                navigate(`/products/${p.id}`, { state: { returnTo: location.search } })
              }
              onEdit={(p) =>
                navigate(`/products/${p.id}/edit`, { state: { returnTo: location.search } })
              }
              onToggleStatus={(p) => toggleProductStatus(p as any)}
              onDelete={(p) => hardDeleteProduct(p as any)}
              pagination={pagination}
              onPaginationChange={setPagination}
              pageCount={pageCount}
              totalRows={totalCount}
            />
          </div>
        );
      })()}

      <BarcodePrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        products={printProducts.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          barcode: p.barcode ?? null,
          barcode_label: (p as any).barcode_label ?? null,
          barcode_price: (p as any).barcode_price ?? null,
          selling_price: p.selling_price,
          model_number: p.model_number ?? null,
        }))}
      />
    </div>
  );
}
