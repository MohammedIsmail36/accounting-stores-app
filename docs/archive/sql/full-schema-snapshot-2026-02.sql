-- ARCHIVED SQL — DO NOT EXECUTE.
-- Historical schema snapshot generated in February 2026 and subsequently
-- edited. It is incomplete relative to supabase/migrations and is not a
-- bootstrap, backup, restore source, or deployment input.
-- ============================================
-- النظام المحاسبي - ملف إنشاء قاعدة البيانات الكامل
-- تاريخ التوليد: 2026-02-19
-- ============================================

-- ==========================================
-- 1. ENUMS
-- ==========================================
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'accountant', 'sales');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.inventory_movement_type AS ENUM (
    'opening_balance', 'purchase', 'purchase_return', 'sale', 'sale_return', 'adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==========================================
-- 2. SEQUENCES
-- ==========================================
CREATE SEQUENCE IF NOT EXISTS public.journal_entries_entry_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.sales_invoices_invoice_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.purchase_invoices_invoice_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.sales_returns_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.purchase_returns_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.customer_payments_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.supplier_payments_number_seq;

-- ==========================================
-- 3. TABLES
-- ==========================================

-- profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL PRIMARY KEY,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- accounts (شجرة الحسابات)
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  account_type text NOT NULL,
  description text,
  is_parent boolean NOT NULL DEFAULT false,
  parent_id uuid REFERENCES public.accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Backfill for pre-existing databases where these were added later
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_code_key' AND conrelid = 'public.accounts'::regclass
  ) THEN
    BEGIN
      ALTER TABLE public.accounts ADD CONSTRAINT accounts_code_key UNIQUE (code);
    EXCEPTION WHEN unique_violation THEN
      -- Duplicates exist; the dedup migration will handle them then add the constraint
      NULL;
    END;
  END IF;
END $$;


-- company_settings
CREATE TABLE IF NOT EXISTS public.company_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name text NOT NULL DEFAULT '',
  company_name_en text DEFAULT '',
  logo_url text DEFAULT '',
  address text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  website text DEFAULT '',
  tax_number text DEFAULT '',
  commercial_register text DEFAULT '',
  business_activity text DEFAULT '',
  default_currency text NOT NULL DEFAULT 'EGP',
  fiscal_year_start text NOT NULL DEFAULT '01-01',
  tax_rate numeric NOT NULL DEFAULT 0,
  payment_terms_days integer NOT NULL DEFAULT 30,
  sales_invoice_prefix text NOT NULL DEFAULT 'INV-',
  purchase_invoice_prefix text NOT NULL DEFAULT 'PUR-',
  sales_return_prefix text NOT NULL DEFAULT 'SRN-',
  purchase_return_prefix text NOT NULL DEFAULT 'PRN-',
  customer_payment_prefix text NOT NULL DEFAULT 'CPY-',
  supplier_payment_prefix text NOT NULL DEFAULT 'SPY-',
  show_tax_on_invoice boolean NOT NULL DEFAULT true,
  show_discount_on_invoice boolean NOT NULL DEFAULT true,
  invoice_footer text DEFAULT '',
  invoice_notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  singleton boolean GENERATED ALWAYS AS (true) STORED
);
CREATE UNIQUE INDEX IF NOT EXISTS company_settings_singleton_idx
  ON public.company_settings (singleton);

-- customers
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  phone text,
  email text,
  address text,
  contact_person text,
  tax_number text,
  balance numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- suppliers
CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  phone text,
  email text,
  address text,
  contact_person text,
  tax_number text,
  balance numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- product_categories
CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- product_units
CREATE TABLE IF NOT EXISTS public.product_units (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  symbol text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- product_brands
CREATE TABLE IF NOT EXISTS public.product_brands (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  country text,
  logo_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- products
CREATE TABLE IF NOT EXISTS public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  category_id uuid REFERENCES public.product_categories(id),
  unit_id uuid REFERENCES public.product_units(id),
  brand_id uuid REFERENCES public.product_brands(id),
  barcode text,
  barcode_label text,
  barcode_price numeric(12,2),
  model_number text,
  main_image_url text,
  purchase_price numeric NOT NULL DEFAULT 0,
  selling_price numeric NOT NULL DEFAULT 0,
  quantity_on_hand numeric NOT NULL DEFAULT 0,
  min_stock_level numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- product_images
CREATE TABLE IF NOT EXISTS public.product_images (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id),
  image_url text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- journal_entries
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_number integer NOT NULL DEFAULT nextval('journal_entries_entry_number_seq'),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL,
  total_debit numeric NOT NULL DEFAULT 0,
  total_credit numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- journal_entry_lines
CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  journal_entry_id uuid NOT NULL REFERENCES public.journal_entries(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  debit numeric NOT NULL DEFAULT 0,
  credit numeric NOT NULL DEFAULT 0,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- sales_invoices
CREATE TABLE IF NOT EXISTS public.sales_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number integer NOT NULL DEFAULT nextval('sales_invoices_invoice_number_seq'),
  customer_id uuid REFERENCES public.customers(id),
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  reference text,
  notes text,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- sales_invoice_items
CREATE TABLE IF NOT EXISTS public.sales_invoice_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES public.sales_invoices(id),
  product_id uuid REFERENCES public.products(id),
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- purchase_invoices
CREATE TABLE IF NOT EXISTS public.purchase_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number integer NOT NULL DEFAULT nextval('purchase_invoices_invoice_number_seq'),
  supplier_id uuid REFERENCES public.suppliers(id),
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  reference text,
  notes text,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- purchase_invoice_items
CREATE TABLE IF NOT EXISTS public.purchase_invoice_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id),
  product_id uuid REFERENCES public.products(id),
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- sales_returns
CREATE TABLE IF NOT EXISTS public.sales_returns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  return_number integer NOT NULL DEFAULT nextval('sales_returns_number_seq'),
  sales_invoice_id uuid REFERENCES public.sales_invoices(id),
  customer_id uuid REFERENCES public.customers(id),
  return_date date NOT NULL DEFAULT CURRENT_DATE,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  reference text,
  notes text,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- sales_return_items
CREATE TABLE IF NOT EXISTS public.sales_return_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  return_id uuid NOT NULL REFERENCES public.sales_returns(id),
  product_id uuid REFERENCES public.products(id),
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- purchase_returns
CREATE TABLE IF NOT EXISTS public.purchase_returns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  return_number integer NOT NULL DEFAULT nextval('purchase_returns_number_seq'),
  purchase_invoice_id uuid REFERENCES public.purchase_invoices(id),
  supplier_id uuid REFERENCES public.suppliers(id),
  return_date date NOT NULL DEFAULT CURRENT_DATE,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  reference text,
  notes text,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- purchase_return_items
CREATE TABLE IF NOT EXISTS public.purchase_return_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  return_id uuid NOT NULL REFERENCES public.purchase_returns(id),
  product_id uuid REFERENCES public.products(id),
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- customer_payments
CREATE TABLE IF NOT EXISTS public.customer_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_number integer NOT NULL DEFAULT nextval('customer_payments_number_seq'),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  sales_invoice_id uuid REFERENCES public.sales_invoices(id),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash',
  reference text,
  notes text,
  status text NOT NULL DEFAULT 'draft',
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- customer_payment_allocations
CREATE TABLE IF NOT EXISTS public.customer_payment_allocations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES public.customer_payments(id),
  invoice_id uuid NOT NULL REFERENCES public.sales_invoices(id),
  allocated_amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- supplier_payments
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_number integer NOT NULL DEFAULT nextval('supplier_payments_number_seq'),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  purchase_invoice_id uuid REFERENCES public.purchase_invoices(id),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash',
  reference text,
  notes text,
  status text NOT NULL DEFAULT 'draft',
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- supplier_payment_allocations
CREATE TABLE IF NOT EXISTS public.supplier_payment_allocations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES public.supplier_payments(id),
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id),
  allocated_amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- inventory_movements
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id),
  movement_type public.inventory_movement_type NOT NULL,
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ==========================================
-- 4. FUNCTIONS
-- ==========================================

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_count INTEGER;
  assigned_role app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));

  SELECT COUNT(*) INTO user_count FROM public.user_roles;

  IF user_count = 0 THEN
    assigned_role := 'admin';
  ELSE
    assigned_role := 'sales';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_avg_purchase_price(_product_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    CASE WHEN SUM(quantity) > 0 THEN SUM(total_cost) / SUM(quantity) ELSE 0 END,
    0
  )
  FROM public.inventory_movements
  WHERE product_id = _product_id
    AND movement_type IN ('purchase', 'opening_balance')
