alter table public.products
  add column if not exists "availabilityMode" text not null default 'ready';

update public.products
set "availabilityMode" = case
  when coalesce("stockQuantity", 0) <= 0 then 'unavailable'
  when coalesce("inStock", true) then 'ready'
  else 'preorder'
end
where "availabilityMode" = 'ready'
  and (coalesce("stockQuantity", 0) <= 0 or not coalesce("inStock", true));