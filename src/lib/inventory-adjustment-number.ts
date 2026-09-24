import { formatDisplayNumber } from "@/lib/posted-number-utils";

/** Draft numbers are internal; legacy approved/posted rows retain their historical label. */
export function formatInventoryAdjustmentNumber(
  status: string,
  draftNumber: number,
  postedNumber: number | null,
): string {
  const legacyOfficial = ["approved", "posted", "cancelled"].includes(status)
    ? postedNumber ?? draftNumber
    : null;
  return formatDisplayNumber(
    "ADJ-",
    legacyOfficial,
    draftNumber,
    status === "approved" ? "posted" : status,
  );
}