$$;

CREATE OR REPLACE FUNCTION public.get_avg_selling_price(_product_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    CASE WHEN SUM(quantity) > 0 THEN SUM(total_cost) / SUM(quantity) ELSE 0 END,
    0
  )
  FROM public.inventory_movements
  WHERE product_id = _product_id
    AND movement_type = 'sale'
$$;

-- ==========================================
-- 5. TRIGGERS
-- ==========================================

-- Trigger: إنشاء ملف شخصي تلقائي عند التسجيل
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Triggers: تحديث updated_at تلقائياً
CREATE OR REPLACE TRIGGER update_accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_company_settings_updated_at BEFORE UPDATE ON public.company_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_journal_entries_updated_at BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_sales_invoices_updated_at BEFORE UPDATE ON public.sales_invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_purchase_invoices_updated_at BEFORE UPDATE ON public.purchase_invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_sales_returns_updated_at BEFORE UPDATE ON public.sales_returns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_purchase_returns_updated_at BEFORE UPDATE ON public.purchase_returns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_customer_payments_updated_at BEFORE UPDATE ON public.customer_payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_supplier_payments_updated_at BEFORE UPDATE ON public.supplier_payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==========================================
-- 6. ROW LEVEL SECURITY (RLS)
-- ==========================================

