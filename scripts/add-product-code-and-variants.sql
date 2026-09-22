-- Safe upgrade for an existing Supabase database.
-- Adds product codes and selectable product variants without deleting data.

alter table public.products add column if not exists "productCode" text;
alter table public.products add column if not exists variants jsonb not null default '[]'::jsonb;

create unique index if not exists products_product_code_unique
on public.products ("productCode")
where "productCode" is not null and btrim("productCode") <> '';
