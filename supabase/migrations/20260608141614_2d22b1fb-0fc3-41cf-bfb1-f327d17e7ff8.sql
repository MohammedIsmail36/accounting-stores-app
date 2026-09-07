
-- 1) Add settings columns
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS loyalty_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS loyalty_egp_per_point numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS loyalty_points_per_redeem integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS loyalty_redeem_value numeric NOT NULL DEFAULT 5;

-- 2) Add customer column
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS loyalty_points integer NOT NULL DEFAULT 0;

-- 3) Add sales invoice columns
ALTER TABLE public.sales_invoices
  ADD COLUMN IF NOT EXISTS loyalty_points_redeemed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_discount numeric NOT NULL DEFAULT 0;

-- 4) Loyalty transactions ledger
CREATE TABLE IF NOT EXISTS public.loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  points integer NOT NULL,
  type text NOT NULL CHECK (type IN ('earn','redeem','reversal','redeem_reversal','manual_adjust')),
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_customer ON public.loyalty_transactions(customer_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_ref ON public.loyalty_transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_date ON public.loyalty_transactions(transaction_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.loyalty_transactions TO authenticated;
GRANT ALL ON public.loyalty_transactions TO service_role;

ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loyalty_tx_select" ON public.loyalty_transactions
  FOR SELECT TO public USING (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'accountant') OR
    public.has_role(auth.uid(),'sales')
  );
CREATE POLICY "loyalty_tx_insert" ON public.loyalty_transactions
  FOR INSERT TO public WITH CHECK (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'accountant') OR
    public.has_role(auth.uid(),'sales')
  );
CREATE POLICY "loyalty_tx_update" ON public.loyalty_transactions
  FOR UPDATE TO public USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "loyalty_tx_delete" ON public.loyalty_transactions
  FOR DELETE TO public USING (public.has_role(auth.uid(),'admin'));

-- 5) Trigger function for sales invoice posting
CREATE OR REPLACE FUNCTION public.fn_loyalty_on_invoice_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings RECORD;
  v_points_earned integer := 0;
  v_earning_base numeric := 0;
BEGIN
  IF NEW.status <> 'posted' OR OLD.status = 'posted' THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  SELECT loyalty_enabled, loyalty_egp_per_point INTO v_settings FROM company_settings LIMIT 1;
  IF v_settings.loyalty_enabled IS NOT TRUE THEN RETURN NEW; END IF;
  IF COALESCE(v_settings.loyalty_egp_per_point, 0) <= 0 THEN RETURN NEW; END IF;

  -- Earning base = paid net (net_total + loyalty_discount, where net_total excludes tax)
  v_earning_base := GREATEST(COALESCE(NEW.total,0) - COALESCE(NEW.tax,0) + COALESCE(NEW.loyalty_discount,0), 0);
  v_points_earned := FLOOR(v_earning_base / v_settings.loyalty_egp_per_point)::int;

  -- Redemption (already deducted client-side from totals; record the ledger entry)
  IF COALESCE(NEW.loyalty_points_redeemed,0) > 0 THEN
    INSERT INTO loyalty_transactions (customer_id, transaction_date, points, type, reference_type, reference_id, notes)
    VALUES (NEW.customer_id, NEW.invoice_date, -NEW.loyalty_points_redeemed, 'redeem', 'sales_invoice', NEW.id,
            format('استبدال على فاتورة #%s', COALESCE(NEW.posted_number::text, NEW.invoice_number::text)));
  END IF;

  -- Earn
  IF v_points_earned > 0 THEN
    INSERT INTO loyalty_transactions (customer_id, transaction_date, points, type, reference_type, reference_id, notes)
    VALUES (NEW.customer_id, NEW.invoice_date, v_points_earned, 'earn', 'sales_invoice', NEW.id,
            format('اكتساب من فاتورة #%s', COALESCE(NEW.posted_number::text, NEW.invoice_number::text)));
  END IF;

  -- Update balance
  UPDATE customers
    SET loyalty_points = GREATEST(loyalty_points + v_points_earned - COALESCE(NEW.loyalty_points_redeemed,0), 0)
    WHERE id = NEW.customer_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_on_invoice_post ON public.sales_invoices;
