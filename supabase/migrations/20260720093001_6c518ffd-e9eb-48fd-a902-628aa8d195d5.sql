-- Ensure company_settings is a true singleton
-- 1. Keep only the oldest row (or the one with actual data if oldest is empty)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    ORDER BY
      -- prefer rows with a non-default company_name
      CASE WHEN company_name IS NOT NULL AND company_name <> '' AND company_name <> 'شركتي' THEN 0 ELSE 1 END,
      created_at ASC
  ) AS rn
  FROM public.company_settings
)
DELETE FROM public.company_settings
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Add a singleton guard column so only one row can ever exist
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS singleton boolean GENERATED ALWAYS AS (true) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS company_settings_singleton_idx
  ON public.company_settings (singleton);