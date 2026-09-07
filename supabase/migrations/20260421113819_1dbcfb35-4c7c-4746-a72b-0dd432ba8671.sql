ALTER TABLE public.company_settings
ADD COLUMN IF NOT EXISTS product_code_prefix text NOT NULL DEFAULT 'PRD-';