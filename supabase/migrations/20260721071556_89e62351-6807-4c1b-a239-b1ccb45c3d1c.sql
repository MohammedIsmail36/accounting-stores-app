ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode_label TEXT,
  ADD COLUMN IF NOT EXISTS barcode_price NUMERIC(12,2);