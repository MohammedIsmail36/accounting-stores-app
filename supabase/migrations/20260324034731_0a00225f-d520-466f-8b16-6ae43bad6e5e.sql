
ALTER TABLE public.purchase_invoice_items ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.sales_invoice_items ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.purchase_return_items ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.sales_return_items ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
