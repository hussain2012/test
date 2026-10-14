alter table public.page_views
  add column if not exists "productId" bigint references public.products(id) on delete set null;

create index if not exists page_views_product_id_idx
  on public.page_views ("productId");