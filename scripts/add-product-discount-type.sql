alter table public.products
  add column if not exists "discountType" text not null default 'percentage';

alter table public.products
  add column if not exists "discountValue" numeric(12,2) not null default 0;

update public.products
set "discountValue" = "discountPercentage"
where "discountType" = 'percentage'
  and "discountValue" = 0
  and "discountPercentage" > 0;