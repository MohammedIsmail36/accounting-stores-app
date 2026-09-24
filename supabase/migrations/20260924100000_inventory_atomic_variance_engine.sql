-- Phase 3: database-only engine. The existing UI is not switched by this migration.
-- Run the migration as one transaction (the migration runner provides the wrapper).
DO $preflight$
BEGIN
  IF to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public.reverse_inventory_adjustment_atomic(uuid,uuid,text)') IS NOT NULL
     OR to_regclass('public.inventory_variance_operations') IS NOT NULL
     OR to_regclass('public.inventory_variance_operation_lines') IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'inventory_movements'
         AND column_name = 'reference_type')
     OR to_regprocedure('public.create_journal_entry(date,text,jsonb,text,integer,text)') IS NULL
     OR to_regprocedure('public.inventory_signed_quantity(text,numeric)') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_ATOMIC_VARIANCE_BASELINE_MISMATCH';
  END IF;
END $preflight$;

CREATE TABLE public.inventory_variance_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('adjustment', 'physical_count')),
  source_id uuid NOT NULL,
  operation_kind text NOT NULL CHECK (operation_kind IN ('post', 'reverse')),
  request_id uuid NOT NULL UNIQUE,
  original_operation_id uuid REFERENCES public.inventory_variance_operations(id),
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  actor_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_variance_one_operation_per_source UNIQUE (source_type, source_id, operation_kind),
  CONSTRAINT inventory_variance_reverse_requires_original CHECK (
    (operation_kind = 'post' AND original_operation_id IS NULL)
    OR (operation_kind = 'reverse' AND original_operation_id IS NOT NULL)
  )
);

CREATE TABLE public.inventory_variance_operation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.inventory_variance_operations(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  before_quantity numeric NOT NULL,
  after_quantity numeric NOT NULL,
  quantity_delta numeric NOT NULL CHECK (quantity_delta <> 0),
  before_book_value numeric NOT NULL,
  unit_cost numeric NOT NULL CHECK (unit_cost > 0),
  effect_value numeric NOT NULL CHECK (effect_value > 0),
  cost_source text NOT NULL,
  CONSTRAINT inventory_variance_one_line_per_product UNIQUE (operation_id, product_id),
  CONSTRAINT inventory_variance_line_quantity_check CHECK (after_quantity = before_quantity + quantity_delta)
);

ALTER TABLE public.inventory_movements
  ADD COLUMN variance_operation_id uuid REFERENCES public.inventory_variance_operations(id);
CREATE UNIQUE INDEX inventory_movements_variance_operation_product_unique
  ON public.inventory_movements(variance_operation_id, product_id)
  WHERE variance_operation_id IS NOT NULL;

ALTER TABLE public.inventory_variance_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_variance_operation_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_variance_operations,
  public.inventory_variance_operation_lines FROM PUBLIC, anon, authenticated, service_role;

