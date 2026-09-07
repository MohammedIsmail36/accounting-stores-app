import { useState } from "react";
import { round2 } from "@/lib/utils";
import { formatProductName, ProductWithBrand } from "@/lib/product-utils";

interface BaseItem {
  id?: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  cost_price?: number;
  discount: number;
  total: number;
}

interface UseLineItemsConfig {
  /** Which product price to use as unit_price */
  priceField: "selling_price" | "purchase_price";
  /** Whether to track cost_price on each item */
  hasCostPrice?: boolean;
}

type ProductLike = ProductWithBrand & {
  selling_price?: number;
  purchase_price?: number;
};

export function useLineItems<T extends BaseItem>(
  config: UseLineItemsConfig,
  products: ProductLike[],
) {
  const emptyItem = (): T => {
    const base: BaseItem = {
      product_id: "",
      product_name: "",
      quantity: 1,
      unit_price: 0,
      discount: 0,
      total: 0,
    };
    if (config.hasCostPrice) base.cost_price = 0;
    return base as T;
  };

  const [items, setItems] = useState<T[]>([]);

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
    setTimeout(() => {
      const rows = document.querySelectorAll("[data-invoice-row]");
      const lastRow = rows[rows.length - 1];
      const comboBtn = lastRow?.querySelector(
        "[role='combobox']",
      ) as HTMLButtonElement | null;
      comboBtn?.click();
    }, 50);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateItem(index: number, field: string, value: any) {
    setItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index], [field]: value };
      if (field === "product_id") {
        const prod = products.find((p) => p.id === value);
        if (prod) {
          item.product_name = formatProductName(prod, { withCode: true });
          item.unit_price = (prod as any)[config.priceField] ?? 0;
          if (config.hasCostPrice) {
            item.cost_price = prod.purchase_price ?? 0;
          }
        }
      }
      item.total = round2(item.quantity * item.unit_price - item.discount);
      updated[index] = item;
      return updated;
    });
  }

  function handleLastFieldKeyDown(e: React.KeyboardEvent, rowIndex: number) {
    if (rowIndex !== items.length - 1) return;
    if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      addItem();
    }
  }

  return {
    items,
    setItems,
    addItem,
    removeItem,
    updateItem,
    handleLastFieldKeyDown,
  };
}
