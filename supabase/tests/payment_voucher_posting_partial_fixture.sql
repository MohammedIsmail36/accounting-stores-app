-- Synthetic PostgreSQL-only fixture. Never apply to a hosted database.
-- The failure constraints represent a rejected voucher/allocation request;
-- they are NOT claimed to be constraints in the application schema.
CREATE TABLE journal_entries (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status = 'posted'),
  debit numeric(15,2) NOT NULL,
  credit numeric(15,2) NOT NULL,
  CHECK (debit > 0 AND debit = credit)
);
CREATE TABLE customers (id uuid PRIMARY KEY, balance numeric(15,2) NOT NULL);
CREATE TABLE suppliers (id uuid PRIMARY KEY, balance numeric(15,2) NOT NULL);
CREATE TABLE sales_invoices (id uuid PRIMARY KEY, paid_amount numeric(15,2) NOT NULL);
CREATE TABLE purchase_invoices (id uuid PRIMARY KEY, paid_amount numeric(15,2) NOT NULL);
CREATE TABLE customer_payments (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  journal_entry_id uuid REFERENCES journal_entries(id),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL,
  reference text,
  CONSTRAINT synthetic_customer_voucher_failure CHECK (reference IS DISTINCT FROM 'INJECT_FAIL')
);
CREATE TABLE supplier_payments (
  id uuid PRIMARY KEY,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  journal_entry_id uuid REFERENCES journal_entries(id),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL,
  reference text,
  CONSTRAINT synthetic_supplier_voucher_failure CHECK (reference IS DISTINCT FROM 'INJECT_FAIL')
);
CREATE TABLE customer_payment_allocations (
  payment_id uuid NOT NULL REFERENCES customer_payments(id),
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id),
  allocated_amount numeric(15,2) NOT NULL,
  CONSTRAINT synthetic_customer_allocation_failure CHECK (allocated_amount > 0)
);
CREATE TABLE supplier_payment_allocations (
  payment_id uuid NOT NULL REFERENCES supplier_payments(id),
  invoice_id uuid NOT NULL REFERENCES purchase_invoices(id),
  allocated_amount numeric(15,2) NOT NULL,
  CONSTRAINT synthetic_supplier_allocation_failure CHECK (allocated_amount > 0)
);
INSERT INTO customers VALUES ('00000000-0000-4000-8000-000000000001', 0);
INSERT INTO suppliers VALUES ('00000000-0000-4000-8000-000000000002', 0);
INSERT INTO sales_invoices VALUES ('00000000-0000-4000-8000-000000000003', 0);
INSERT INTO purchase_invoices VALUES ('00000000-0000-4000-8000-000000000004', 0);
