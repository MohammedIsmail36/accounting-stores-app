-- Telegram settings (single row)
CREATE TABLE IF NOT EXISTS public.telegram_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_token text,
  bot_token_hint text,
  channel_id text,
  is_enabled boolean NOT NULL DEFAULT false,
  message_template text NOT NULL DEFAULT E'<b>{name}</b>\n\nالكود: {code}\nالماركة: {brand}\nالموديل: {model}\nالسعر: {price}\nالمتاح: {stock}\n\n{description}',
  show_price boolean NOT NULL DEFAULT true,
  show_stock boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.fn_telegram_settings_hint()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.bot_token_hint := CASE
    WHEN NEW.bot_token IS NULL OR length(NEW.bot_token) < 4 THEN NULL
    ELSE right(NEW.bot_token, 4)
  END;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_telegram_settings_hint() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_telegram_settings_hint ON public.telegram_settings;
CREATE TRIGGER trg_telegram_settings_hint
BEFORE INSERT OR UPDATE ON public.telegram_settings
FOR EACH ROW EXECUTE FUNCTION public.fn_telegram_settings_hint();

-- Column-level grants: bot_token is never readable by app clients
GRANT SELECT (id, bot_token_hint, channel_id, is_enabled, message_template, show_price, show_stock, created_at, updated_at)
  ON public.telegram_settings TO authenticated;
GRANT INSERT (bot_token, channel_id, is_enabled, message_template, show_price, show_stock) ON public.telegram_settings TO authenticated;
GRANT UPDATE (bot_token, channel_id, is_enabled, message_template, show_price, show_stock) ON public.telegram_settings TO authenticated;
GRANT ALL ON public.telegram_settings TO service_role;

ALTER TABLE public.telegram_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "telegram_settings_read" ON public.telegram_settings;
CREATE POLICY "telegram_settings_read" ON public.telegram_settings
FOR SELECT TO public
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'accountant'::app_role)
  OR has_role(auth.uid(), 'sales'::app_role)
);

DROP POLICY IF EXISTS "telegram_settings_admin_insert" ON public.telegram_settings;
CREATE POLICY "telegram_settings_admin_insert" ON public.telegram_settings
FOR INSERT TO public
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "telegram_settings_admin_update" ON public.telegram_settings;
CREATE POLICY "telegram_settings_admin_update" ON public.telegram_settings
FOR UPDATE TO public
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Publish log
CREATE TABLE IF NOT EXISTS public.telegram_post_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  channel_id text,
  message_id bigint,
  images_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success',
  error text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_post_log_product ON public.telegram_post_log (product_id, created_at DESC);

GRANT SELECT ON public.telegram_post_log TO authenticated;
GRANT ALL ON public.telegram_post_log TO service_role;

ALTER TABLE public.telegram_post_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "telegram_post_log_read" ON public.telegram_post_log;
CREATE POLICY "telegram_post_log_read" ON public.telegram_post_log
FOR SELECT TO public
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'accountant'::app_role)
  OR has_role(auth.uid(), 'sales'::app_role)
);