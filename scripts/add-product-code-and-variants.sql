-- Safe upgrade for an existing Supabase database.
-- Adds product codes and selectable product variants without deleting data.

do $$
begin
	if exists (
		select 1 from information_schema.columns
		where table_schema = 'public' and table_name = 'products' and column_name = 'productCode'
	) then
		if not exists (
			select 1 from information_schema.columns
			where table_schema = 'public' and table_name = 'products' and column_name = 'product_code'
		) then
			alter table public.products rename column "productCode" to product_code;
		else
			update public.products set product_code = coalesce(product_code, "productCode") where product_code is null;
		end if;
	end if;
end;
$$;

alter table public.products add column if not exists product_code text;
alter table public.products alter column product_code set default ('PRD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));
alter table public.products add column if not exists variants jsonb not null default '[]'::jsonb;

drop index if exists public.products_product_code_unique;
create unique index if not exists products_product_code_unique
on public.products (product_code)
where product_code is not null and btrim(product_code) <> '';

notify pgrst, 'reload schema';
