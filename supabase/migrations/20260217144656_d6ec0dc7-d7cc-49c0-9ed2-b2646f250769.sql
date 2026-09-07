
-- Create company_settings table (singleton pattern - one row only)
CREATE TABLE public.company_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Company info
  company_name text NOT NULL DEFAULT '',
  company_name_en text DEFAULT '',
  logo_url text DEFAULT '',
  address text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  website text DEFAULT '',
  tax_number text DEFAULT '',
  commercial_register text DEFAULT '',
  -- Financial settings
  default_currency text NOT NULL DEFAULT 'EGP',
  fiscal_year_start text NOT NULL DEFAULT '01-01',
  tax_rate numeric NOT NULL DEFAULT 0,
  -- Invoice settings
  sales_invoice_prefix text NOT NULL DEFAULT 'INV-',
  purchase_invoice_prefix text NOT NULL DEFAULT 'PUR-',
  payment_terms_days integer NOT NULL DEFAULT 30,
  show_tax_on_invoice boolean NOT NULL DEFAULT true,
  show_discount_on_invoice boolean NOT NULL DEFAULT true,
  invoice_notes text DEFAULT '',
  invoice_footer text DEFAULT '',
  -- Metadata
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view settings
CREATE POLICY "Authenticated users can view settings"
ON public.company_settings
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'accountant'::app_role)
  OR has_role(auth.uid(), 'sales'::app_role)
);

-- Only admins can insert/update/delete
CREATE POLICY "Admins can insert settings"
ON public.company_settings
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update settings"
ON public.company_settings
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete settings"
ON public.company_settings
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add updated_at trigger
CREATE TRIGGER update_company_settings_updated_at
BEFORE UPDATE ON public.company_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default row
INSERT INTO public.company_settings (company_name, default_currency)
VALUES ('شركتي', 'EGP');