CREATE TRIGGER trg_loyalty_on_invoice_post
  AFTER UPDATE OF status ON public.sales_invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_loyalty_on_invoice_post();

-- 6) Trigger function for sales return posting
CREATE OR REPLACE FUNCTION public.fn_loyalty_on_return_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings RECORD;
  v_invoice RECORD;
  v_returned_net numeric := 0;
  v_points_reversed integer := 0;
  v_points_redeem_refunded integer := 0;
  v_invoice_net numeric := 0;
BEGIN
  IF NEW.status <> 'posted' OR OLD.status = 'posted' THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  SELECT loyalty_enabled, loyalty_egp_per_point INTO v_settings FROM company_settings LIMIT 1;
  IF v_settings.loyalty_enabled IS NOT TRUE THEN RETURN NEW; END IF;
  IF COALESCE(v_settings.loyalty_egp_per_point,0) <= 0 THEN RETURN NEW; END IF;

  v_returned_net := GREATEST(COALESCE(NEW.total,0) - COALESCE(NEW.tax,0), 0);
  v_points_reversed := FLOOR(v_returned_net / v_settings.loyalty_egp_per_point)::int;

  -- Refund redeemed points proportionally to the source invoice
  IF NEW.sales_invoice_id IS NOT NULL THEN
    SELECT loyalty_points_redeemed, total, tax, loyalty_discount INTO v_invoice
      FROM sales_invoices WHERE id = NEW.sales_invoice_id;
    IF FOUND AND COALESCE(v_invoice.loyalty_points_redeemed,0) > 0 THEN
      v_invoice_net := GREATEST(COALESCE(v_invoice.total,0) - COALESCE(v_invoice.tax,0) + COALESCE(v_invoice.loyalty_discount,0), 0);
      IF v_invoice_net > 0 THEN
        v_points_redeem_refunded := ROUND(
          v_invoice.loyalty_points_redeemed::numeric * LEAST(v_returned_net + COALESCE(v_invoice.loyalty_discount,0)*0, v_invoice_net) / v_invoice_net
        )::int;
        -- Simpler proportional based on returned_net / invoice_net (excluding tax)
        v_points_redeem_refunded := ROUND(
          v_invoice.loyalty_points_redeemed::numeric * v_returned_net / v_invoice_net
        )::int;
      END IF;
    END IF;
  END IF;

  IF v_points_reversed > 0 THEN
    INSERT INTO loyalty_transactions (customer_id, transaction_date, points, type, reference_type, reference_id, notes)
    VALUES (NEW.customer_id, NEW.return_date, -v_points_reversed, 'reversal', 'sales_return', NEW.id,
            format('عكس نقاط مرتجع #%s', COALESCE(NEW.posted_number::text, NEW.return_number::text)));
  END IF;

  IF v_points_redeem_refunded > 0 THEN
    INSERT INTO loyalty_transactions (customer_id, transaction_date, points, type, reference_type, reference_id, notes)
    VALUES (NEW.customer_id, NEW.return_date, v_points_redeem_refunded, 'redeem_reversal', 'sales_return', NEW.id,
            format('إعادة نقاط مستبدلة من مرتجع #%s', COALESCE(NEW.posted_number::text, NEW.return_number::text)));
  END IF;

  UPDATE customers
    SET loyalty_points = GREATEST(loyalty_points - v_points_reversed + v_points_redeem_refunded, 0)
    WHERE id = NEW.customer_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_on_return_post ON public.sales_returns;
CREATE TRIGGER trg_loyalty_on_return_post
  AFTER UPDATE OF status ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.fn_loyalty_on_return_post();
