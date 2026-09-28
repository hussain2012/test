alter table public.site_settings
  add column if not exists "storeCategories" jsonb;

notify pgrst, 'reload schema';