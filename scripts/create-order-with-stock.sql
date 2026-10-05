-- Run after supabase_schema_fix.sql when only the order RPC needs to be refreshed.
create or replace function public.create_order_with_stock(p_account_id uuid, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := auth.uid();
  v_entry record;
  v_product public.products%rowtype;
  v_discount public.discounts%rowtype;
  v_variant jsonb;
  v_choice jsonb;
  v_selected_variants jsonb;
  v_saved_variants jsonb;
  v_order_items jsonb := '[]'::jsonb;
  v_request_key text;
  v_selected_label text;
  v_selected_key text;
  v_product_id bigint;
  v_quantity integer;
  v_choice_price numeric;
  v_base_price numeric;
  v_unit_price numeric;
  v_subtotal numeric := 0;
  v_discount_amount numeric := 0;
  v_delivery_fee numeric;
  v_final_total numeric;
  v_discount_code text;
  v_mode text;
  v_remaining integer;
  v_order_number integer;
  v_maintenance_mode boolean;
begin
  if p_account_id is null
     or (coalesce(auth.role(), '') <> 'service_role'
         and (v_account_id is null or v_account_id <> p_account_id)) then
    raise exception 'يجب تسجيل الدخول لإرسال الطلب';
  end if;

  v_request_key := nullif(btrim(p_payload->>'requestId'), '');
  if v_request_key is null or length(v_request_key) > 100 then
    raise exception 'تعذر التحقق من رقم الطلب. أعد المحاولة';
  end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array'
     or jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb)) = 0 then
    raise exception 'السلة فارغة';
  end if;

  perform 1 from public.profiles where id = p_account_id for update;
  if not found then
    raise exception 'تعذر العثور على الحساب';
  end if;

  select "accountOrderNumber" into v_order_number
  from public.orders
  where "accountId" = p_account_id and "requestKey" = v_request_key;
  if found then
    return v_order_number;
  end if;

  select coalesce("maintenanceMode", false) into v_maintenance_mode
  from public.site_settings order by id desc limit 1;
  if coalesce(v_maintenance_mode, false) then
    raise exception 'الطلبات متوقفة مؤقتاً بسبب الصيانة';
  end if;

  if nullif(btrim(p_payload->>'customerName'), '') is null
     or nullif(btrim(p_payload->>'province'), '') is null
     or nullif(btrim(p_payload->>'address'), '') is null
     or nullif(btrim(p_payload->>'nearestLandmark'), '') is null
     or coalesce(p_payload->>'phoneNumber', '') !~ '^07[0-9]{9}$' then
    raise exception 'يرجى إكمال بيانات الطلب وإدخال رقم هاتف عراقي صحيح';
  end if;

  select coalesce(max("accountOrderNumber"), 0) + 1 into v_order_number
  from public.orders where "accountId" = p_account_id;

  for v_entry in
    select value, ordinality
    from jsonb_array_elements(p_payload->'items') with ordinality
    order by ordinality
  loop
    if coalesce(v_entry.value->>'productId', '') !~ '^[0-9]+$'
       or coalesce(v_entry.value->>'quantity', '') !~ '^[1-9][0-9]*$' then
      raise exception 'كمية المنتج غير صحيحة';
    end if;
    v_product_id := (v_entry.value->>'productId')::bigint;
    v_quantity := (v_entry.value->>'quantity')::integer;

    select * into v_product from public.products where id = v_product_id for update;
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
      v_remaining := coalesce(v_product."stockQuantity", 0) - v_quantity;
      if v_remaining < 0 then
        raise exception 'الكمية المطلوبة من % أكبر من المتوفر', v_product.name;
      end if;
      update public.products
      set "stockQuantity" = v_remaining,
          "inStock" = v_remaining > 0,
          "availabilityMode" = case when v_remaining = 0 then 'unavailable' else 'ready' end
      where id = v_product_id;
    end if;

    v_selected_variants := coalesce(v_entry.value->'selectedVariants', '{}'::jsonb);
    if jsonb_typeof(v_selected_variants) <> 'object' then
      raise exception 'خيارات أحد المنتجات غير صحيحة';
    end if;
    v_saved_variants := '{}'::jsonb;
    v_base_price := v_product.price;

    for v_variant in select value from jsonb_array_elements(coalesce(v_product.variants, '[]'::jsonb))
    loop
      v_selected_label := v_selected_variants->>btrim(v_variant->>'name');
      if v_selected_label is null then
        raise exception 'اختر قيمة % للمنتج %', v_variant->>'name', v_product.name;
      end if;

      select value into v_choice
      from jsonb_array_elements(coalesce(v_variant->'values', '[]'::jsonb))
      where case
        when jsonb_typeof(value) = 'object' then coalesce(value->>'label', value->>'value', '')
        else value #>> '{}'
      end = v_selected_label
      limit 1;
      if not found then
        raise exception 'أحد خيارات المنتج لم يعد متاحاً';
      end if;
      v_choice_price := greatest(0, coalesce(nullif(v_choice->>'price', '')::numeric, 0));

      if v_choice_price > 0 then
        v_base_price := v_choice_price;
      end if;
      v_saved_variants := v_saved_variants || jsonb_build_object(btrim(v_variant->>'name'), v_selected_label);
    end loop;

    for v_selected_key in select jsonb_object_keys(v_selected_variants)
    loop
      if not exists (
        select 1 from jsonb_array_elements(coalesce(v_product.variants, '[]'::jsonb)) as saved_variant(value)
        where btrim(saved_variant.value->>'name') = v_selected_key
      ) then
        raise exception 'أحد خيارات المنتج غير صالح';
      end if;
    end loop;

    if v_product."discountType" = 'amount' then
      v_base_price := greatest(0, v_base_price - greatest(0, coalesce(v_product."discountValue", 0)));
    else
      v_base_price := v_base_price * (1 - least(100, greatest(0, coalesce(v_product."discountValue", v_product."discountPercentage", 0))) / 100);
    end if;
    v_unit_price := round(v_base_price, 2);
    v_subtotal := v_subtotal + v_unit_price * v_quantity;
    v_order_items := v_order_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'name', v_product.name,
      'price', v_unit_price,
      'quantity', v_quantity,
      'selectedVariants', v_saved_variants,
      'costPrice', coalesce(v_product."costPrice", 0),
      'discountPercentage', coalesce(v_product."discountPercentage", 0),
      'discountType', coalesce(v_product."discountType", 'percentage'),
      'discountValue', coalesce(v_product."discountValue", v_product."discountPercentage", 0)
    ));
  end loop;

  v_discount_code := upper(btrim(coalesce(p_payload->>'discountCode', '')));
  if v_discount_code <> '' then
    select * into v_discount from public.discounts
    where upper(code) = v_discount_code and active = true;
    if not found then
      raise exception 'كود الخصم غير صالح أو غير فعال';
    end if;
    if v_discount.value < 0
       or (v_discount.type = 'percentage' and v_discount.value > 100)
       or v_discount.type not in ('percentage', 'fixed') then
      raise exception 'قيمة كود الخصم غير صحيحة';
    end if;
    v_discount_amount := case
      when v_discount.type = 'percentage' then round(v_subtotal * v_discount.value / 100, 2)
      else least(v_subtotal, v_discount.value)
    end;
  end if;

  select greatest(0, coalesce((select "deliveryFee" from public.site_settings order by id desc limit 1), 5000))
  into v_delivery_fee;
  v_final_total := v_subtotal - v_discount_amount + v_delivery_fee;

  insert into public.orders (
    items, "customerName", province, address, "nearestLandmark", "phoneNumber",
    subtotal, "discountCode", "discountAmount", "deliveryFee", "finalTotal",
    "accountId", "accountOrderNumber", "requestKey", status, "createdAt"
  ) values (
    v_order_items, btrim(p_payload->>'customerName'), btrim(p_payload->>'province'),
    btrim(p_payload->>'address'), btrim(p_payload->>'nearestLandmark'),
    p_payload->>'phoneNumber', v_subtotal, v_discount_code, v_discount_amount,
    v_delivery_fee, v_final_total, p_account_id, v_order_number, v_request_key, 'processing', now()
  );
  return v_order_number;
end;
$$;

revoke all on function public.create_order_with_stock(uuid, jsonb) from public;
revoke all on function public.create_order_with_stock(uuid, jsonb) from anon;
grant execute on function public.create_order_with_stock(uuid, jsonb) to authenticated;
grant execute on function public.create_order_with_stock(uuid, jsonb) to service_role;
notify pgrst, 'reload schema';
