-- Run once in Supabase SQL Editor after importing legacy IDs.
select setval(
  pg_get_serial_sequence('public.products', 'id'),
  coalesce((select max(id) from public.products), 1),
  true
);

select setval(
  pg_get_serial_sequence('public.orders', 'id'),
  coalesce((select max(id) from public.orders), 1),
  true
);

select setval(
  pg_get_serial_sequence('public.discounts', 'id'),
  coalesce((select max(id) from public.discounts), 1),
  true
);

select setval(
  pg_get_serial_sequence('public.page_views', 'id'),
  coalesce((select max(id) from public.page_views), 1),
  true
);

select setval(
  pg_get_serial_sequence('public.site_settings', 'id'),
  coalesce((select max(id) from public.site_settings), 1),
  true
);
