/**
 * Fetches all matching rows from a Supabase query in batches, reporting progress.
 *
 * The `queryBuilder` is invoked fresh for each batch (filters + ordering must be applied
 * inside the builder) — Supabase query objects are mutable and cannot be safely reused.
 *
 * The first call must select with `{ count: "exact" }` so the helper can determine the total.
 */
export async function fetchAllPaged<T>(
  queryBuilder: () => any,
  opts: {
    batchSize?: number;
    onProgress?: (loaded: number, total: number) => void;
    maxRows?: number;
    signal?: AbortSignal;
  } = {}
): Promise<T[]> {
  const batchSize = opts.batchSize ?? 500;
  const maxRows = opts.maxRows ?? 50000;

  const throwIfAborted = () => {
    if (opts.signal?.aborted) {
      throw new DOMException("تم إلغاء تحميل البيانات", "AbortError");
    }
  };
  const fetchRange = async (from: number, to: number) => {
    throwIfAborted();
    let query = queryBuilder();
    if (opts.signal && typeof query.abortSignal === "function") {
      query = query.abortSignal(opts.signal);
    }
    const result = await query.range(from, to);
    throwIfAborted();
    return result;
  };

  const first = await fetchRange(0, batchSize - 1);
  if (first.error) throw first.error;

  const total = first.count ?? first.data?.length ?? 0;
  if (total > maxRows) {
    throw new Error(
      `عدد السجلات (${total}) يتجاوز الحد الآمن للتحميل (${maxRows}). يرجى تضييق نطاق البحث.`,
    );
  }
  let collected: T[] = (first.data ?? []) as T[];
  opts.onProgress?.(collected.length, total);

  while (collected.length < total) {
    const from = collected.length;
    const to = Math.min(from + batchSize, total) - 1;
    const next = await fetchRange(from, to);
    if (next.error) throw next.error;
    const batch = (next.data ?? []) as T[];
    if (batch.length === 0) break;
    collected = collected.concat(batch);
    opts.onProgress?.(collected.length, total);
  }

  return collected;
}