-- Shared, non-exposed writer. A future physical-count adapter can reuse this
-- with server-assembled effects; clients cannot supply effects or journal lines.
CREATE FUNCTION public.apply_inventory_variance_effects_internal(
  p_operation_id uuid, p_source_type text, p_source_id uuid, p_date date,
  p_effects jsonb, p_journal_lines jsonb, p_description text, p_actor uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_effect jsonb;
  v_journal_id uuid;
  v_updated numeric;
BEGIN
  IF p_source_type NOT IN ('adjustment', 'physical_count')
     OR p_effects IS NULL OR jsonb_typeof(p_effects) <> 'array'
     OR p_journal_lines IS NULL OR jsonb_typeof(p_journal_lines) <> 'array'
     OR NOT EXISTS (SELECT 1 FROM public.inventory_variance_operations
       WHERE id = p_operation_id AND source_type = p_source_type AND source_id = p_source_id)
  THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_INTERNAL_INPUT_INVALID';
  END IF;

  FOR v_effect IN SELECT value FROM jsonb_array_elements(p_effects) LOOP
    IF (v_effect->>'quantity_delta')::numeric = 0
       OR (v_effect->>'effect_value')::numeric <= 0
       OR (v_effect->>'unit_cost')::numeric <= 0 THEN
      RAISE EXCEPTION 'INVENTORY_VARIANCE_INTERNAL_LINE_INVALID';
    END IF;

    UPDATE public.products
    SET quantity_on_hand = (v_effect->>'after_quantity')::numeric,
        updated_at = now()
    WHERE id = (v_effect->>'product_id')::uuid
      AND quantity_on_hand = (v_effect->>'before_quantity')::numeric
    RETURNING quantity_on_hand INTO v_updated;
    IF NOT FOUND OR v_updated < 0 THEN
      RAISE EXCEPTION 'INVENTORY_VARIANCE_PRECONDITION_CHANGED';
    END IF;

    INSERT INTO public.inventory_movements(
      product_id, movement_type, quantity, unit_cost, total_cost,
      reference_id, reference_type, notes, movement_date, created_by,
      variance_operation_id
    ) VALUES (
      (v_effect->>'product_id')::uuid, 'adjustment',
      (v_effect->>'quantity_delta')::numeric,
      (v_effect->>'unit_cost')::numeric,
      (v_effect->>'effect_value')::numeric,
      p_source_id, p_source_type, p_description, p_date, p_actor,
      p_operation_id
    );

    INSERT INTO public.inventory_variance_operation_lines(
      operation_id, product_id, before_quantity, after_quantity,
      quantity_delta, before_book_value, unit_cost, effect_value, cost_source
    ) VALUES (
      p_operation_id, (v_effect->>'product_id')::uuid,
      (v_effect->>'before_quantity')::numeric,
      (v_effect->>'after_quantity')::numeric,
      (v_effect->>'quantity_delta')::numeric,
      (v_effect->>'before_book_value')::numeric,
      (v_effect->>'unit_cost')::numeric,
      (v_effect->>'effect_value')::numeric,
      v_effect->>'cost_source'
    );
  END LOOP;

  IF jsonb_array_length(p_journal_lines) > 0 THEN
    v_journal_id := public.create_journal_entry(
      p_date, p_description, p_journal_lines, 'posted', NULL, 'regular'
    );
  ELSIF jsonb_array_length(p_effects) > 0 THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_JOURNAL_REQUIRED';
  END IF;

  UPDATE public.inventory_variance_operations
  SET journal_entry_id = v_journal_id
  WHERE id = p_operation_id;
  RETURN v_journal_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_inventory_variance_effects_internal(
  uuid,text,uuid,date,jsonb,jsonb,text,uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.post_inventory_adjustment_atomic(
  p_adjustment_id uuid, p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_doc public.inventory_adjustments%ROWTYPE;
  v_item public.inventory_adjustment_items%ROWTYPE;
  v_product_id uuid;
  v_qty numeric;
  v_movement_qty numeric;
  v_book numeric;
  v_unit numeric;
  v_delta numeric;
  v_value numeric;
  v_shortage numeric := 0;
  v_surplus numeric := 0;
  v_cost_source text;
  v_effects jsonb := '[]'::jsonb;
  v_journal_lines jsonb := '[]'::jsonb;
  v_operation_id uuid;
  v_existing public.inventory_variance_operations%ROWTYPE;
  v_journal_id uuid;
  v_1104 uuid;
  v_4201 uuid;
  v_5201 uuid;
  v_actor uuid := auth.uid();
  v_locked_until date;
BEGIN
  IF p_adjustment_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_REQUEST_INVALID';
  END IF;
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (public.has_role(v_actor, 'admin'::public.app_role)
       OR public.has_role(v_actor, 'accountant'::public.app_role)) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_PERMISSION_DENIED';
  END IF;

  SELECT * INTO v_doc FROM public.inventory_adjustments
  WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_VARIANCE_SOURCE_NOT_FOUND'; END IF;

  SELECT * INTO v_existing FROM public.inventory_variance_operations
  WHERE request_id = p_request_id;
  IF FOUND AND (v_existing.source_type <> 'adjustment'
      OR v_existing.source_id <> p_adjustment_id OR v_existing.operation_kind <> 'post') THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_REQUEST_CONFLICT';
  END IF;
  IF v_doc.status = 'posted' THEN
    SELECT * INTO v_existing FROM public.inventory_variance_operations
    WHERE source_type = 'adjustment' AND source_id = p_adjustment_id
      AND operation_kind = 'post';
    IF FOUND THEN
      RETURN jsonb_build_object('status','posted','operation_id',v_existing.id,
        'journal_entry_id',v_existing.journal_entry_id,'repeated',true);
    END IF;
    RAISE EXCEPTION 'INVENTORY_VARIANCE_LEGACY_POSTED_DOCUMENT';
  END IF;
  IF v_doc.status NOT IN ('draft', 'review') OR v_doc.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_SOURCE_STATUS_INVALID';
  END IF;
  SELECT locked_until_date INTO v_locked_until FROM public.company_settings LIMIT 1;
  IF v_locked_until IS NOT NULL AND v_doc.adjustment_date <= v_locked_until THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_PERIOD_LOCKED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_adjustment_items
      WHERE adjustment_id = p_adjustment_id)
     OR EXISTS (SELECT 1 FROM public.inventory_adjustment_items
       WHERE adjustment_id = p_adjustment_id GROUP BY product_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_ITEMS_INVALID';
  END IF;

  FOR v_product_id IN
    SELECT DISTINCT product_id FROM public.inventory_adjustment_items
    WHERE adjustment_id = p_adjustment_id ORDER BY product_id
  LOOP
    PERFORM 1 FROM public.products WHERE id = v_product_id AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_VARIANCE_PRODUCT_UNAVAILABLE'; END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM public.inventory_adjustment_items
    WHERE adjustment_id = p_adjustment_id ORDER BY product_id
  LOOP
    SELECT quantity_on_hand INTO v_qty FROM public.products
    WHERE id = v_item.product_id;
    SELECT COALESCE(sum(public.inventory_signed_quantity(m.movement_type::text, m.quantity)),0),
      COALESCE(sum(CASE
        WHEN m.movement_type::text = 'adjustment'
          THEN sign(m.quantity) * abs(m.total_cost)
        WHEN m.movement_type::text IN ('sale','purchase_return')
          THEN -abs(m.total_cost)
        ELSE abs(m.total_cost) END),0)
    INTO v_movement_qty, v_book
    FROM public.inventory_movements m WHERE m.product_id = v_item.product_id;
    v_delta := v_item.actual_quantity - v_qty;
    IF v_qty <> v_movement_qty OR v_qty <> v_item.system_quantity
       OR v_item.actual_quantity < 0 OR v_item.difference <> v_delta THEN
      RAISE EXCEPTION 'INVENTORY_VARIANCE_PRECONDITION_CHANGED';
    END IF;
    IF (v_qty = 0 AND v_book <> 0) OR (v_qty > 0 AND v_book <= 0) THEN
      RAISE EXCEPTION 'INVENTORY_VARIANCE_BOOK_VALUE_INVALID';
    END IF;
    IF v_delta = 0 THEN CONTINUE; END IF;
    IF NULLIF(btrim(COALESCE(v_item.notes,'')), '') IS NULL THEN
      RAISE EXCEPTION 'INVENTORY_VARIANCE_REASON_REQUIRED';
    END IF;

    IF v_qty > 0 THEN
      v_unit := v_book / v_qty;
      v_cost_source := 'movement_book_value';
    ELSE
      IF v_delta < 0 THEN RAISE EXCEPTION 'INVENTORY_VARIANCE_NEGATIVE_STOCK'; END IF;
      SELECT abs(m.total_cost) / abs(m.quantity) INTO v_unit
      FROM public.inventory_movements m
      WHERE m.product_id = v_item.product_id AND m.movement_type = 'purchase'
        AND m.quantity <> 0 AND m.total_cost > 0
      ORDER BY m.movement_date DESC, m.created_at DESC, m.id DESC LIMIT 1;
      v_cost_source := 'last_purchase_movement';
    END IF;
    IF v_unit IS NULL OR v_unit <= 0 THEN
      RAISE EXCEPTION 'INVENTORY_VARIANCE_COST_REQUIRED';
    END IF;
    v_value := round(abs(v_delta) * v_unit, 2);
    IF v_delta < 0 AND v_item.actual_quantity = 0 THEN
      v_value := round(v_book, 2);
    END IF;
    IF v_value <= 0 THEN RAISE EXCEPTION 'INVENTORY_VARIANCE_COST_REQUIRED'; END IF;

    v_effects := v_effects || jsonb_build_array(jsonb_build_object(
      'product_id', v_item.product_id,
      'before_quantity', v_qty, 'after_quantity', v_item.actual_quantity,
      'quantity_delta', v_delta, 'before_book_value', v_book,
      'unit_cost', v_unit, 'effect_value', v_value, 'cost_source', v_cost_source
    ));
    UPDATE public.inventory_adjustment_items SET unit_cost = v_unit,
      total_cost = v_value WHERE id = v_item.id;
    IF v_delta < 0 THEN v_shortage := v_shortage + v_value;
    ELSE v_surplus := v_surplus + v_value; END IF;
  END LOOP;

  IF v_shortage + v_surplus > 0 THEN
    SELECT id INTO v_1104 FROM public.accounts WHERE code = '1104'
      AND account_type = 'asset' AND is_active AND NOT is_parent AND is_system;
    IF v_shortage > 0 THEN
      SELECT id INTO v_5201 FROM public.accounts WHERE code = '5201'
        AND account_type = 'expense' AND is_active AND NOT is_parent AND is_system;
    END IF;
    IF v_surplus > 0 THEN
      SELECT id INTO v_4201 FROM public.accounts WHERE code = '4201'
        AND account_type = 'revenue' AND is_active AND NOT is_parent AND is_system;
    END IF;
    IF v_1104 IS NULL OR (v_shortage > 0 AND v_5201 IS NULL)
       OR (v_surplus > 0 AND v_4201 IS NULL) THEN
      RAISE EXCEPTION 'INVENTORY_VARIANCE_ACCOUNT_INVALID';
    END IF;
    IF v_shortage > 0 THEN
      v_journal_lines := v_journal_lines || jsonb_build_array(
        jsonb_build_object('account_id',v_5201,'debit',v_shortage,'credit',0),
        jsonb_build_object('account_id',v_1104,'debit',0,'credit',v_shortage));
    END IF;
    IF v_surplus > 0 THEN
      v_journal_lines := v_journal_lines || jsonb_build_array(
        jsonb_build_object('account_id',v_1104,'debit',v_surplus,'credit',0),
        jsonb_build_object('account_id',v_4201,'debit',0,'credit',v_surplus));
    END IF;
  END IF;

  INSERT INTO public.inventory_variance_operations(
    source_type,source_id,operation_kind,request_id,actor_id
  ) VALUES ('adjustment',p_adjustment_id,'post',p_request_id,v_actor)
  RETURNING id INTO v_operation_id;

  v_journal_id := public.apply_inventory_variance_effects_internal(
    v_operation_id,'adjustment',p_adjustment_id,v_doc.adjustment_date,
    v_effects,v_journal_lines,
    'تسوية مخزون رقم ADJ-' || v_doc.adjustment_number,v_actor
  );
  UPDATE public.inventory_adjustments SET status = 'posted',
    journal_entry_id = v_journal_id, updated_at = now()
  WHERE id = p_adjustment_id;
  RETURN jsonb_build_object('status','posted','operation_id',v_operation_id,
    'journal_entry_id',v_journal_id,'repeated',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.post_inventory_adjustment_atomic(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_inventory_adjustment_atomic(uuid,uuid)
  TO authenticated, service_role;

CREATE FUNCTION public.reverse_inventory_adjustment_atomic(
  p_adjustment_id uuid, p_request_id uuid, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_doc public.inventory_adjustments%ROWTYPE;
  v_original public.inventory_variance_operations%ROWTYPE;
  v_existing public.inventory_variance_operations%ROWTYPE;
  v_line public.inventory_variance_operation_lines%ROWTYPE;
  v_product_id uuid;
  v_qty numeric;
  v_book numeric;
  v_effects jsonb := '[]'::jsonb;
  v_journal_lines jsonb := '[]'::jsonb;
  v_operation_id uuid;
  v_journal_id uuid;
  v_actor uuid := auth.uid();
  v_locked_until date;
BEGIN
  IF p_adjustment_id IS NULL OR p_request_id IS NULL
     OR NULLIF(btrim(COALESCE(p_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_REVERSAL_REQUEST_INVALID';
  END IF;
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_REVERSAL_PERMISSION_DENIED';
  END IF;
  SELECT * INTO v_doc FROM public.inventory_adjustments
  WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_VARIANCE_SOURCE_NOT_FOUND'; END IF;

  SELECT * INTO v_existing FROM public.inventory_variance_operations
  WHERE request_id = p_request_id;
  IF FOUND AND (v_existing.source_type <> 'adjustment'
      OR v_existing.source_id <> p_adjustment_id OR v_existing.operation_kind <> 'reverse') THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_REQUEST_CONFLICT';
  END IF;
  IF v_doc.status = 'cancelled' THEN
    SELECT * INTO v_existing FROM public.inventory_variance_operations
    WHERE source_type = 'adjustment' AND source_id = p_adjustment_id
      AND operation_kind = 'reverse';
    IF FOUND THEN
      RETURN jsonb_build_object('status','cancelled','operation_id',v_existing.id,
        'journal_entry_id',v_existing.journal_entry_id,'repeated',true);
    END IF;
  END IF;
  IF v_doc.status <> 'posted' THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_REVERSAL_STATUS_INVALID';
  END IF;
  SELECT * INTO v_original FROM public.inventory_variance_operations
  WHERE source_type = 'adjustment' AND source_id = p_adjustment_id
    AND operation_kind = 'post' FOR UPDATE;
  IF NOT FOUND OR v_doc.journal_entry_id IS DISTINCT FROM v_original.journal_entry_id THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_REVERSAL_ORIGINAL_INVALID';
  END IF;
  SELECT locked_until_date INTO v_locked_until FROM public.company_settings LIMIT 1;
  IF v_locked_until IS NOT NULL AND CURRENT_DATE <= v_locked_until THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_PERIOD_LOCKED';
  END IF;

  FOR v_product_id IN
    SELECT product_id FROM public.inventory_variance_operation_lines
    WHERE operation_id = v_original.id ORDER BY product_id
  LOOP
    PERFORM 1 FROM public.products WHERE id = v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_VARIANCE_PRODUCT_UNAVAILABLE'; END IF;
  END LOOP;
  FOR v_line IN SELECT * FROM public.inventory_variance_operation_lines
    WHERE operation_id = v_original.id ORDER BY product_id
  LOOP
    SELECT quantity_on_hand INTO v_qty FROM public.products WHERE id = v_line.product_id;
    IF v_qty - v_line.quantity_delta < 0 THEN
      RAISE EXCEPTION 'INVENTORY_VARIANCE_REVERSAL_NEGATIVE_STOCK';
    END IF;
    SELECT COALESCE(sum(CASE
      WHEN m.movement_type::text = 'adjustment'
        THEN sign(m.quantity) * abs(m.total_cost)
      WHEN m.movement_type::text IN ('sale','purchase_return')
        THEN -abs(m.total_cost)
      ELSE abs(m.total_cost) END),0)
    INTO v_book FROM public.inventory_movements m WHERE m.product_id = v_line.product_id;
    v_effects := v_effects || jsonb_build_array(jsonb_build_object(
      'product_id',v_line.product_id,'before_quantity',v_qty,
      'after_quantity',v_qty-v_line.quantity_delta,
      'quantity_delta',-v_line.quantity_delta,'before_book_value',v_book,
      'unit_cost',v_line.unit_cost,'effect_value',v_line.effect_value,
      'cost_source','reversal_of_original'
    ));
  END LOOP;
  IF v_original.journal_entry_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'account_id',account_id,'debit',credit,'credit',debit,
      'description','عكس تسوية مخزون') ORDER BY id),'[]'::jsonb)
    INTO v_journal_lines FROM public.journal_entry_lines
    WHERE journal_entry_id = v_original.journal_entry_id;
    IF jsonb_array_length(v_journal_lines) < 2 THEN
      RAISE EXCEPTION 'INVENTORY_VARIANCE_REVERSAL_JOURNAL_INVALID';
    END IF;
  ELSIF jsonb_array_length(v_effects) > 0 THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_REVERSAL_JOURNAL_INVALID';
  END IF;

  INSERT INTO public.inventory_variance_operations(
    source_type,source_id,operation_kind,request_id,original_operation_id,
    actor_id,reason
  ) VALUES ('adjustment',p_adjustment_id,'reverse',p_request_id,
    v_original.id,v_actor,btrim(p_reason)) RETURNING id INTO v_operation_id;
  v_journal_id := public.apply_inventory_variance_effects_internal(
    v_operation_id,'adjustment',p_adjustment_id,CURRENT_DATE,
    v_effects,v_journal_lines,
    'عكس تسوية مخزون رقم ADJ-' || v_doc.adjustment_number,v_actor
  );
  UPDATE public.inventory_adjustments SET status = 'cancelled',updated_at = now()
  WHERE id = p_adjustment_id;
  RETURN jsonb_build_object('status','cancelled','operation_id',v_operation_id,
    'journal_entry_id',v_journal_id,'repeated',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.reverse_inventory_adjustment_atomic(uuid,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_inventory_adjustment_atomic(uuid,uuid,text)
  TO authenticated, service_role;
