import { describe, expect, it } from "vitest";
import { fetchAllPaged } from "./paged-fetch";

describe("RED characterization: payment-list completeness", () => {
  it("collects 1,001 rows when exact count and stable pages are available", async () => {
    const rows = Array.from({ length: 1001 }, (_, id) => ({ id }));
    const result = await fetchAllPaged<{ id: number }>(
      () => ({
        range: async (from: number, to: number) => ({
          data: rows.slice(from, to + 1),
          count: rows.length,
          error: null,
        }),
      }),
      { batchSize: 500 },
    );

    expect(result).toHaveLength(1001);
    expect(result.at(-1)).toEqual({ id: 1000 });
  });

  it("rejects 50,001 rows instead of returning the first 50,000", async () => {
    await expect(
      fetchAllPaged(
        () => ({
          range: async () => ({ data: [{ id: 0 }], count: 50001, error: null }),
        }),
        { batchSize: 500, maxRows: 50000 },
      ),
    ).rejects.toThrow("عدد السجلات (50001) يتجاوز الحد الآمن للتحميل (50000)");
  });

  it("returns an incomplete first page as complete when exact count is unavailable", async () => {
    const ranges: Array<[number, number]> = [];
    const result = await fetchAllPaged<{ id: number }>(
      () => ({
        range: async (from: number, to: number) => {
          ranges.push([from, to]);
          return {
            data: Array.from({ length: 500 }, (_, id) => ({ id })),
            count: null,
            error: null,
          };
        },
      }),
      { batchSize: 500 },
    );

    expect(result).toHaveLength(500);
    expect(ranges).toEqual([[0, 499]]);
  });

  it("returns a short list after a silent empty page despite a larger exact count", async () => {
    const ranges: Array<[number, number]> = [];
    const progress: Array<[number, number]> = [];
    const result = await fetchAllPaged<{ id: number }>(
      () => ({
        range: async (from: number, to: number) => {
          ranges.push([from, to]);
          return {
            data: from === 0 ? Array.from({ length: 500 }, (_, id) => ({ id })) : [],
            count: 1001,
            error: null,
          };
        },
      }),
      { batchSize: 500, onProgress: (loaded, total) => progress.push([loaded, total]) },
    );

    expect(result).toHaveLength(500);
    expect(ranges).toEqual([[0, 499], [500, 999]]);
    expect(progress).toEqual([[500, 1001]]);
  });
});
