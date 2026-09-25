import type { QueryClient } from "@tanstack/react-query";

export const inventoryAdjustmentsQueryKey = ["inventory-adjustments"] as const;

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
