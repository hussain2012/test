-- Prerequisite: run supabase_schema_fix.sql first to create the store tables.
do $$
begin
  if to_regclass('public.products') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.orders') is null then
    raise exception 'Run supabase_schema_fix.sql first; required store tables are missing.';
  end if;
end;
$$;

create or replace function public.create_order_with_stock(p_account_id uuid, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := auth.uid();
  v_item record;
  v_product public.products%rowtype;
  v_mode text;
  v_remaining integer;
  v_order_number integer;
  v_order_items jsonb;
begin
  if v_account_id is null or v_account_id <> p_account_id then
    raise exception 'يجب تسجيل الدخول لإرسال الطلب';
  end if;

  if jsonb_typeof(p_payload->'items') is distinct from 'array' then
    raise exception 'السلة فارغة';
  end if;
  if jsonb_array_length(p_payload->'items') = 0 then
    raise exception 'السلة فارغة';
  end if;

  perform 1 from public.profiles where id = v_account_id for update;
  select coalesce(max("accountOrderNumber"), 0) + 1
    into v_order_number
    from public.orders
    where "accountId" = v_account_id;

  for v_item in
    select (entry.value->>'productId')::bigint as product_id,
           sum((entry.value->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_payload->'items') as entry(value)
      group by (entry.value->>'productId')::bigint
      order by (entry.value->>'productId')::bigint
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'كمية المنتج غير صحيحة';
    end if;

    select * into v_product
      from public.products
      where id = v_item.product_id
      for update;
    if not found then
      raise exception 'أحد المنتجات لم يعد متوفراً';
    end if;

    v_mode := coalesce(
      v_product."availabilityMode",
      case when coalesce(v_product."stockQuantity", 0) <= 0 then 'unavailable'
           when coalesce(v_product."inStock", true) then 'ready'
           else 'preorder' end
    );
    if v_mode = 'unavailable' or (v_mode = 'ready' and coalesce(v_product."stockQuantity", 0) <= 0) then
      raise exception '% غير متوفر حالياً', v_product.name;
    end if;

    if v_mode = 'ready' then
      v_remaining := coalesce(v_product."stockQuantity", 0) - v_item.quantity;
      if v_remaining < 0 then
        raise exception 'الكمية المطلوبة من % أكبر من المتوفر', v_product.name;
      end if;
      update public.products
        set "stockQuantity" = v_remaining,
            "inStock" = v_remaining > 0,
            "availabilityMode" = case when v_remaining = 0 then 'unavailable' else 'ready' end
        where id = v_item.product_id;
    end if;
  end loop;

  select jsonb_agg(
    entry.value || jsonb_build_object(
      'selectedVariants', coalesce(entry.value->'selectedVariants', '{}'::jsonb),
      'costPrice', coalesce(product."costPrice", 0),
      'discountPercentage', coalesce(product."discountPercentage", 0),
      'discountType', coalesce(product."discountType", 'percentage'),
      'discountValue', coalesce(product."discountValue", product."discountPercentage", 0)
    ) order by entry.ordinality
  ) into v_order_items
  from jsonb_array_elements(p_payload->'items') with ordinality as entry(value, ordinality)
  join public.products product on product.id = (entry.value->>'productId')::bigint;

  insert into public.orders (
    items, "customerName", province, address, "nearestLandmark", "phoneNumber",
    subtotal, "discountCode", "discountAmount", "deliveryFee", "finalTotal",
    "accountId", "accountOrderNumber", status, "createdAt"
  ) values (
    v_order_items,
    p_payload->>'customerName',
    p_payload->>'province',
    p_payload->>'address',
    p_payload->>'nearestLandmark',
    p_payload->>'phoneNumber',
    coalesce((p_payload->>'subtotal')::numeric, 0),
    coalesce(p_payload->>'discountCode', ''),
    coalesce((p_payload->>'discountAmount')::numeric, 0),
    coalesce((p_payload->>'deliveryFee')::numeric, 0),
    coalesce((p_payload->>'finalTotal')::numeric, 0),
    v_account_id,
    v_order_number,
    'new',
    now()
  );

  return v_order_number;
end;
$$;

revoke all on function public.create_order_with_stock(uuid, jsonb) from public;
revoke all on function public.create_order_with_stock(uuid, jsonb) from anon;
grant execute on function public.create_order_with_stock(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';