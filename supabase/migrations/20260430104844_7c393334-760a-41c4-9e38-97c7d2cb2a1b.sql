-- Indexes to speed up product search and brand filtering
CREATE INDEX IF NOT EXISTS idx_products_brand_id ON public.products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);

-- Trigram indexes for fast ILIKE %term% searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON public.products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_code_trgm ON public.products USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_barcode_trgm ON public.products USING gin (barcode gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_model_number_trgm ON public.products USING gin (model_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_product_brands_name_trgm ON public.product_brands USING gin (name gin_trgm_ops);