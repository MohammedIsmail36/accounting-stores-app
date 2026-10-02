-- Run by the isolated test runner, inside an outer transaction that always rolls back.
DO $isolation$
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres'
     OR current_setting('server_version') <> '15.8'
     OR to_regclass('public.historical_sale_cost_corrections') IS NULL
  THEN RAISE EXCEPTION 'HISTORICAL_SALE_COST_ISOLATION_REQUIRED'; END IF;
END $isolation$;

CREATE TEMP TABLE historical_sale_cost_fixture ON COMMIT DROP AS
SELECT m.id AS movement_id, m.product_id, m.reference_id AS invoice_id,
       m.quantity, m.total_cost, m.unit_cost
FROM public.inventory_movements m
JOIN public.sales_invoices si ON si.id = m.reference_id
WHERE m.movement_type::text = 'sale'
  AND m.reference_type = 'sales_invoice'
  AND si.status::text = 'posted'
  AND m.quantity > 0 AND m.total_cost >= 0
ORDER BY m.id LIMIT 1;

DO $fixture$
BEGIN
  IF (SELECT count(*) FROM historical_sale_cost_fixture) <> 1 THEN
    RAISE EXCEPTION 'HISTORICAL_SALE_COST_FIXTURE_MISSING';
  END IF;
END $fixture$;

INSERT INTO public.historical_sale_cost_corrections
  (request_id, movement_id, source_invoice_id, expected_product_id,
   expected_quantity, expected_original_total_cost, delta_cost,
   reason, approval_reference)
SELECT gen_random_uuid(), movement_id, invoice_id, product_id, quantity,
       total_cost, 1.23, 'L3 isolated historical cost contract', 'L3-TEST-APPROVAL'
FROM historical_sale_cost_fixture;

DO $positive$
DECLARE f record;
BEGIN
  SELECT x.*, v.total_cost AS effective_cost, v.original_total_cost,
         v.correction_cost, c.id AS correction_id INTO f
  FROM historical_sale_cost_fixture x
  JOIN public.inventory_movements_effective_cost v ON v.id = x.movement_id
  JOIN public.historical_sale_cost_corrections c ON c.movement_id = x.movement_id;
  IF f.original_total_cost IS DISTINCT FROM f.total_cost
     OR f.correction_cost IS DISTINCT FROM 1.23
     OR f.effective_cost IS DISTINCT FROM f.total_cost + 1.23
     OR (SELECT total_cost FROM public.inventory_movements WHERE id = f.movement_id)
          IS DISTINCT FROM f.total_cost
  THEN RAISE EXCEPTION 'HISTORICAL_SALE_COST_EFFECTIVE_READER_WRONG'; END IF;

  BEGIN
    INSERT INTO public.historical_sale_cost_corrections
      (request_id,movement_id,source_invoice_id,expected_product_id,
       expected_quantity,expected_original_total_cost,delta_cost,reason,approval_reference)
    VALUES (gen_random_uuid(),f.movement_id,f.invoice_id,f.product_id,
            f.quantity,f.total_cost,1,'Duplicate correction forbidden','L3-TEST-APPROVAL');
    RAISE EXCEPTION 'DUPLICATE_ORIGINAL_ACCEPTED';
  EXCEPTION WHEN unique_violation OR raise_exception THEN
    IF SQLERRM = 'DUPLICATE_ORIGINAL_ACCEPTED' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.historical_sale_cost_corrections
      (request_id,movement_id,source_invoice_id,expected_product_id,
       expected_quantity,expected_original_total_cost,delta_cost,reason,approval_reference)
    VALUES (gen_random_uuid(),f.movement_id,gen_random_uuid(),f.product_id,
            f.quantity,f.total_cost,1,'Changed invoice must be rejected','L3-TEST-APPROVAL');
    RAISE EXCEPTION 'CHANGED_SOURCE_ACCEPTED';
  EXCEPTION WHEN foreign_key_violation OR raise_exception THEN
    IF SQLERRM = 'CHANGED_SOURCE_ACCEPTED' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.historical_sale_cost_corrections SET delta_cost = 9 WHERE id = f.correction_id;
    RAISE EXCEPTION 'CORRECTION_UPDATE_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'CORRECTION_UPDATE_ACCEPTED' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.historical_sale_cost_corrections WHERE id = f.correction_id;
    RAISE EXCEPTION 'CORRECTION_DELETE_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'CORRECTION_DELETE_ACCEPTED' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.inventory_movements SET total_cost = total_cost + 1 WHERE id = f.movement_id;
    RAISE EXCEPTION 'ORIGINAL_MOVEMENT_UPDATE_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'ORIGINAL_MOVEMENT_UPDATE_ACCEPTED' THEN RAISE; END IF;
  END;
END $positive$;

INSERT INTO public.historical_sale_cost_corrections
  (request_id, movement_id, source_invoice_id, expected_product_id,
   expected_quantity, expected_original_total_cost, delta_cost, reverses_id,
   reason, approval_reference)
SELECT gen_random_uuid(), c.movement_id, c.source_invoice_id, c.expected_product_id,
       c.expected_quantity, c.expected_original_total_cost, -c.delta_cost, c.id,
       'L3 isolated explicit compensating correction', 'L3-TEST-REVERSAL'
FROM public.historical_sale_cost_corrections c
JOIN historical_sale_cost_fixture f ON f.movement_id = c.movement_id
WHERE c.reverses_id IS NULL;

DO $reversal$
DECLARE f record;
BEGIN
  SELECT x.*, v.total_cost AS effective_cost, v.correction_cost INTO f
  FROM historical_sale_cost_fixture x
  JOIN public.inventory_movements_effective_cost v ON v.id = x.movement_id;
  IF f.effective_cost IS DISTINCT FROM f.total_cost OR f.correction_cost <> 0
     OR (SELECT count(*) FROM public.historical_sale_cost_corrections
         WHERE movement_id = f.movement_id) <> 2
  THEN RAISE EXCEPTION 'HISTORICAL_SALE_COST_REVERSAL_WRONG'; END IF;
END $reversal$;

SELECT user_id AS historical_admin_id FROM public.user_roles WHERE role::text = 'admin' LIMIT 1 \gset
SELECT user_id AS historical_sales_id FROM public.user_roles WHERE role::text = 'sales' LIMIT 1 \gset
GRANT SELECT ON historical_sale_cost_fixture TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'historical_admin_id', true) \gset
DO $admin$
BEGIN
  IF (SELECT count(*) FROM public.inventory_movements_effective_cost
      WHERE id = (SELECT movement_id FROM historical_sale_cost_fixture)) <> 1
    OR (SELECT count(*) FROM public.historical_sale_cost_corrections
        WHERE movement_id = (SELECT movement_id FROM historical_sale_cost_fixture)) <> 2
  THEN RAISE EXCEPTION 'HISTORICAL_SALE_COST_ADMIN_READ_REFUSED'; END IF;
END $admin$;
SELECT set_config('request.jwt.claim.sub', :'historical_sales_id', true) \gset
DO $sales$
BEGIN
  IF (SELECT count(*) FROM public.inventory_movements_effective_cost
      WHERE id = (SELECT movement_id FROM historical_sale_cost_fixture)) <> 0
    OR (SELECT count(*) FROM public.historical_sale_cost_corrections
        WHERE movement_id = (SELECT movement_id FROM historical_sale_cost_fixture)) <> 0
  THEN RAISE EXCEPTION 'HISTORICAL_SALE_COST_SALES_READ_LEAK'; END IF;
END $sales$;
RESET ROLE;
SELECT 'HISTORICAL_SALE_COST_CONTRACT_OK';
