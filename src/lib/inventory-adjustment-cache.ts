import type { QueryClient } from "@tanstack/react-query";

export const inventoryAdjustmentsQueryKey = ["inventory-adjustments"] as const;

export interface InventoryAdjustmentListRow {
  id: string;
  adjustment_number: number;
  posted_number: number | null;
  adjustment_date: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface SavedInventoryAdjustment {
  id: string;
  adjustmentNumber: number;
  updatedAt: string;
  adjustmentDate: string;
  description: string;
}

export function upsertSavedInventoryAdjustmentInCache(
  queryClient: QueryClient,
  saved: SavedInventoryAdjustment,
): void {
  queryClient.setQueryData<InventoryAdjustmentListRow[]>(
    inventoryAdjustmentsQueryKey,
    (rows) => {
      // If the list was never loaded, let its first visit fetch normally.
      if (!rows) return undefined;
      const previous = rows.find((row) => row.id === saved.id);
      const updated: InventoryAdjustmentListRow = {
        id: saved.id,
        adjustment_number: saved.adjustmentNumber,
        posted_number: null,
        adjustment_date: saved.adjustmentDate,
        description: saved.description.trim() || null,
        status: "draft",
        created_at: previous?.created_at ?? saved.updatedAt,
        updated_at: saved.updatedAt,
      };
      return [...rows.filter((row) => row.id !== saved.id), updated]
        .sort((a, b) => b.adjustment_number - a.adjustment_number);
    },
  );
  // Keep the row visible immediately; the list reconciles with the server on mount.
  void queryClient.invalidateQueries({
    queryKey: inventoryAdjustmentsQueryKey,
    refetchType: "none",
  });
}

export function removeDeletedInventoryAdjustmentFromCache(
  queryClient: QueryClient,
  adjustmentId: string,
): void {
  queryClient.setQueryData<{ id: string }[]>(
    inventoryAdjustmentsQueryKey,
    (rows) => rows?.filter((row) => row.id !== adjustmentId),
  );
  void queryClient.invalidateQueries({
    queryKey: inventoryAdjustmentsQueryKey,
    refetchType: "all",
  });
}
