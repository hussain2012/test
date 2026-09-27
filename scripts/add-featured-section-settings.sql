alter table public.site_settings
  add column if not exists "featuredSectionTitle" text,
  add column if not exists "featuredProductIds" jsonb,
  add column if not exists "featuredProducts" jsonb;

update public.site_settings
set "featuredProductIds" = "featuredProducts"
where "featuredProductIds" is null and "featuredProducts" is not null;

alter table public.site_settings
drop column if exists "featuredProducts";

alter table public.site_settings
  add column if not exists "featuredProductIds" jsonb;

notify pgrst, 'reload schema';
