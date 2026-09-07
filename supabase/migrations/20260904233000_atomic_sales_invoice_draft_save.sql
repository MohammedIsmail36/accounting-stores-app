-- Save a sales-invoice draft header and all of its lines in one PostgreSQL
-- transaction. This removes the browser-side update/delete/insert sequence
-- that could leave a draft without lines when its final request failed.

CREATE OR REPLACE FUNCTION public.save_sales_invoice_draft(
  p_invoice_id uuid,
  p_invoice jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.sales_invoices%ROWTYPE;
  v_invoice_id uuid;
  v_invoice_number integer;
  v_customer_id uuid;
  v_invoice_date date;
  v_subtotal numeric;
  v_discount numeric;
  v_tax numeric;
  v_total numeric;
  v_loyalty_points integer;
  v_loyalty_discount numeric;
  v_notes text;
  v_reference text;
  v_item_count integer;
  v_item record;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_line_total numeric;
  v_net_total numeric;
  v_calculated_line_total numeric;
  v_calculated_subtotal numeric := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'accountant'::public.app_role)
       OR public.has_role(auth.uid(), 'sales'::public.app_role)
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'غير مصرح بحفظ فاتورة البيع');
  END IF;

  IF p_invoice IS NULL OR jsonb_typeof(p_invoice) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'بيانات الفاتورة غير صالحة');
  END IF;
  IF p_items IS NULL THEN
    p_items := '[]'::jsonb;
  END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'بنود الفاتورة غير صالحة');
  END IF;

  v_customer_id := NULLIF(p_invoice->>'customer_id', '')::uuid;
  v_invoice_date := NULLIF(p_invoice->>'invoice_date', '')::date;
  v_subtotal := ROUND(COALESCE((p_invoice->>'subtotal')::numeric, 0), 2);
  v_discount := ROUND(COALESCE((p_invoice->>'discount')::numeric, 0), 2);
  v_tax := ROUND(COALESCE((p_invoice->>'tax')::numeric, 0), 2);
  v_total := ROUND(COALESCE((p_invoice->>'total')::numeric, 0), 2);
  v_loyalty_points := COALESCE((p_invoice->>'loyalty_points_redeemed')::integer, 0);
  v_loyalty_discount := ROUND(COALESCE((p_invoice->>'loyalty_discount')::numeric, 0), 2);
  v_notes := NULLIF(BTRIM(COALESCE(p_invoice->>'notes', '')), '');
  v_reference := NULLIF(BTRIM(COALESCE(p_invoice->>'reference', '')), '');
  v_item_count := jsonb_array_length(p_items);

  IF v_invoice_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'تاريخ الفاتورة مطلوب');
  END IF;
  IF v_subtotal < 0 OR v_discount < 0 OR v_tax < 0 OR v_total < 0
     OR v_loyalty_points < 0 OR v_loyalty_discount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'قيم الفاتورة لا يمكن أن تكون سالبة');
  END IF;
  IF v_discount > v_subtotal THEN
    RETURN jsonb_build_object('success', false, 'error', 'خصم الفاتورة لا يمكن أن يتجاوز إجمالي البنود');
  END IF;
  IF ABS(v_total - ROUND(v_subtotal - v_discount + v_tax - v_loyalty_discount, 2)) > 0.01 THEN
    RETURN jsonb_build_object('success', false, 'error', 'إجمالي الفاتورة لا يطابق المجموع الفرعي والخصم والضريبة وخصم الولاء');
  END IF;

  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers WHERE id = v_customer_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'العميل المحدد غير موجود');
  END IF;
  IF p_invoice_id IS NULL AND v_customer_id IS NULL AND v_item_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'لا يمكن حفظ فاتورة جديدة فارغة');
  END IF;

  -- Validate every line before changing an existing draft. Values are still
  -- inserted later inside this same transaction, so any unexpected constraint
  -- or trigger failure also rolls the header and deleted lines back together.
  FOR v_item IN
    SELECT value AS item, ordinality
    FROM jsonb_array_elements(p_items) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_item.item) <> 'object' THEN
      RETURN jsonb_build_object('success', false, 'error', 'أحد بنود الفاتورة غير صالح');
    END IF;

    v_product_id := NULLIF(v_item.item->>'product_id', '')::uuid;
    v_quantity := COALESCE((v_item.item->>'quantity')::numeric, 0);
    v_unit_price := COALESCE((v_item.item->>'unit_price')::numeric, 0);
    v_line_discount := COALESCE((v_item.item->>'discount')::numeric, 0);
    v_line_total := ROUND(COALESCE((v_item.item->>'total')::numeric, 0), 2);
    v_net_total := ROUND(COALESCE((v_item.item->>'net_total')::numeric, v_line_total), 2);
    v_calculated_line_total := ROUND(v_quantity * v_unit_price - v_line_discount, 2);

    IF v_product_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.products WHERE id = v_product_id
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', format('المنتج في السطر %s غير موجود', v_item.ordinality)
      );
    END IF;
    IF v_quantity <= 0 OR v_unit_price < 0 OR v_line_discount < 0
       OR v_line_total < 0 OR v_net_total < 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', format('القيم في السطر %s غير صالحة', v_item.ordinality)
      );
    END IF;
    IF ABS(v_line_total - v_calculated_line_total) > 0.01 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', format('إجمالي السطر %s لا يطابق الكمية والسعر والخصم', v_item.ordinality)
      );
    END IF;
    IF v_net_total > v_line_total THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', format('صافي السطر %s لا يمكن أن يتجاوز إجماليه', v_item.ordinality)
      );
    END IF;

    v_calculated_subtotal := v_calculated_subtotal + v_line_total;
  END LOOP;

  IF ABS(v_subtotal - ROUND(v_calculated_subtotal, 2)) > 0.01 THEN
    RETURN jsonb_build_object('success', false, 'error', 'إجمالي بنود الفاتورة لا يطابق المجموع الفرعي');
  END IF;

  IF p_invoice_id IS NULL THEN
    INSERT INTO public.sales_invoices (
      customer_id,
      invoice_date,
      subtotal,
      discount,
      tax,
      total,
      loyalty_points_redeemed,
      loyalty_discount,
      notes,
      reference,
      status,
      created_by
    ) VALUES (
      v_customer_id,
      v_invoice_date,
      v_subtotal,
      v_discount,
      v_tax,
      v_total,
      v_loyalty_points,
      v_loyalty_discount,
      v_notes,
      v_reference,
      'draft',
      auth.uid()
    )
    RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;
  ELSE
    SELECT *
    INTO v_existing
    FROM public.sales_invoices
    WHERE id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'فاتورة البيع غير موجودة');
    END IF;
    IF v_existing.status <> 'draft' THEN
      RETURN jsonb_build_object('success', false, 'error', 'يمكن تعديل فواتير المسودة فقط');
    END IF;

    v_invoice_id := v_existing.id;
    v_invoice_number := v_existing.invoice_number;

    UPDATE public.sales_invoices
    SET customer_id = v_customer_id,
        invoice_date = v_invoice_date,
        subtotal = v_subtotal,
        discount = v_discount,
        tax = v_tax,
        total = v_total,
        loyalty_points_redeemed = v_loyalty_points,
        loyalty_discount = v_loyalty_discount,
        notes = v_notes,
        reference = v_reference
    WHERE id = v_invoice_id;

    DELETE FROM public.sales_invoice_items
    WHERE invoice_id = v_invoice_id;
  END IF;

  FOR v_item IN
    SELECT value AS item, ordinality
    FROM jsonb_array_elements(p_items) WITH ORDINALITY
  LOOP
    INSERT INTO public.sales_invoice_items (
      invoice_id,
      product_id,
      description,
      quantity,
      unit_price,
      discount,
      total,
      net_total,
      sort_order
    ) VALUES (
      v_invoice_id,
      (v_item.item->>'product_id')::uuid,
      NULLIF(BTRIM(COALESCE(v_item.item->>'description', '')), ''),
      (v_item.item->>'quantity')::numeric,
      (v_item.item->>'unit_price')::numeric,
      COALESCE((v_item.item->>'discount')::numeric, 0),
      ROUND((v_item.item->>'total')::numeric, 2),
      ROUND(COALESCE((v_item.item->>'net_total')::numeric, (v_item.item->>'total')::numeric), 2),
      (v_item.ordinality - 1)::integer
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_sales_invoice_draft(uuid, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_sales_invoice_draft(uuid, jsonb, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.save_sales_invoice_draft(uuid, jsonb, jsonb) IS
  'Atomic create/update gateway for a sales-invoice draft and all of its lines.';
