import * as React from "react";
import { cn } from "@/lib/utils";
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  RowSelectionState,
  OnChangeFn,
  PaginationState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Settings2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ──────────────────────────────────────────────────
interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Global search filter value (controlled externally) */
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  /** Custom global filter function */
  globalFilterFn?: import("@tanstack/react-table").FilterFn<TData>;
  /** Column-level filters (controlled externally) */
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: OnChangeFn<ColumnFiltersState>;
  /** Row selection (controlled externally) */
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /** Column visibility (controlled externally) */
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (updater: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => void;
  /** Map column id → Arabic label for the column toggle menu */
  columnLabels?: Record<string, string>;
  /** Custom row id accessor */
  getRowId?: (row: TData) => string;
  /** Search placeholder */
  searchPlaceholder?: string;
  /** Show built-in search input */
  showSearch?: boolean;
  /** Show column visibility toggle */
  showColumnToggle?: boolean;
  /** Label for the column visibility toggle */
  columnToggleLabel?: string;
  /** Show pagination */
  showPagination?: boolean;
  /** Initial page size */
  pageSize?: number;
  /** Loading state */
  isLoading?: boolean;
  /** Empty state message */
  emptyMessage?: string;
  /** Row click handler */
  onRowClick?: (row: TData) => void;
  /** Extra toolbar content (buttons, filters, etc.) rendered after search */
  toolbarContent?: React.ReactNode;
  /** Extra toolbar content rendered before search (left side in RTL) */
  toolbarStart?: React.ReactNode;
  /** Server-side pagination mode */
  manualPagination?: boolean;
  /** Total page count (required when manualPagination=true) */
  pageCount?: number;
  /** Total row count from server (for "X من Y" display) */
  totalRows?: number;
  /** Current pagination state (controlled externally) */
  pagination?: PaginationState;
  /** Pagination change handler */
  onPaginationChange?: OnChangeFn<PaginationState>;
  /** Reduce row height for dense single-line tables (default: false) */
  compactRows?: boolean;
  /** Sorting state (controlled externally, used with manualPagination for server-side sort) */
  sorting?: SortingState;
  /** Sorting change handler */
  onSortingChange?: OnChangeFn<SortingState>;
}

