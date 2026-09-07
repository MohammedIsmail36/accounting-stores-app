ALTER TABLE public.telegram_settings ADD COLUMN IF NOT EXISTS price_source text NOT NULL DEFAULT 'selling';
ALTER TABLE public.telegram_settings DROP CONSTRAINT IF EXISTS telegram_settings_price_source_check;
ALTER TABLE public.telegram_settings ADD CONSTRAINT telegram_settings_price_source_check CHECK (price_source IN ('selling','barcode'));