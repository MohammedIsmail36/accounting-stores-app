
-- Categories table
CREATE TABLE public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized users can view categories" ON public.product_categories FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
CREATE POLICY "Admin/accountant can manage categories" ON public.product_categories FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- Seed default categories
INSERT INTO public.product_categories (name) VALUES ('عام'),('إلكترونيات'),('أثاث'),('مواد غذائية'),('مستلزمات مكتبية'),('قطع غيار'),('مواد خام'),('أخرى');

-- Units table
CREATE TABLE public.product_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  symbol text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized users can view units" ON public.product_units FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
CREATE POLICY "Admin/accountant can manage units" ON public.product_units FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- Seed default units
INSERT INTO public.product_units (name, symbol) VALUES ('قطعة','pc'),('كيلو','kg'),('متر','m'),('لتر','L'),('علبة','box'),('كرتون','ctn'),('طن','ton'),('دزينة','dz');

-- Brands table
CREATE TABLE public.product_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  logo_url text,
  country text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized users can view brands" ON public.product_brands FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
CREATE POLICY "Admin/accountant can manage brands" ON public.product_brands FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- Add new columns to products
ALTER TABLE public.products
  ADD COLUMN brand_id uuid REFERENCES public.product_brands(id),
  ADD COLUMN category_id uuid REFERENCES public.product_categories(id),
  ADD COLUMN unit_id uuid REFERENCES public.product_units(id),
  ADD COLUMN model_number text,
  ADD COLUMN barcode text UNIQUE,
  ADD COLUMN main_image_url text;

-- Migrate existing category/unit text to FK references
UPDATE public.products p SET category_id = (SELECT id FROM public.product_categories WHERE name = p.category);
UPDATE public.products p SET unit_id = (SELECT id FROM public.product_units WHERE name = p.unit);

-- Product images gallery table
CREATE TABLE public.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized users can view product images" ON public.product_images FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
CREATE POLICY "Admin/accountant can manage product images" ON public.product_images FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- Storage bucket for product images
INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true);

CREATE POLICY "Anyone can view product images" ON storage.objects FOR SELECT USING (bucket_id = 'product-images');
CREATE POLICY "Admin/accountant can upload product images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')));
CREATE POLICY "Admin/accountant can update product images" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')));
CREATE POLICY "Admin/accountant can delete product images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')));
