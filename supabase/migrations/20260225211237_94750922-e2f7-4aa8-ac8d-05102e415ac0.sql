
-- Add parent_id column to product_categories for hierarchical structure
ALTER TABLE public.product_categories
ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.product_categories(id) ON DELETE SET NULL;

-- Create index for faster hierarchical queries
CREATE INDEX IF NOT EXISTS idx_product_categories_parent_id ON public.product_categories(parent_id);
