import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { PaginationState } from "@tanstack/react-table";
import { supabase } from "@/integrations/supabase/client";
import { notify } from "@/lib/notify";
import { useQuery } from "@tanstack/react-query";
import { usePagedQuery, useDebouncedValue } from "@/hooks/use-paged-query";
import {
  applyDocumentFilters,
  applyDocumentScopeFilters,
  computePageCount,
  computeRange,
  hasActiveDocumentFilters,
  type DocumentListFilters,
  type DocumentQueryFields,
} from "@/lib/document-list-query";

export const DOCUMENT_LIST_PAGE_SIZE = 20;

export interface UseDocumentListConfig<TRow> extends DocumentQueryFields {
  /** Stable prefix for the react-query key (e.g. "sales-list"). */
  queryKey: string;
  /** Table name (e.g. "sales_invoices"). */
  table: string;
  /** PostgREST select string, including the embedded entity relation. */
  select: string;
  /** Toast message shown when the list query fails. */
  errorMessage: string;
  /** Flattens the embedded relation into the row (e.g. customer_name). */
  mapRow: (raw: any) => TRow;
  /** Maps a row to an export line; used by ExportMenu. */
  mapExportRow: (row: TRow) => any[];
  pageSize?: number;
}

/**
 * Shared data layer for document list screens: filters, server-side
 * pagination, and full-dataset export preparation.
 */
export function useDocumentList<TRow>(config: UseDocumentListConfig<TRow>) {
  const pageSize = config.pageSize ?? DOCUMENT_LIST_PAGE_SIZE;

  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });

  const fields: DocumentQueryFields = {
    dateField: config.dateField,
    numberField: config.numberField,
    searchTextColumn: config.searchTextColumn,
  };

  const filters: DocumentListFilters = {
    status: statusFilter,
    dateFrom,
    dateTo,
    search: debouncedSearch,
  };

  const { data: pagedData, isLoading } = usePagedQuery<TRow>(
    [
      config.queryKey,
      pagination.pageIndex,
      pagination.pageSize,
      statusFilter,
      dateFrom,
      dateTo,
      debouncedSearch,
    ] as const,
    async () => {
      const { from, to } = computeRange(pagination.pageIndex, pagination.pageSize);
      let q = (supabase.from(config.table as any) as any)
        .select(config.select, { count: "exact" })
        .order(config.numberField, { ascending: false })
        .range(from, to);
      q = applyDocumentFilters(q, filters, fields);

      const { data, error, count } = await q;
      if (error) {
        notify.error("خطأ", config.errorMessage);
        throw error;
      }
      return {
        rows: (data || []).map(config.mapRow),
        totalCount: count ?? 0,
      };
    },
  );

  const rows = pagedData?.rows ?? [];
  const totalCount = pagedData?.totalCount ?? 0;
  const pageCount = computePageCount(totalCount, pagination.pageSize);

  // Reset to the first page whenever a filter changes.
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [statusFilter, dateFrom, dateTo, debouncedSearch]);

  const fetchAllRows = useCallback(
    async (onProgress?: (loaded: number, total: number) => void): Promise<TRow[]> => {
      const { fetchAllPaged } = await import("@/lib/paged-fetch");
      const raw = await fetchAllPaged<any>(
        () => {
          const q = (supabase.from(config.table as any) as any)
            .select(config.select, { count: "exact" })
            .order(config.numberField, { ascending: false });
          // Export ignores the free-text search, matching previous behaviour.
          return applyDocumentScopeFilters(q, filters, fields);
        },
        { batchSize: 500, maxRows: 50000, onProgress },
      );
      return raw.map(config.mapRow);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.table, config.select, config.numberField, statusFilter, dateFrom, dateTo],
  );

  const [exportRows, setExportRows] = useState<any[][]>([]);
  useEffect(() => {
    setExportRows([]);
  }, [statusFilter, dateFrom, dateTo, debouncedSearch]);

  const handlePrepareExport = useCallback(
    async (onProgress?: (loaded: number, total: number) => void) => {
      const all = await fetchAllRows(onProgress);
      const mapped = all.map(config.mapExportRow);
      setExportRows(mapped);
      return { rows: mapped };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchAllRows, config.mapExportRow],
  );

  const hasFilters = hasActiveDocumentFilters({ ...filters, search });

  const clearFilters = useCallback(() => {
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
    setSearch("");
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, []);

  return {
    // filters
    statusFilter,
    setStatusFilter,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    search,
    setSearch,
    debouncedSearch,
    hasFilters,
    clearFilters,
    // data
    rows,
    totalCount,
    pageCount,
    isLoading,
    pagination,
    setPagination,
    pageSize,
    // export
    exportRows,
    handlePrepareExport,
    fetchAllRows,
  };
}

export interface DocumentStatusSummary {
  total: number;
  draft: number;
  posted: number;
  cancelled: number;
  totalAmount: number;
}

/**
 * Lightweight status/amount summary for document lists that have no dedicated
 * summary RPC (returns screens). Only posted documents feed the amount total.
 */
export function useDocumentStatusSummary(args: {
  queryKey: string;
  table: string;
  dateField: string;
  dateFrom: string;
  dateTo: string;
}) {
  return useQuery({
    queryKey: [args.queryKey, args.dateFrom, args.dateTo] as const,
    queryFn: async (): Promise<DocumentStatusSummary> => {
      let q = (supabase.from(args.table as any) as any).select("status, total");
      if (args.dateFrom) q = q.gte(args.dateField, args.dateFrom);
      if (args.dateTo) q = q.lte(args.dateField, args.dateTo);
      const { data, error } = await q;
      if (error) throw error;
      const s: DocumentStatusSummary = {
        total: (data || []).length,
        draft: 0,
        posted: 0,
        cancelled: 0,
        totalAmount: 0,
      };
      (data || []).forEach((r: any) => {
        if (r.status === "draft") s.draft++;
        else if (r.status === "posted") {
          s.posted++;
          s.totalAmount += Number(r.total);
        } else if (r.status === "cancelled") s.cancelled++;
      });
      return s;
    },
    staleTime: 30_000,
  });
}
