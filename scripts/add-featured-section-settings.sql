alter table public.site_settings
  add column if not exists "featuredSectionTitle" text,
  add column if not exists "featuredProductIds" jsonb;

notify pgrst, 'reload schema';
