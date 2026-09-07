import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";

/** Debounce a value (default 300ms). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Wrapper around useQuery with sensible defaults for paged lists. */
export function usePagedQuery<TRow>(
  key: readonly unknown[],
  fetcher: () => Promise<{ rows: TRow[]; totalCount: number }>,
  options?: { enabled?: boolean; staleTime?: number },
) {
  return useQuery({
    queryKey: key,
    queryFn: fetcher,
    placeholderData: keepPreviousData,
    staleTime: options?.staleTime ?? 30_000,
    enabled: options?.enabled,
  });
}
