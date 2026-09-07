DELETE FROM public.product_categories
WHERE name IN ('عام','إلكترونيات','أثاث','مواد غذائية','مستلزمات مكتبية','قطع غيار','مواد خام','أخرى','ملحقات')
  AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.category_id = product_categories.id);

DELETE FROM public.product_units
WHERE (name, symbol) IN (('قطعة','pc'),('كيلو','kg'),('متر','m'),('لتر','L'),('علبة','box'),('كرتون','ctn'),('طن','ton'),('دزينة','dz'))
  AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.unit_id = product_units.id);

DELETE FROM public.product_units
WHERE name = 'قطعة' AND symbol = 'قطعة'
  AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.unit_id = product_units.id);

DELETE FROM public.product_brands
WHERE name IN ('HP','سامسونج')
  AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.brand_id = product_brands.id);