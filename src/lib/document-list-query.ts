/**
 * Shared query-building helpers for document list screens
 * (sales invoices, purchase invoices, sales returns, purchase returns).
 *
 * These helpers are intentionally pure so they can be unit tested against a
 * fake query builder without touching the network.
 */

export interface DocumentListFilters {
  /** "all" means no status filter. */
  status: string;
  /** ISO date (yyyy-MM-dd) or empty string. */
  dateFrom: string;
  /** ISO date (yyyy-MM-dd) or empty string. */
  dateTo: string;
  /** Raw search text (already debounced by the caller). */
  search: string;
}

export const EMPTY_DOCUMENT_FILTERS: DocumentListFilters = {
  status: "all",
  dateFrom: "",
  dateTo: "",
  search: "",
};

export interface DocumentQueryFields {
  /** Date column used by the date-range filters (e.g. "invoice_date"). */
  dateField: string;
  /** Sequential number column (e.g. "invoice_number"). */
  numberField: string;
  /**
   * Optional related text column used when the search term is not numeric
   * (e.g. "customers.name"). When omitted, non-numeric search is ignored,
   * preserving the previous behaviour of the returns screens.
   */
  searchTextColumn?: string;
}

/** Minimal chainable shape of a PostgREST query builder. */
interface QueryLike {
  eq: (column: string, value: unknown) => QueryLike;
  gte: (column: string, value: unknown) => QueryLike;
  lte: (column: string, value: unknown) => QueryLike;
  or: (filter: string) => QueryLike;
  ilike: (column: string, pattern: string) => QueryLike;
}

/** Apply status + date-range filters (shared by list and export queries). */
export function applyDocumentScopeFilters<Q extends QueryLike>(
  query: Q,
  filters: DocumentListFilters,
  fields: DocumentQueryFields,
): Q {
  let q = query;
  if (filters.status !== "all") q = q.eq("status", filters.status) as Q;
  if (filters.dateFrom) q = q.gte(fields.dateField, filters.dateFrom) as Q;
  if (filters.dateTo) q = q.lte(fields.dateField, filters.dateTo) as Q;
  return q;
}

/**
 * Apply the search term: numeric input matches the draft number or the posted
 * number; text input matches the related entity name when configured.
 */
export function applyDocumentSearchFilter<Q extends QueryLike>(
  query: Q,
  filters: DocumentListFilters,
  fields: DocumentQueryFields,
): Q {
  const term = filters.search.trim();
  if (!term) return query;
  const asNum = Number(term);
  if (term !== "" && !Number.isNaN(asNum)) {
    return query.or(
      `${fields.numberField}.eq.${asNum},posted_number.eq.${asNum}`,
    ) as Q;
  }
  if (fields.searchTextColumn) {
    return query.ilike(fields.searchTextColumn, `%${term}%`) as Q;
  }
  return query;
}

/** Status + dates + search, in the same order the screens used before. */
export function applyDocumentFilters<Q extends QueryLike>(
  query: Q,
  filters: DocumentListFilters,
  fields: DocumentQueryFields,
): Q {
  return applyDocumentSearchFilter(
    applyDocumentScopeFilters(query, filters, fields),
    filters,
    fields,
  );
}

/** True when any filter differs from its default value. */
export function hasActiveDocumentFilters(filters: DocumentListFilters): boolean {
  return (
    filters.status !== "all" ||
    filters.dateFrom !== "" ||
    filters.dateTo !== "" ||
    filters.search.trim() !== ""
  );
}

/** Page count for manual (server-side) pagination — never below 1. */
export function computePageCount(totalCount: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil((totalCount || 0) / pageSize));
}

/** Inclusive PostgREST range for a zero-based page index. */
export function computeRange(
  pageIndex: number,
  pageSize: number,
): { from: number; to: number } {
  const from = pageIndex * pageSize;
  return { from, to: from + pageSize - 1 };
}
