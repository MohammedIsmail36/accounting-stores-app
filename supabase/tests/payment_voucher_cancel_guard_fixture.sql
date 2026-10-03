-- Synthetic schema for the stage-1 cancellation failure contract.
-- Execute only in a new, disposable PostgreSQL database with no network access.
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE ROLE anon;
CREATE TABLE public.journal_entries (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  entry_type text NOT NULL DEFAULT 'regular',
  description text NOT NULL,
  entry_date date,
  total_debit numeric,
  total_credit numeric,
  updated_at timestamptz
);
CREATE TABLE public.journal_entry_lines (
  journal_entry_id uuid,
  account_id uuid,
  debit numeric,
  credit numeric,
  description text
);
CREATE TABLE public.sales_invoices (id uuid PRIMARY KEY, journal_entry_id uuid, paid_amount numeric);
CREATE TABLE public.purchase_invoices (id uuid PRIMARY KEY, journal_entry_id uuid, paid_amount numeric);
CREATE TABLE public.customer_payments (id uuid PRIMARY KEY, journal_entry_id uuid, status text);
CREATE TABLE public.supplier_payments (id uuid PRIMARY KEY, journal_entry_id uuid, status text);
CREATE TABLE public.sales_returns (journal_entry_id uuid);
CREATE TABLE public.purchase_returns (journal_entry_id uuid);
CREATE TABLE public.expenses (journal_entry_id uuid);
CREATE TABLE public.inventory_adjustments (journal_entry_id uuid);
CREATE TABLE public.customer_payment_allocations (payment_id uuid, invoice_id uuid, allocated_amount numeric);
CREATE TABLE public.supplier_payment_allocations (payment_id uuid, invoice_id uuid, allocated_amount numeric);
CREATE TABLE public.customers (id uuid PRIMARY KEY, balance numeric);
CREATE TABLE public.suppliers (id uuid PRIMARY KEY, balance numeric);

INSERT INTO public.journal_entries (id, status, entry_type, description) VALUES
  ('00000000-0000-4000-8000-000000000101', 'posted', 'regular', 'synthetic customer receipt'),
  ('00000000-0000-4000-8000-000000000102', 'posted', 'regular', 'synthetic supplier payment');
INSERT INTO public.customer_payments (id, journal_entry_id, status) VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 'posted');
INSERT INTO public.supplier_payments (id, journal_entry_id, status) VALUES
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000102', 'posted');
INSERT INTO public.sales_invoices (id, paid_amount) VALUES
  ('00000000-0000-4000-8000-000000000301', 100);
INSERT INTO public.purchase_invoices (id, paid_amount) VALUES
  ('00000000-0000-4000-8000-000000000302', 75);
INSERT INTO public.customer_payment_allocations VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301', 100);
INSERT INTO public.supplier_payment_allocations VALUES
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000302', 75);
INSERT INTO public.customers VALUES ('00000000-0000-4000-8000-000000000401', 0);
INSERT INTO public.suppliers VALUES ('00000000-0000-4000-8000-000000000402', 0);
