import React from "react";
import { ProductCard, ProductCardData } from "./ProductCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft, Package } from "lucide-react";
import type { PaginationState } from "@tanstack/react-table";

interface ProductsGridProps {
  products: ProductCardData[];
  isLoading: boolean;
  usageMap: Record<string, number>;
  canEdit: boolean;
  isAdmin: boolean;
  onView: (p: ProductCardData) => void;
  onEdit: (p: ProductCardData) => void;
  onToggleStatus: (p: ProductCardData) => void;
  onDelete: (p: ProductCardData) => void;

  pagination: PaginationState;
  onPaginationChange: (
    updater: PaginationState | ((p: PaginationState) => PaginationState),
  ) => void;
  pageCount: number;
  totalRows: number;
}

export function ProductsGrid({
  products,
  isLoading,
  usageMap,
  canEdit,
  isAdmin,
  onView,
  onEdit,
  onToggleStatus,
  onDelete,
  pagination,
  onPaginationChange,
  pageCount,
  totalRows,
}: ProductsGridProps) {
  const setPage = (idx: number) =>
    onPaginationChange((p) => ({ ...p, pageIndex: idx }));

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border overflow-hidden bg-card"
          >
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="p-3 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
              <div className="flex justify-between pt-2">
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-6 w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-16 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <Package className="h-12 w-12 opacity-40" />
        <p className="text-sm">لا توجد منتجات</p>
      </div>
    );
  }

  const start = pagination.pageIndex * pagination.pageSize + 1;
  const end = Math.min(start + products.length - 1, totalRows);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {products.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            usageCount={usageMap[p.id] ?? 0}
            canEdit={canEdit}
            isAdmin={isAdmin}
            onView={() => onView(p)}
            onEdit={() => onEdit(p)}
            onToggleStatus={() => onToggleStatus(p)}
            onDelete={() => onDelete(p)}
          />
        ))}
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          عرض {start} - {end} من {totalRows.toLocaleString("en-US")}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pagination.pageIndex === 0}
            onClick={() => setPage(pagination.pageIndex - 1)}
          >
            <ChevronRight className="h-4 w-4" />
            السابق
          </Button>
          <span className="text-xs text-muted-foreground px-2">
            صفحة {pagination.pageIndex + 1} من {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pagination.pageIndex >= pageCount - 1}
            onClick={() => setPage(pagination.pageIndex + 1)}
          >
            التالي
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
