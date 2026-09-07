import { supabase } from "@/integrations/supabase/client";

type TableName =
  | "sales_invoices"
  | "purchase_invoices"
  | "sales_returns"
  | "purchase_returns"
  | "customer_payments"
  | "supplier_payments"
  | "journal_entries"
  | "expenses";

export async function getNextPostedNumber(table: TableName): Promise<number> {
  const { data } = await (supabase.from(table) as any)
    .select("posted_number")
    .not("posted_number", "is", null)
    .order("posted_number", { ascending: false })
    .limit(1);
  const max = data?.[0]?.posted_number || 0;
  return max + 1;
}

export function formatDisplayNumber(
  prefix: string,
  postedNumber: number | null,
  draftNumber: number,
  status: string,
): string {
  if (status === "posted" && postedNumber) {
    return `${prefix}${String(postedNumber).padStart(4, "0")}`;
  }
  if (status === "cancelled" && postedNumber) {
    return `${prefix}${String(postedNumber).padStart(4, "0")}`;
  }
  return `#${draftNumber}`;
}
