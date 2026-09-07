import { supabase } from "@/integrations/supabase/client";

/**
 * Generate the next sequential entity code for a table.
 *
 * Looks up the highest existing code matching `prefix` and increments by 1.
 * Returns codes zero-padded to 3 digits, e.g. "CUST-001", "SUPP-042".
 */
type EntityTable = "customers" | "suppliers" | "products";

export async function generateEntityCode(
  table: EntityTable,
  prefix: string,
): Promise<string> {
  const { data } = await (supabase.from(table) as any)
    .select("code")
    .ilike("code", `${prefix}%`)
    .order("code", { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const lastNum = parseInt(data[0].code.replace(prefix, ""), 10) || 0;
    return `${prefix}${String(lastNum + 1).padStart(3, "0")}`;
  }
  return `${prefix}001`;
}

/**
 * Compute the EAN-13 check digit for a 12-digit string.
 *
 * Uses the standard algorithm: sum of digits at odd positions × 1 +
 * digits at even positions × 3. Check digit = (10 − sum % 10) % 10.
 */
export function computeEAN13CheckDigit(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(digits12[i], 10);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Generate the next sequential EAN-13 barcode for a product.
 *
 * Format: "200" (in-store prefix) + 9-digit sequential + check digit.
 * Queries the highest existing barcode starting with "200" from the
 * products table, increments by 1, and computes the EAN-13 check digit.
 */
export async function generateProductBarcode(): Promise<string> {
  const { data } = await (supabase.from("products") as any)
    .select("barcode")
    .ilike("barcode", "200%")
    .order("barcode", { ascending: false })
    .limit(1);

  let nextSeq = 1;
  if (data && data.length > 0 && data[0].barcode) {
    const existing = data[0].barcode as string;
    // Extract the 9-digit sequential part (positions 3–11)
    const seqPart = existing.substring(3, 12);
    const parsed = parseInt(seqPart, 10);
    if (!isNaN(parsed)) nextSeq = parsed + 1;
  }

  const digits12 = "200" + String(nextSeq).padStart(9, "0");
  const checkDigit = computeEAN13CheckDigit(digits12);
  return digits12 + String(checkDigit);
}
