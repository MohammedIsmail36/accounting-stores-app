import { supabase } from "@/integrations/supabase/client";

export interface InventoryProductIdentity {
  brandName: string | null;
  modelNumber: string | null;
}

// Read only display fields for visible products; the diagnostic owns all figures.
export async function loadInventoryProductIdentities(productIds: string[]) {
  const identities = new Map<string, InventoryProductIdentity>();
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return identities;

  const { data, error } = await supabase
    .from("products")
    .select("id, model_number, product_brands(name)")
    .in("id", ids);
  if (error) throw error;

  for (const product of data ?? []) {
    identities.set(product.id, {
      brandName: product.product_brands?.name ?? null,
      modelNumber: product.model_number ?? null,
    });
  }
  return identities;
}
