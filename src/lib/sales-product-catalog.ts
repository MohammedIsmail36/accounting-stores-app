import type { Database, Json } from "@/integrations/supabase/types";
import type { LoadedItemRow } from "@/lib/document-items-mapping";
import type { ProductWithBrand } from "@/lib/product-utils";
type SalesProductCatalogRpcRow =
  Database["public"]["Functions"]["get_sales_product_catalog"]["Returns"][number];

export type SalesProductCatalogItem = ProductWithBrand & {
  selling_price: number;
  quantity_on_hand: number;
  is_active: boolean;
};

function normalizeBrand(value: Json): { name: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = value.name;
  return typeof name === "string" ? { name } : null;
}

/**
 * Pick the public sales fields explicitly so an accidental future RPC field
 * cannot flow into the browser's product objects unnoticed.
 */
export function normalizeSalesProductCatalog(
  rows: SalesProductCatalogRpcRow[] | null | undefined,
): SalesProductCatalogItem[] {
  return (rows || []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    barcode: row.barcode,
    model_number: row.model_number,
    selling_price: Number(row.selling_price) || 0,
    quantity_on_hand: Number(row.quantity_on_hand) || 0,
    is_active: row.is_active,
    product_brands: normalizeBrand(row.product_brands),
  }));
}

/** Restore safe product display data for existing document lines without a
 * direct PostgREST relationship read from the protected products table. */
export function hydrateSalesDocumentItems(
  rows: LoadedItemRow[] | null | undefined,
  catalog: SalesProductCatalogItem[],
): LoadedItemRow[] {
  const byId = new Map(catalog.map((product) => [product.id, product]));

  return (rows || []).map((row) => {
    const product = row.product_id ? byId.get(row.product_id) : undefined;
    return {
      ...row,
      products: product
        ? {
            name: product.name,
            code: product.code,
            model_number: product.model_number,
            product_brands: product.product_brands,
          }
        : null,
    };
  });
}