-- === profiles ===
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING ((id = auth.uid()) OR has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (id = auth.uid());
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
CREATE POLICY "Admins can update profiles" ON public.profiles FOR UPDATE USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
CREATE POLICY "Admins can delete profiles" ON public.profiles FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === user_roles ===
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;
CREATE POLICY "Users can view own role" ON public.user_roles FOR SELECT USING ((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
CREATE POLICY "Admins can insert roles" ON public.user_roles FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
CREATE POLICY "Admins can update roles" ON public.user_roles FOR UPDATE USING (has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
CREATE POLICY "Admins can delete roles" ON public.user_roles FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === accounts ===
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view accounts" ON public.accounts;
CREATE POLICY "Authorized users can view accounts" ON public.accounts FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admins can insert accounts" ON public.accounts;
CREATE POLICY "Admins can insert accounts" ON public.accounts FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admins can update accounts" ON public.accounts;
CREATE POLICY "Admins can update accounts" ON public.accounts FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admins can delete accounts" ON public.accounts;
CREATE POLICY "Admins can delete accounts" ON public.accounts FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === company_settings ===
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view settings" ON public.company_settings;
CREATE POLICY "Authenticated users can view settings" ON public.company_settings FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admins can insert settings" ON public.company_settings;
CREATE POLICY "Admins can insert settings" ON public.company_settings FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins can update settings" ON public.company_settings;
CREATE POLICY "Admins can update settings" ON public.company_settings FOR UPDATE USING (has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins can delete settings" ON public.company_settings;
CREATE POLICY "Admins can delete settings" ON public.company_settings FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === customers ===
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view customers" ON public.customers;
CREATE POLICY "Authorized users can view customers" ON public.customers FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admin/accountant/sales can insert customers" ON public.customers;
CREATE POLICY "Admin/accountant/sales can insert customers" ON public.customers FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admin/accountant/sales can update customers" ON public.customers;
CREATE POLICY "Admin/accountant/sales can update customers" ON public.customers FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admin can delete customers" ON public.customers;
CREATE POLICY "Admin can delete customers" ON public.customers FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === suppliers ===
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view suppliers" ON public.suppliers;
CREATE POLICY "Authorized users can view suppliers" ON public.suppliers FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admin/accountant can insert suppliers" ON public.suppliers;
CREATE POLICY "Admin/accountant can insert suppliers" ON public.suppliers FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can update suppliers" ON public.suppliers;
CREATE POLICY "Admin/accountant can update suppliers" ON public.suppliers FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin can delete suppliers" ON public.suppliers;
CREATE POLICY "Admin can delete suppliers" ON public.suppliers FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === product_categories ===
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view categories" ON public.product_categories;
CREATE POLICY "Authorized users can view categories" ON public.product_categories FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admin/accountant can manage categories" ON public.product_categories;
CREATE POLICY "Admin/accountant can manage categories" ON public.product_categories FOR ALL USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')) WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- === product_units ===
ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view units" ON public.product_units;
CREATE POLICY "Authorized users can view units" ON public.product_units FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admin/accountant can manage units" ON public.product_units;
CREATE POLICY "Admin/accountant can manage units" ON public.product_units FOR ALL USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')) WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- === product_brands ===
ALTER TABLE public.product_brands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view brands" ON public.product_brands;
CREATE POLICY "Authorized users can view brands" ON public.product_brands FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admin/accountant can manage brands" ON public.product_brands;
CREATE POLICY "Admin/accountant can manage brands" ON public.product_brands FOR ALL USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')) WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- === products ===
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view products" ON public.products;
CREATE POLICY "Authorized users can view products" ON public.products FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admin and accountant can insert products" ON public.products;
CREATE POLICY "Admin and accountant can insert products" ON public.products FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin and accountant can update products" ON public.products;
CREATE POLICY "Admin and accountant can update products" ON public.products FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin can delete products" ON public.products;
CREATE POLICY "Admin can delete products" ON public.products FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === product_images ===
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view product images" ON public.product_images;
CREATE POLICY "Authorized users can view product images" ON public.product_images FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admin/accountant can manage product images" ON public.product_images;
CREATE POLICY "Admin/accountant can manage product images" ON public.product_images FOR ALL USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant')) WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- === journal_entries ===
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view journal entries" ON public.journal_entries;
CREATE POLICY "Authorized users can view journal entries" ON public.journal_entries FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Authorized users can insert journal entries" ON public.journal_entries;
CREATE POLICY "Authorized users can insert journal entries" ON public.journal_entries FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Authorized users can update journal entries" ON public.journal_entries;
CREATE POLICY "Authorized users can update journal entries" ON public.journal_entries FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admins can delete journal entries" ON public.journal_entries;
CREATE POLICY "Admins can delete journal entries" ON public.journal_entries FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === journal_entry_lines ===
ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view journal entry lines" ON public.journal_entry_lines;
CREATE POLICY "Authorized users can view journal entry lines" ON public.journal_entry_lines FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Authorized users can insert journal entry lines" ON public.journal_entry_lines;
CREATE POLICY "Authorized users can insert journal entry lines" ON public.journal_entry_lines FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Authorized users can update journal entry lines" ON public.journal_entry_lines;
CREATE POLICY "Authorized users can update journal entry lines" ON public.journal_entry_lines FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Authorized users can delete journal entry lines" ON public.journal_entry_lines;
CREATE POLICY "Authorized users can delete journal entry lines" ON public.journal_entry_lines FOR DELETE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- === sales_invoices ===
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view sales invoices" ON public.sales_invoices;
CREATE POLICY "Authorized users can view sales invoices" ON public.sales_invoices FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can insert sales invoices" ON public.sales_invoices;
CREATE POLICY "Authorized can insert sales invoices" ON public.sales_invoices FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can update sales invoices" ON public.sales_invoices;
CREATE POLICY "Authorized can update sales invoices" ON public.sales_invoices FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admin can delete sales invoices" ON public.sales_invoices;
CREATE POLICY "Admin can delete sales invoices" ON public.sales_invoices FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === sales_invoice_items ===
ALTER TABLE public.sales_invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view sales invoice items" ON public.sales_invoice_items;
CREATE POLICY "Authorized users can view sales invoice items" ON public.sales_invoice_items FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can insert sales invoice items" ON public.sales_invoice_items;
CREATE POLICY "Authorized can insert sales invoice items" ON public.sales_invoice_items FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can update sales invoice items" ON public.sales_invoice_items;
CREATE POLICY "Authorized can update sales invoice items" ON public.sales_invoice_items FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can delete sales invoice items" ON public.sales_invoice_items;
CREATE POLICY "Authorized can delete sales invoice items" ON public.sales_invoice_items FOR DELETE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- === purchase_invoices ===
ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view purchase invoices" ON public.purchase_invoices;
CREATE POLICY "Authorized users can view purchase invoices" ON public.purchase_invoices FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can insert purchase invoices" ON public.purchase_invoices;
CREATE POLICY "Admin/accountant can insert purchase invoices" ON public.purchase_invoices FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can update purchase invoices" ON public.purchase_invoices;
CREATE POLICY "Admin/accountant can update purchase invoices" ON public.purchase_invoices FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin can delete purchase invoices" ON public.purchase_invoices;
CREATE POLICY "Admin can delete purchase invoices" ON public.purchase_invoices FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === purchase_invoice_items ===
ALTER TABLE public.purchase_invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view purchase invoice items" ON public.purchase_invoice_items;
CREATE POLICY "Authorized users can view purchase invoice items" ON public.purchase_invoice_items FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can insert purchase invoice items" ON public.purchase_invoice_items;
CREATE POLICY "Admin/accountant can insert purchase invoice items" ON public.purchase_invoice_items FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can update purchase invoice items" ON public.purchase_invoice_items;
CREATE POLICY "Admin/accountant can update purchase invoice items" ON public.purchase_invoice_items FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can delete purchase invoice items" ON public.purchase_invoice_items;
CREATE POLICY "Admin/accountant can delete purchase invoice items" ON public.purchase_invoice_items FOR DELETE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- === sales_returns ===
ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view sales returns" ON public.sales_returns;
CREATE POLICY "Authorized users can view sales returns" ON public.sales_returns FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can insert sales returns" ON public.sales_returns;
CREATE POLICY "Authorized can insert sales returns" ON public.sales_returns FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can update sales returns" ON public.sales_returns;
CREATE POLICY "Authorized can update sales returns" ON public.sales_returns FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admin can delete sales returns" ON public.sales_returns;
CREATE POLICY "Admin can delete sales returns" ON public.sales_returns FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === sales_return_items ===
ALTER TABLE public.sales_return_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view sales return items" ON public.sales_return_items;
CREATE POLICY "Authorized users can view sales return items" ON public.sales_return_items FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can insert sales return items" ON public.sales_return_items;
CREATE POLICY "Authorized can insert sales return items" ON public.sales_return_items FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can update sales return items" ON public.sales_return_items;
CREATE POLICY "Authorized can update sales return items" ON public.sales_return_items FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can delete sales return items" ON public.sales_return_items;
CREATE POLICY "Authorized can delete sales return items" ON public.sales_return_items FOR DELETE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- === purchase_returns ===
ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view purchase returns" ON public.purchase_returns;
CREATE POLICY "Authorized users can view purchase returns" ON public.purchase_returns FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can insert purchase returns" ON public.purchase_returns;
CREATE POLICY "Admin/accountant can insert purchase returns" ON public.purchase_returns FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can update purchase returns" ON public.purchase_returns;
CREATE POLICY "Admin/accountant can update purchase returns" ON public.purchase_returns FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin can delete purchase returns" ON public.purchase_returns;
CREATE POLICY "Admin can delete purchase returns" ON public.purchase_returns FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === purchase_return_items ===
ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view purchase return items" ON public.purchase_return_items;
CREATE POLICY "Authorized users can view purchase return items" ON public.purchase_return_items FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can insert purchase return items" ON public.purchase_return_items;
CREATE POLICY "Admin/accountant can insert purchase return items" ON public.purchase_return_items FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can update purchase return items" ON public.purchase_return_items;
CREATE POLICY "Admin/accountant can update purchase return items" ON public.purchase_return_items FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can delete purchase return items" ON public.purchase_return_items;
CREATE POLICY "Admin/accountant can delete purchase return items" ON public.purchase_return_items FOR DELETE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- === customer_payments ===
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view customer payments" ON public.customer_payments;
CREATE POLICY "Authorized users can view customer payments" ON public.customer_payments FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can insert customer payments" ON public.customer_payments;
CREATE POLICY "Authorized can insert customer payments" ON public.customer_payments FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can update customer payments" ON public.customer_payments;
CREATE POLICY "Authorized can update customer payments" ON public.customer_payments FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admin can delete customer payments" ON public.customer_payments;
CREATE POLICY "Admin can delete customer payments" ON public.customer_payments FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === customer_payment_allocations ===
ALTER TABLE public.customer_payment_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view customer payment allocations" ON public.customer_payment_allocations;
CREATE POLICY "Authorized users can view customer payment allocations" ON public.customer_payment_allocations FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can insert customer payment allocations" ON public.customer_payment_allocations;
CREATE POLICY "Authorized can insert customer payment allocations" ON public.customer_payment_allocations FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Authorized can delete customer payment allocations" ON public.customer_payment_allocations;
CREATE POLICY "Authorized can delete customer payment allocations" ON public.customer_payment_allocations FOR DELETE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- === supplier_payments ===
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view supplier payments" ON public.supplier_payments;
CREATE POLICY "Authorized users can view supplier payments" ON public.supplier_payments FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can insert supplier payments" ON public.supplier_payments;
CREATE POLICY "Admin/accountant can insert supplier payments" ON public.supplier_payments FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can update supplier payments" ON public.supplier_payments;
CREATE POLICY "Admin/accountant can update supplier payments" ON public.supplier_payments FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin can delete supplier payments" ON public.supplier_payments;
CREATE POLICY "Admin can delete supplier payments" ON public.supplier_payments FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- === supplier_payment_allocations ===
ALTER TABLE public.supplier_payment_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view supplier payment allocations" ON public.supplier_payment_allocations;
CREATE POLICY "Authorized users can view supplier payment allocations" ON public.supplier_payment_allocations FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Authorized can insert supplier payment allocations" ON public.supplier_payment_allocations;
CREATE POLICY "Authorized can insert supplier payment allocations" ON public.supplier_payment_allocations FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Authorized can delete supplier payment allocations" ON public.supplier_payment_allocations;
CREATE POLICY "Authorized can delete supplier payment allocations" ON public.supplier_payment_allocations FOR DELETE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- === inventory_movements ===
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authorized users can view inventory movements" ON public.inventory_movements;
CREATE POLICY "Authorized users can view inventory movements" ON public.inventory_movements FOR SELECT USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant') OR has_role(auth.uid(), 'sales'));
DROP POLICY IF EXISTS "Admin/accountant can insert inventory movements" ON public.inventory_movements;
CREATE POLICY "Admin/accountant can insert inventory movements" ON public.inventory_movements FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin/accountant can update inventory movements" ON public.inventory_movements;
CREATE POLICY "Admin/accountant can update inventory movements" ON public.inventory_movements FOR UPDATE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));
DROP POLICY IF EXISTS "Admin can delete inventory movements" ON public.inventory_movements;
CREATE POLICY "Admin can delete inventory movements" ON public.inventory_movements FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- ==========================================
-- 7. STORAGE BUCKET
-- ==========================================
INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read product images" ON storage.objects;
CREATE POLICY "Public read product images" ON storage.objects FOR SELECT USING (bucket_id = 'product-images');
DROP POLICY IF EXISTS "Auth users upload product images" ON storage.objects;
CREATE POLICY "Auth users upload product images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'product-images' AND auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Auth users update product images" ON storage.objects;
CREATE POLICY "Auth users update product images" ON storage.objects FOR UPDATE USING (bucket_id = 'product-images' AND auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Auth users delete product images" ON storage.objects;
CREATE POLICY "Auth users delete product images" ON storage.objects FOR DELETE USING (bucket_id = 'product-images' AND auth.role() = 'authenticated');

-- ==========================================
-- تم بنجاح! 🎉
-- ==========================================
