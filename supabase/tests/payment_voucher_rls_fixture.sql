-- Synthetic role/RLS fixture. Run only in a fresh disposable PostgreSQL database.
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TYPE public.app_role AS ENUM ('admin', 'accountant', 'sales');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE TABLE public.customer_payments (
  id uuid PRIMARY KEY, status text NOT NULL, amount numeric NOT NULL, journal_entry_id uuid
);
CREATE TABLE public.supplier_payments (
  id uuid PRIMARY KEY, status text NOT NULL, amount numeric NOT NULL, journal_entry_id uuid
);
CREATE TABLE public.customer_payment_allocations (
  id uuid PRIMARY KEY, payment_id uuid NOT NULL, invoice_id uuid NOT NULL, allocated_amount numeric NOT NULL
);
CREATE TABLE public.supplier_payment_allocations (
  id uuid PRIMARY KEY, payment_id uuid NOT NULL, invoice_id uuid NOT NULL, allocated_amount numeric NOT NULL
);
CREATE TABLE public.sales_return_payment_allocations (
  id uuid PRIMARY KEY, payment_id uuid NOT NULL, return_id uuid NOT NULL, allocated_amount numeric NOT NULL
);
CREATE TABLE public.purchase_return_payment_allocations (
  id uuid PRIMARY KEY, payment_id uuid NOT NULL, return_id uuid NOT NULL, allocated_amount numeric NOT NULL
);

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_return_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_return_payment_allocations ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;

INSERT INTO public.user_roles VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin'),
  ('00000000-0000-4000-8000-000000000002', 'accountant'),
  ('00000000-0000-4000-8000-000000000003', 'sales');
INSERT INTO public.customer_payments VALUES
  ('00000000-0000-4000-8000-000000000101', 'posted', 100, '00000000-0000-4000-8000-000000000301');
INSERT INTO public.supplier_payments VALUES
  ('00000000-0000-4000-8000-000000000102', 'posted', 75, '00000000-0000-4000-8000-000000000302');
INSERT INTO public.customer_payment_allocations VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000401', 100);
INSERT INTO public.supplier_payment_allocations VALUES
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000402', 75);
INSERT INTO public.sales_return_payment_allocations VALUES
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000403', 10);
INSERT INTO public.purchase_return_payment_allocations VALUES
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000404', 10);