// ── Main DataTable ─────────────────────────────────────────
export function DataTable<TData, TValue>({
  columns,
  data,
  globalFilter: externalGlobalFilter,
  onGlobalFilterChange,
  columnFilters: externalColumnFilters,
  onColumnFiltersChange,
  rowSelection: externalRowSelection,
  onRowSelectionChange,
  columnVisibility: externalColumnVisibility,
  onColumnVisibilityChange,
  columnLabels = {},
  getRowId,
  searchPlaceholder = "بحث...",
  showSearch = true,
  showColumnToggle = true,
  columnToggleLabel = "الأعمدة",
  showPagination = true,
  pageSize = 20,
  isLoading = false,
  emptyMessage = "لا توجد بيانات",
  onRowClick,
  toolbarContent,
  toolbarStart,
  globalFilterFn: customGlobalFilterFn,
  manualPagination = false,
  pageCount,
  totalRows,
  pagination: externalPagination,
  onPaginationChange,
  compactRows = false,
  sorting: externalSorting,
  onSortingChange: externalOnSortingChange,
}: DataTableProps<TData, TValue>) {
  // ── Internal state (used when not controlled externally) ──
  const [internalSorting, setInternalSorting] = React.useState<SortingState>([]);
  const sorting = externalSorting ?? internalSorting;
  const setSorting = externalOnSortingChange ?? setInternalSorting;
  const [internalGlobalFilter, setInternalGlobalFilter] = React.useState("");
  const [internalColumnFilters, setInternalColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [internalColumnVisibility, setInternalColumnVisibility] = React.useState<VisibilityState>({});
  const [internalRowSelection, setInternalRowSelection] = React.useState<RowSelectionState>({});

  const isMobile = useIsMobile();

  // ── Resolve controlled vs uncontrolled ────────────────────
  const globalFilterValue = externalGlobalFilter ?? internalGlobalFilter;
  const setGlobalFilter = onGlobalFilterChange ?? setInternalGlobalFilter;
  const columnFiltersValue = externalColumnFilters ?? internalColumnFilters;
  const baseColumnVisibility = externalColumnVisibility ?? internalColumnVisibility;
  const rowSelectionValue = externalRowSelection ?? internalRowSelection;

  // ── Auto-hide columns on mobile via meta.hideOnMobile ──────
  const columnVisibilityValue = React.useMemo(() => {
    if (!isMobile) return baseColumnVisibility;
    const mobileHidden: VisibilityState = {};
    for (const col of columns) {
      const id = (col as any).accessorKey ?? (col as any).id;
      if (id && (col.meta as any)?.hideOnMobile) {
        mobileHidden[id] = false;
      }
    }
    return { ...mobileHidden, ...baseColumnVisibility };
  }, [isMobile, baseColumnVisibility, columns]);

  const handleRowSelectionChange: OnChangeFn<RowSelectionState> = React.useCallback(
    (updater) => {
      if (onRowSelectionChange) {
        onRowSelectionChange(updater);
      } else {
        setInternalRowSelection(updater);
      }
    },
    [onRowSelectionChange],
  );

  const handleColumnVisibilityChange = React.useCallback(
    (updater: VisibilityState | ((old: VisibilityState) => VisibilityState)) => {
      if (onColumnVisibilityChange) {
        onColumnVisibilityChange(updater);
      } else {
        setInternalColumnVisibility(typeof updater === "function" ? updater(internalColumnVisibility) : updater);
      }
    },
    [onColumnVisibilityChange, internalColumnVisibility],
  );

  const handleColumnFiltersChange: OnChangeFn<ColumnFiltersState> = React.useCallback(
    (updater) => {
      if (onColumnFiltersChange) {
        onColumnFiltersChange(updater);
      } else {
        setInternalColumnFilters(updater);
      }
    },
    [onColumnFiltersChange],
  );

  const [internalPagination, setInternalPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });
  const paginationValue = externalPagination ?? internalPagination;
  const handlePaginationChange = onPaginationChange ?? setInternalPagination;
  const pageSizeOptions = React.useMemo(
    () => Array.from(new Set([10, 15, 20, 30, 50, 100, paginationValue.pageSize])).sort((a, b) => a - b),
    [paginationValue.pageSize],
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: showPagination && !manualPagination ? getPaginationRowModel() : undefined,
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: !manualPagination ? getFilteredRowModel() : undefined,
    manualPagination,
    manualFiltering: manualPagination,
    // Server-side sorting only when an external sorting handler is provided.
    // Otherwise sort the currently-loaded page client-side so headers always work.
    manualSorting: manualPagination && !!externalOnSortingChange,
    pageCount: manualPagination ? (pageCount ?? -1) : undefined,
    onSortingChange: setSorting,
    onColumnVisibilityChange: handleColumnVisibilityChange as any,
    onColumnFiltersChange: handleColumnFiltersChange,
    onRowSelectionChange: handleRowSelectionChange,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: handlePaginationChange,
    globalFilterFn: customGlobalFilterFn ?? "includesString",
    getRowId,
    state: {
      sorting,
      columnVisibility: columnVisibilityValue,
      columnFilters: columnFiltersValue,
      rowSelection: rowSelectionValue,
      globalFilter: globalFilterValue,
      pagination: paginationValue,
    },
  });

  const activeFiltersCount = columnFiltersValue.length + (globalFilterValue ? 1 : 0);

  const selectedCount = Object.keys(rowSelectionValue).length;

  return (
    <div className="space-y-2.5">
      {/* ── Toolbar ───────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        {toolbarStart}

        {showSearch && (
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={searchPlaceholder}
              value={globalFilterValue}
              onChange={(e) => setGlobalFilter(e.target.value)}
              // ↓ h-8 بدل h-9 لتوحيد الـ toolbar مع أزرار الـ sm size
              className="pr-8 h-8 text-sm"
            />
            {globalFilterValue && (
              <button
                onClick={() => setGlobalFilter("")}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="مسح البحث"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {toolbarContent}

        {activeFiltersCount > 0 && (
          <Badge variant="secondary" className="gap-1.5 h-8 px-2.5 text-xs font-medium">
            <SlidersHorizontal className="h-3 w-3" />
            {activeFiltersCount} فلتر نشط
          </Badge>
        )}

        {showColumnToggle && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* ↓ mr-auto يدفع الزر لليسار في RTL */}
              <Button variant="outline" size="sm" className="mr-auto gap-1.5 h-8 text-xs">
                <Settings2 className="h-3.5 w-3.5" />
                {columnToggleLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs text-muted-foreground">إظهار / إخفاء الأعمدة</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllColumns()
                .filter((col) => col.getCanHide())
                .map((col) => {
                  const label =
                    columnLabels[col.id] || (typeof col.columnDef.header === "string" ? col.columnDef.header : col.id);
                  return (
                    <DropdownMenuCheckboxItem
                      key={col.id}
                      checked={col.getIsVisible()}
                      onCheckedChange={(value) => col.toggleVisibility(!!value)}
                    >
                      {label}
                    </DropdownMenuCheckboxItem>
                  );
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* ── Table ─────────────────────────────────────────── */}
      {/*
        - border بدون shadow — نتجنب الثقل البصري المزدوج
        - rounded-lg بدل rounded-xl — أنسب لجداول البيانات
      */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="relative w-full overflow-auto">
          <Table>
            {/* Header */}
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  // ↓ border-b واحد واضح بدل border-b-2 + opacity
                  className="bg-muted/40 hover:bg-muted/40 border-b border-border"
                >
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      // ↓ h-9 بدل h-11 — header أكثر إحكاماً
                      className="text-right font-semibold text-xs text-muted-foreground h-9 px-3 whitespace-nowrap uppercase tracking-wide"
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>

            {/* Body */}
            <TableBody>
              {isLoading ? (
                Array.from({ length: Math.min(pageSize, 5) }).map((_, i) => (
                  <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                    {table.getVisibleLeafColumns().map((column) => (
                      <TableCell key={column.id} className="px-3 h-8">
                        <Skeleton className="h-4 w-full max-w-[160px]" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row, idx) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className={cn(
                      compactRows
                        ? "h-9 border-b border-border/50 transition-colors"
                        : "h-11 border-b border-border/50 transition-colors",
                      idx % 2 === 1 && "bg-muted/25",
                      onRowClick ? "cursor-pointer" : "cursor-default",
                      "hover:bg-primary/5",
                    )}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={cn("px-3 text-sm", compactRows ? "py-1" : "py-2")}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-28 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Search className="h-7 w-7 text-muted-foreground/30" />
                      <p className="text-sm">{emptyMessage}</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>

            {/* Footer */}
            {table.getFooterGroups().some((fg) => fg.headers.some((h) => h.column.columnDef.footer)) && (
              <TableFooter>
                {table.getFooterGroups().map((footerGroup) => (
                  <TableRow key={footerGroup.id} className="bg-muted/30 border-t border-border h-11">
                    {footerGroup.headers.map((header) => (
                      <TableCell key={header.id} className="px-3 py-0 font-semibold text-sm">
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.footer, header.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableFooter>
            )}
          </Table>
        </div>
      </div>

      {/* ── Pagination ────────────────────────────────────── */}
      {showPagination && (
        <div className="flex items-center justify-between gap-3 flex-wrap pt-0.5">
          {/* Info */}
          <div className="flex items-center gap-3">
            {selectedCount > 0 && <span className="text-xs text-primary font-medium">{selectedCount} محدد</span>}
            <span className="text-xs text-muted-foreground">
              {manualPagination ? (
                <>{(totalRows ?? 0).toLocaleString("ar-US")} عنصر</>
              ) : table.getFilteredRowModel().rows.length !== data.length ? (
                <>
                  {table.getFilteredRowModel().rows.length} من أصل {data.length} عنصر
                </>
              ) : (
                <>{data.length} عنصر</>
              )}
            </span>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2.5">
            {/* Page size */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground whitespace-nowrap">صفوف لكل صفحة</span>
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(v) => table.setPageSize(Number(v))}
              >
                <SelectTrigger className="h-7 w-[60px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((size) => (
                    <SelectItem key={size} value={`${size}`} className="text-xs">
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Page indicator */}
            <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[90px] text-center">
              صفحة {table.getState().pagination.pageIndex + 1} من {table.getPageCount() || 1}
            </span>

            {/* Nav buttons */}
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
                aria-label="أول صفحة"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                aria-label="الصفحة السابقة"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                aria-label="الصفحة التالية"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
                aria-label="آخر صفحة"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sortable Column Header Helper ──────────────────────────
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
}: {
  column: import("@tanstack/react-table").Column<TData, TValue>;
  title: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-mr-2 h-7 gap-1 text-xs font-semibold hover:bg-muted/60 uppercase tracking-wide"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {title}
      <ArrowUpDown className="h-3 w-3 opacity-40" />
    </Button>
  );
}

// ── Selection Column Helper ────────────────────────────────
export function getSelectionColumn<TData>(): ColumnDef<TData, any> {
  return {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false}
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="تحديد الكل"
        className="translate-y-[1px]"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="تحديد الصف"
        className="translate-y-[1px]"
        onClick={(e) => e.stopPropagation()}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  };
}
