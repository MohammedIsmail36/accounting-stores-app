-- إنشاء حساب ضريبة المدخلات (1105) إذا لم يكن موجوداً
INSERT INTO public.accounts (code, name, account_type, parent_id, is_system, is_active)
VALUES (
  '1105',
  'ضريبة القيمة المضافة للمدخلات',
  'asset',
  COALESCE(
    (SELECT id FROM public.accounts WHERE code = '11' LIMIT 1),
    (SELECT id FROM public.accounts WHERE code = '1' LIMIT 1)
  ),
  true,
  true
)
ON CONFLICT (code) DO NOTHING;

-- إنشاء حساب مستحقات ضريبة المبيعات (2102) إذا لم يكن موجوداً
INSERT INTO public.accounts (code, name, account_type, parent_id, is_system, is_active)
VALUES (
  '2102',
  'مستحقات ضريبة المبيعات',
  'liability',
  COALESCE(
    (SELECT id FROM public.accounts WHERE code = '21' LIMIT 1),
    (SELECT id FROM public.accounts WHERE code = '2' LIMIT 1)
  ),
  true,
  true
)
ON CONFLICT (code) DO NOTHING;