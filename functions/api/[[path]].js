import { createClient } from '@supabase/supabase-js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  },
});
const empty = (status = 204) => new Response(null, {
  status,
  headers: {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  },
});
const errorResponse = (message, status = 500) => json({ error: message }, status);
const bool = (value) => value === true || value === 'true' || value === 1 || value === '1';
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const getBestSeller = (orders) => {
  const quantities = new Map();
  orders.forEach((order) => order.items.forEach((item) => {
    const quantity = number(item.quantity);
    const name = String(item.name || '').trim();
    if (quantity <= 0 || !name) return;
    const key = String(item.productId ?? name);
    const product = quantities.get(key) || { name, quantity: 0 };
    product.quantity += quantity;
    quantities.set(key, product);
  }));
  return [...quantities.values()].sort((first, second) => second.quantity - first.quantity)[0] || null;
};
const generateProductCode = () => `PRD-${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
const productCodeColumn = (body, generateIfMissing = false) => {
  if (!Object.prototype.hasOwnProperty.call(body ?? {}, 'productCode') && !Object.prototype.hasOwnProperty.call(body ?? {}, 'product_code')) {
    return generateIfMissing ? { product_code: generateProductCode() } : {};
  }
  const value = String(body?.productCode ?? body?.product_code ?? '').trim().toUpperCase();
  return { product_code: value || (generateIfMissing ? generateProductCode() : null) };
};
const parseJson = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || ''); return Array.isArray(parsed) ? parsed : fallback; } catch { return fallback; }
};
const defaultSettings = {
  storeName: '',
  tagline: '',
  taglineFont: 'cairo',
  taglineColor: '#1B1813',
  logoUrl: '',
  heroTitle: '',
  heroDescription: '',
  heroImageUrl: '',
  heroButtonText: '',
  instagramUrl: '',
  tiktokUrl: '',
  facebookUrl: '',
  whatsappUrl: '',
  aboutTitle: '',
  aboutText: '',
  maintenanceMode: false,
  taxRate: 0,
};

const createSupabase = (env) => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const isMissingColumnError = (error) => {
  const message = error?.message || '';
  return error?.code === '42703' || /Could not find the '.*' column|column .* does not exist/i.test(message);
};
const productQuery = async (supabase, { allowLegacyFallback = true } = {}) => {
  try {
    const { error } = await supabase.from('products').select('availabilityMode').limit(1);
    if (error && isMissingColumnError(error)) {
      if (!allowLegacyFallback) throw error;
      return supabase.from('products').select('*');
    }
    if (error) throw error;
    return supabase.from('products').select('*');
  } catch (error) {
    if (allowLegacyFallback && isMissingColumnError(error)) {
      return supabase.from('products').select('*');
    }
    throw error;
  }
};
const productPayloadWithAvailability = async (supabase, payload) => {
  try {
    const { error } = await supabase.from('products').select('availabilityMode').limit(1);
    if (error && isMissingColumnError(error)) return payload;
    if (error) throw error;
    return { ...payload, availabilityMode: payload.availabilityMode };
  } catch (error) {
    if (isMissingColumnError(error)) return payload;
    throw error;
  }
};

const getSession = async (request, supabase) => {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const { data: { user }, error } = await supabase.auth.getUser(authorization.slice(7));
  if (error || !user) return null;
  const { data: profile } = await supabase.from('profiles').select('id, identifier, role, "isOwner", "displayName", "pictureUrl"').eq('id', user.id).maybeSingle();
  return profile ? { accountId: user.id, ...profile, isOwner: profile.isOwner === true } : null;
};
const requireAdmin = (session) => session?.role === 'admin';
const requireOwner = (session) => session?.role === 'admin' && session.isOwner === true;
const securityPinHash = async (pin, salt) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: Uint8Array.from(salt.match(/.{2}/g), (byte) => Number.parseInt(byte, 16)),
    iterations: 600000,
    hash: 'SHA-256',
  }, key, 256);
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const equalHashes = (first, second) => {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
};
const hashResetToken = async (token) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const parseBody = async (request) => {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    return Object.fromEntries([...form.entries()].filter(([key, value]) => typeof value === 'string' || !value?.name));
  }
  return request.json().catch(() => ({}));
};
const normalizeProduct = (row) => {
  if (!row || typeof row !== 'object') return null;
  const storedImages = row?.productImages ?? [];
  const images = Array.isArray(storedImages) ? storedImages : parseJson(storedImages) ?? [];
  const price = number(row?.price);
  const discountType = row?.discountType === 'amount' ? 'amount' : 'percentage';
  const discountValue = number(row?.discountValue, number(row?.discountPercentage));
  const discount = discountType === 'percentage' ? discountValue : 0;
  const stockQuantity = number(row?.stockQuantity);
  const storedAvailabilityMode = row?.availabilityMode;
  const availabilityMode = ['ready', 'preorder', 'unavailable'].includes(storedAvailabilityMode)
    ? (storedAvailabilityMode === 'ready' && stockQuantity <= 0 ? 'unavailable' : storedAvailabilityMode)
    : (stockQuantity <= 0 ? 'unavailable' : (Boolean(row?.inStock) ? 'ready' : 'preorder'));
  const productCode = row?.product_code ?? row?.productCode;
  return {
    id: row?.id, name: row?.name, description: row?.description, productCode: String(productCode || '').trim().toUpperCase(), price,
    discountType, discountValue, discountPercentage: discount,
    discountedPrice: Number((discountType === 'amount' ? Math.max(0, price - discountValue) : price * (1 - Math.min(100, discountValue) / 100)).toFixed(2)),
    imageUrl: row?.imageUrl || '', productImages: [...new Set([row?.imageUrl, ...(images ?? [])].filter(Boolean))],
    category: String(row?.category || '').trim(), stockQuantity, availabilityMode,
    preOrder: availabilityMode === 'preorder', inStock: availabilityMode === 'ready', isUnavailable: availabilityMode === 'unavailable',
    featured: Boolean(row?.featured), isNew: Boolean(row?.isNew),
  };
};
const normalizeOrder = (row) => ({
  ...row,
  items: Array.isArray(row.items) ? row.items : parseJson(row.items),
  isRead: Boolean(row.isRead), accountOrderNumber: row.accountOrderNumber || null,
});
const publicDiscountData = (row) => row ? ({
  id: row.id,
  code: row.code,
  type: row.type,
  value: number(row.value),
  active: Boolean(row.active),
}) : null;
const uploadFormFiles = async (request, form, supabase) => {
  const uploaded = {};
  const extensionByType = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  for (const [key, value] of [...form.entries()]) {
    if (!value || typeof value === 'string' || !value.name) continue;
    const extension = extensionByType[value.type];
    if (!extension || value.size > 5 * 1024 * 1024) throw new Error('نوع الملف أو حجمه غير مدعوم');
    const path = `uploads/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from('uploads').upload(path, value, { contentType: value.type, upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from('uploads').getPublicUrl(path);
    uploaded[key] = data.publicUrl;
  }
  return uploaded;
};
const getSettings = async (supabase) => {
  const { data, error } = await supabase.from('site_settings').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return {
    ...defaultSettings,
    ...(data || {}),
    taglineFont: ['cairo', 'sans', 'serif'].includes(data?.taglineFont) ? data.taglineFont : defaultSettings.taglineFont,
    taglineColor: /^#[0-9a-fA-F]{6}$/.test(data?.taglineColor || '') ? data.taglineColor.toUpperCase() : defaultSettings.taglineColor,
    maintenanceMode: Boolean(data?.maintenanceMode),
    taxRate: Number.isFinite(Number(data?.taxRate)) ? Math.min(100, Math.max(0, Number(data.taxRate))) : 0,
  };
};
const pathParts = (request) => new URL(request.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return empty(204);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return errorResponse('Supabase server environment variables are missing.', 503);
  const supabase = createSupabase(env);
  const session = await getSession(request, supabase);
  const method = request.method;
  const parts = pathParts(request);
  const route = parts.join('/');
  try {
    if (route === 'site-settings' && method === 'GET') return json(await getSettings(supabase));
    if (route === 'analytics/view' && method === 'POST') {
      const body = await parseBody(request);
      const { error } = await supabase.from('page_views').insert({ type: body.type === 'product' ? 'product' : 'home' });
      if (error) throw error;
      return json({ ok: true, type: body.type === 'product' ? 'product' : 'home' }, 201);
    }
    if (route === 'auth/account-count' && method === 'GET') {
      const { count, error } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
      if (error) throw error;
      return json({ count: count || 0 });
    }

    if (route === 'products' && method === 'GET') {
      const query = await productQuery(supabase);
      const { data, error } = await query.order('featured', { ascending: false }).order('isNew', { ascending: false }).order('discountPercentage', { ascending: false }).order('id', { ascending: false });
      if (error) throw error;
      return json((data || []).filter(Boolean).map(normalizeProduct).filter(Boolean));
    }
    if (parts[0] === 'products' && parts.length === 2 && method === 'GET') {
      const query = await productQuery(supabase);
      const { data, error } = await query.eq('id', parts[1]).maybeSingle();
      if (error) throw error;
      return data ? json(normalizeProduct(data)) : errorResponse('المنتج غير موجود', 404);
    }
    if (route === 'admin/products' && method === 'GET') {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      const query = await productQuery(supabase);
      const { data, error } = await query.order('id', { ascending: false });
      if (error) throw error;
      return json((data || []).filter(Boolean).map((row) => ({ ...normalizeProduct(row), costPrice: number(row.costPrice), profit: Number((number(row.price) - number(row.costPrice)).toFixed(2)) })).filter(Boolean));
    }
    if (parts[0] === 'admin' && parts[1] === 'products' && parts.length === 2 && ['POST'].includes(method)) {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      const form = await request.formData();
      const files = await uploadFormFiles(request, form, supabase);
      const body = Object.fromEntries([...form.entries()].filter(([key, value]) => typeof value === 'string'));
      const images = [...(parseJson(body.existingProductImages) ?? []), ...(files?.productImages ? [files.productImages] : [])];
      const stockQuantity = Math.max(0, number(body.stockQuantity, 10));
      const availabilityMode = ['ready', 'preorder', 'unavailable'].includes(body.availabilityMode)
        ? (body.availabilityMode === 'ready' && stockQuantity <= 0 ? 'unavailable' : body.availabilityMode)
        : (stockQuantity <= 0 ? 'unavailable' : (!['false', '0'].includes(String(body.inStock)) ? 'ready' : 'preorder'));
      const insertPayload = {
        name: body.name, description: body.description, price: number(body.price), costPrice: number(body.costPrice),
        discountType: body.discountType === 'amount' ? 'amount' : 'percentage', discountValue: number(body.discountValue, number(body.discountPercentage)), discountPercentage: body.discountType === 'amount' ? 0 : number(body.discountValue, number(body.discountPercentage)),
        variants: parseJson(body.variants), availabilityMode,
        ...productCodeColumn(body, true),
        imageUrl: files?.primaryImage || body.imageUrl || images[0] || '', productImages: images ?? [], category: String(body.category || '').trim(), stockQuantity,
        inStock: availabilityMode === 'ready', featured: bool(body.featured), isNew: bool(body.isNew),
      };
      const { data, error } = await supabase.from('products').insert(await productPayloadWithAvailability(supabase, { ...insertPayload, availabilityMode })).select().single();
      if (error) throw error;
      return json({ ...normalizeProduct(data), costPrice: number(data.costPrice), profit: Number((number(data.price) - number(data.costPrice)).toFixed(2)) }, 201);
    }
    if (parts[0] === 'admin' && parts[1] === 'products' && parts.length === 3 && ['PUT', 'DELETE'].includes(method)) {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      if (method === 'DELETE') {
        const { error } = await supabase.from('products').delete().eq('id', parts[2]);
        if (error) throw error;
        return empty();
      }
      const form = await request.formData();
      const files = await uploadFormFiles(request, form, supabase);
      const body = Object.fromEntries([...form.entries()].filter(([key, value]) => typeof value === 'string'));
      const { data: existing, error: existingError } = await supabase.from('products').select('*').eq('id', parts[2]).maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return errorResponse('المنتج غير موجود', 404);
      const images = [...(parseJson(body.existingProductImages) ?? []), ...(files?.productImages ? [files.productImages] : [])];
      const stockQuantity = Math.max(0, number(body.stockQuantity, existing?.stockQuantity));
      const existingAvailabilityMode = normalizeProduct(existing).availabilityMode;
      const availabilityMode = ['ready', 'preorder', 'unavailable'].includes(body.availabilityMode)
        ? (body.availabilityMode === 'ready' && stockQuantity <= 0 ? 'unavailable' : body.availabilityMode)
        : (stockQuantity <= 0 && existingAvailabilityMode === 'ready' ? 'unavailable' : existingAvailabilityMode);
      const updatePayload = {
        name: body.name ?? existing?.name, description: body.description ?? existing?.description, price: number(body.price, existing?.price), costPrice: number(body.costPrice, existing?.costPrice),
        variants: body.variants === undefined ? existing?.variants : parseJson(body.variants),
        availabilityMode,
        ...productCodeColumn(body),
        discountType: body.discountType === 'amount' ? 'amount' : (body.discountType || existing?.discountType || 'percentage'),
        discountValue: number(body.discountValue, number(body.discountPercentage, number(existing?.discountValue, number(existing?.discountPercentage)))),
        discountPercentage: body.discountType === 'amount' ? 0 : number(body.discountValue, number(body.discountPercentage, number(existing?.discountPercentage))),
        imageUrl: files?.primaryImage || body.imageUrl || images[0] || existing?.imageUrl || '', productImages: images ?? [],
        category: body.category ?? existing?.category, stockQuantity, inStock: availabilityMode === 'ready',
        featured: body.featured === undefined ? existing?.featured : bool(body.featured), isNew: body.isNew === undefined ? existing?.isNew : bool(body.isNew),
      };
      const { data, error } = await supabase.from('products').update(await productPayloadWithAvailability(supabase, { ...updatePayload, availabilityMode })).eq('id', parts[2]).select().single();
      if (error) throw error;
      if (!data) return errorResponse('تعذر استرجاع المنتج بعد التحديث', 404);
      return json(normalizeProduct(data));
    }

    if (route === 'account/cart' && ['GET', 'PUT'].includes(method)) {
      if (!session) return errorResponse('يجب تسجيل الدخول لحفظ السلة', 401);
      if (method === 'GET') {
        const { data, error } = await supabase.from('account_carts').select('items').eq('accountId', session.accountId).maybeSingle();
        if (error) throw error;
        return json({ items: Array.isArray(data?.items) ? data.items : [] });
      }
      const body = await parseBody(request);
      const items = Array.isArray(body.items) ? body.items : [];
      const { error } = await supabase.from('account_carts').upsert({ accountId: session.accountId, items, updatedAt: new Date().toISOString() }, { onConflict: 'accountId' });
      if (error) throw error;
      return json({ ok: true, items });
    }
    if (route === 'account/orders' && method === 'GET') {
      if (!session) return errorResponse('يجب تسجيل الدخول', 401);
      const { data, error } = await supabase.from('orders').select('*').eq('accountId', session.accountId).order('createdAt', { ascending: false });
      if (error) throw error;
      return json((data || []).map((row) => {
        const normalized = normalizeOrder(row);
        return {
          ...normalized,
          items: normalized.items.map((item) => {
            const { costPrice, ...safeItem } = item || {};
            return safeItem;
          }),
        };
      }));
    }
    if (route === 'account/coupons' && method === 'GET') {
      if (!session) return errorResponse('يجب تسجيل الدخول', 401);
      const { data, error } = await supabase.from('account_coupons').select('savedAt, discounts(*)').eq('accountId', session.accountId).order('savedAt', { ascending: false });
      if (error) throw error;
      return json((data || []).map((row) => ({ ...publicDiscountData(row.discounts), savedAt: row.savedAt })));
    }
    if (parts[0] === 'account' && parts[1] === 'coupons' && parts.length === 3 && method === 'POST') {
      if (!session) return errorResponse('يجب تسجيل الدخول', 401);
      const { data: discount, error: discountError } = await supabase.from('discounts').select('*').eq('code', parts[2].toUpperCase()).eq('active', true).maybeSingle();
      if (discountError) throw discountError;
      if (!discount) return errorResponse('كود الخصم غير صالح أو غير فعال', 404);
      const { error } = await supabase.from('account_coupons').upsert({ accountId: session.accountId, discountId: discount.id }, { onConflict: 'accountId,discountId' });
      if (error) throw error;
      return json({ ...publicDiscountData(discount), saved: true }, 201);
    }

    if (parts[0] === 'discounts' && parts[1] === 'validate' && parts.length === 3 && method === 'GET') {
      const { data, error } = await supabase.from('discounts').select('*').eq('code', parts[2].toUpperCase()).eq('active', true).maybeSingle();
      if (error) throw error;
      return json(publicDiscountData(data));
    }
    if (route === 'discounts' && method === 'GET') {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      const { data, error } = await supabase.from('discounts').select('*').order('id', { ascending: false });
      if (error) throw error;
      return json(data || []);
    }
    if (parts[0] === 'discounts' && parts.length === 1 && method === 'POST') {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      const body = await parseBody(request);
      const { data, error } = await supabase.from('discounts').insert({ code: String(body.code).toUpperCase(), type: body.type, value: number(body.value), active: body.active !== false }).select().single();
      if (error) return errorResponse(error.code === '23505' ? 'كود الخصم مستخدم مسبقاً' : error.message, 400);
      return json(data, 201);
    }
    if (parts[0] === 'discounts' && parts.length === 2 && ['PUT', 'DELETE'].includes(method)) {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      if (method === 'DELETE') { const { error } = await supabase.from('discounts').delete().eq('id', parts[1]); if (error) throw error; return empty(); }
      const body = await parseBody(request);
      const { data, error } = await supabase.from('discounts').update({ code: String(body.code).toUpperCase(), type: body.type, value: number(body.value), active: bool(body.active) }).eq('id', parts[1]).select().single();
      if (error) throw error;
      return json(data);
    }

    if (route === 'orders' && method === 'GET') {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      const { data, error } = await supabase.from('orders').select('*').order('createdAt', { ascending: false });
      if (error) throw error;
      return json((data || []).map(normalizeOrder));
    }
    if (route === 'orders/unread-count' && method === 'GET') {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      const { count, error } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('isRead', false);
      if (error) throw error;
      return json({ count: count || 0 });
    }
    if (route === 'orders' && method === 'POST') {
      if (!session) return errorResponse('يجب تسجيل الدخول لإرسال الطلب', 401);
      const body = await parseBody(request);
      const { data: accountOrderNumber, error: orderError } = await supabase.rpc('create_order_with_stock', {
        p_account_id: session.accountId,
        p_payload: body,
      });
      if (orderError) return errorResponse(orderError.message, 400);
      const { data: createdOrder, error: lookupError } = await supabase.from('orders')
        .select('id, accountOrderNumber')
        .eq('accountId', session.accountId)
        .eq('requestKey', String(body.requestId || ''))
        .maybeSingle();
      if (lookupError || !createdOrder) return errorResponse(lookupError?.message || 'تعذر استرجاع الطلب بعد إنشائه', 500);
      return json({ id: createdOrder.id, accountOrderNumber: createdOrder.accountOrderNumber ?? accountOrderNumber }, 201);
    }
    if (parts[0] === 'orders' && parts.length === 2 && method === 'PATCH') {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      const body = await parseBody(request);
      if (body.status !== undefined) {
        if (!['processing', 'delivered', 'cancelled'].includes(body.status)) return errorResponse('حالة الطلب غير صحيحة', 400);
        const { error } = await supabase.rpc('update_order_status', {
          p_order_id: parts[1],
          p_status: body.status,
          p_actor_id: session.accountId,
        });
        if (error) return errorResponse(error.message, 400);
      }
      if (body.isRead !== undefined) {
        const { error } = await supabase.from('orders').update({ isRead: bool(body.isRead) }).eq('id', parts[1]);
        if (error) throw error;
      }
      return json({ ok: true });
    }

    if (route === 'admin/analytics' && method === 'GET') {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      const [{ count: homeViews }, { count: productViews }, { data: orders }] = await Promise.all([
        supabase.from('page_views').select('id', { count: 'exact', head: true }).eq('type', 'home'),
        supabase.from('page_views').select('id', { count: 'exact', head: true }).eq('type', 'product'),
        supabase.from('orders').select('*'),
      ]);
      const rows = (orders || []).map(normalizeOrder); const delivered = rows.filter((order) => order.status === 'delivered');
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const ordersForMonth = (start, end) => delivered.filter((order) => {
        const createdAt = new Date(order.createdAt);
        return createdAt >= start && createdAt < end;
      });
      const revenueForOrders = (monthOrders) => monthOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + number(item.price) * number(item.quantity), 0), 0);
      const profitForOrders = (monthOrders) => monthOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + (number(item.price) - number(item.costPrice)) * number(item.quantity), 0), 0);
      const currentMonthOrders = ordersForMonth(currentMonthStart, nextMonthStart);
      const currentRevenue = revenueForOrders(currentMonthOrders);
      const lastRevenue = revenueForOrders(ordersForMonth(lastMonthStart, currentMonthStart));
      const growth = lastRevenue === 0 ? (currentRevenue > 0 ? 100 : 0) : Number((((currentRevenue - lastRevenue) / lastRevenue) * 100).toFixed(2));
      return json({ homeViews: homeViews || 0, orderStats: { total: rows.length, new: rows.filter((o) => o.status === 'new').length, processing: rows.filter((o) => o.status === 'processing').length, delivered: delivered.length, cancelled: rows.filter((o) => o.status === 'cancelled').length }, currentRevenue, lastRevenue, growth, totalProfit: profitForOrders(currentMonthOrders), bestSeller: getBestSeller(delivered), totalLosses: 0 });
    }
    if (route === 'admin/site-settings' && method === 'GET') {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      return json(await getSettings(supabase));
    }
    if (route === 'admin/setup-store' && method === 'POST') {
      if (!requireOwner(session)) return errorResponse('فقط مالك المتجر يستطيع إنشاء المتجر', 403);
      const form = await request.formData();
      let setup;
      try {
        setup = JSON.parse(String(form.get('setup') || ''));
      } catch {
        return errorResponse('بيانات إنشاء المتجر غير صالحة', 400);
      }

      const allowedFonts = ['cairo', 'sans', 'serif'];
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const storeName = String(setup?.storeName || '').trim();
      const tagline = String(setup?.tagline || '').trim();
      const aboutText = String(setup?.aboutText || '').trim();
      const policyText = String(setup?.policyText || '').trim();
      if (!storeName || storeName.length > 120 || !tagline || tagline.length > 160 ||
        !aboutText || aboutText.length > 5000 || !policyText || policyText.length > 5000 ||
        !allowedFonts.includes(setup?.taglineFont) || !/^#[0-9a-fA-F]{6}$/.test(setup?.taglineColor || '')) {
        return errorResponse('تحقق من اسم المتجر والشعار ونصوص التعريف والسياسات', 400);
      }

      const admin = setup.admin || null;
      if (admin && (!String(admin.name || '').trim() || String(admin.name).trim().length > 120 ||
        !emailPattern.test(String(admin.email || '').trim()) || String(admin.password || '').length < 8 ||
        String(admin.password).length > 128)) {
        return errorResponse('بيانات المشرف غير مكتملة أو غير صالحة', 400);
      }
      const product = setup.product || null;
      if (product && (!String(product.name || '').trim() || String(product.name).trim().length > 160 ||
        !String(product.description || '').trim() || String(product.description).trim().length > 5000 ||
        !Number.isFinite(Number(product.price)) || Number(product.price) <= 0 ||
        String(product.stockQuantity ?? '').trim() === '' ||
        !Number.isInteger(Number(product.stockQuantity)) || Number(product.stockQuantity) < 0)) {
        return errorResponse('بيانات المنتج الأول غير مكتملة أو غير صالحة', 400);
      }

      const image = form.get('productImage');
      const acceptedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (image && typeof image !== 'string' &&
        (!acceptedImageTypes.includes(image.type) || image.size > 5 * 1024 * 1024)) {
        return errorResponse('اختر صورة صالحة لا يتجاوز حجمها 5 ميغابايت', 400);
      }
      if (image && typeof image !== 'string' && !product) return errorResponse('لا يمكن رفع صورة من دون إضافة منتج', 400);
      let createdAdminId = null;
      let imagePath = null;
      try {
        if (admin) {
          const { data, error } = await supabase.auth.admin.createUser({
            email: String(admin.email).trim().toLowerCase(),
            password: String(admin.password),
            email_confirm: true,
            user_metadata: { full_name: String(admin.name).trim() },
          });
          if (error) return errorResponse(/already|registered|exists/i.test(error.message) ? 'هذا البريد الإلكتروني مستخدم مسبقاً' : error.message, /already|registered|exists/i.test(error.message) ? 409 : 400);
          createdAdminId = data.user.id;
        }

        let imageUrl = '';
        if (image && typeof image !== 'string' && product) {
          const extensionByType = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
          imagePath = `store-products/${crypto.randomUUID()}.${extensionByType[image.type]}`;
          const { error } = await supabase.storage.from('uploads').upload(
            imagePath,
            await image.arrayBuffer(),
            { contentType: image.type, upsert: false },
          );
          if (error) throw error;
          imageUrl = supabase.storage.from('uploads').getPublicUrl(imagePath).data.publicUrl;
        }

        const { error } = await supabase.rpc('complete_store_setup', {
          p_owner_id: session.accountId,
          p_settings: { storeName, tagline, taglineFont: setup.taglineFont, taglineColor: setup.taglineColor, aboutText, policyText },
          p_product: product ? {
            name: String(product.name).trim(),
            description: String(product.description).trim(),
            price: Number(product.price),
            stockQuantity: Number(product.stockQuantity),
            imageUrl,
          } : null,
          p_admin_id: createdAdminId,
          p_admin_name: admin ? String(admin.name).trim() : null,
        });
        if (error) throw error;
        return json({ ok: true, message: 'تم إنشاء المتجر بنجاح' }, 201);
      } catch (error) {
        const cleanupErrors = [];
        if (imagePath) {
          try {
            const { error: storageError } = await supabase.storage.from('uploads').remove([imagePath]);
            if (storageError) cleanupErrors.push(storageError.message);
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError.message);
          }
        }
        if (createdAdminId) {
          try {
            const { error: authError } = await supabase.auth.admin.deleteUser(createdAdminId);
            if (authError) cleanupErrors.push(authError.message);
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError.message);
          }
        }
        const message = cleanupErrors.length
          ? `${error.message} تعذر التراجع عن بعض الموارد: ${cleanupErrors.join('؛ ')}`
          : error.message;
        return errorResponse(message, 500);
      }
    }
    if (route === 'admin/site-settings' && method === 'POST') {
      if (!requireOwner(session)) return errorResponse('فقط مالك المتجر يستطيع تعديل الإعدادات', 403);
      const form = await request.formData(); const body = Object.fromEntries([...form.entries()].filter(([key, value]) => typeof value === 'string')); const files = await uploadFormFiles(request, form, supabase); const previous = await getSettings(supabase);
      const settings = {
        ...previous,
        ...body,
        taglineFont: ['cairo', 'sans', 'serif'].includes(body.taglineFont) ? body.taglineFont : previous.taglineFont,
        taglineColor: /^#[0-9a-fA-F]{6}$/.test(body.taglineColor || '') ? body.taglineColor.toUpperCase() : previous.taglineColor,
        logoUrl: files.logoImage || body.logoUrl || previous.logoUrl,
        heroImageUrl: files.heroImage || body.heroImageUrl || previous.heroImageUrl,
        maintenanceMode: bool(body.maintenanceMode),
      };
      delete settings.id;
      const { error } = await supabase.from('site_settings').update(settings).eq('id', previous.id); if (error) throw error;
      return json({ ...settings, id: previous.id });
    }
    if (route === 'admin/reset-security' && method === 'GET') {
      if (!requireOwner(session)) return errorResponse('فقط مالك المتجر يستطيع إدارة رمز الأمان', 403);
      const { data, error } = await supabase.from('store_security').select('id').eq('id', 1).maybeSingle();
      if (error) throw error;
      return json({ configured: Boolean(data) });
    }
    if (route === 'admin/reset-security' && method === 'POST') {
      if (!requireOwner(session)) return errorResponse('فقط مالك المتجر يستطيع إنشاء رمز الأمان', 403);
      const body = await parseBody(request);
      const pin = typeof body.pin === 'string' ? body.pin : '';
      if (pin.length < 6 || pin.length > 128) return errorResponse('يجب أن يتكون رمز الأمان من 6 خانات على الأقل وبحد أقصى 128 خانة', 400);
      const { data: existing, error: selectError } = await supabase.from('store_security').select('id').eq('id', 1).maybeSingle();
      if (selectError) throw selectError;
      if (existing) return errorResponse('تم إنشاء رمز الأمان مسبقاً', 409);
      const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const pinHash = await securityPinHash(pin, salt);
      const { error } = await supabase.from('store_security').insert({ id: 1, pin_hash: pinHash, pin_salt: salt });
      if (error) return errorResponse(error.code === '23505' ? 'تم إنشاء رمز الأمان مسبقاً' : error.message, error.code === '23505' ? 409 : 500);
      return json({ configured: true }, 201);
    }
    if (route === 'admin/reset-security/verify' && method === 'POST') {
      if (!requireOwner(session)) return errorResponse('فقط مالك المتجر يستطيع إعادة ضبطه', 403);
      const body = await parseBody(request);
      const pin = typeof body.pin === 'string' ? body.pin : '';
      if (!pin || pin.length > 128) return errorResponse('أدخل رمز الأمان', 400);
      const { data: security, error } = await supabase.from('store_security').select('pin_hash, pin_salt, locked_until').eq('id', 1).maybeSingle();
      if (error) throw error;
      if (!security) return errorResponse('أنشئ رمز الأمان أولاً', 409);
      if (security.locked_until && new Date(security.locked_until).getTime() > Date.now()) {
        const minutes = Math.ceil((new Date(security.locked_until).getTime() - Date.now()) / 60000);
        return errorResponse(`تم قفل المحاولات مؤقتاً. حاول بعد ${minutes} دقيقة.`, 429);
      }
      const candidateHash = await securityPinHash(pin, security.pin_salt);
      const matched = equalHashes(candidateHash, security.pin_hash);
      const { data: attempt, error: attemptError } = await supabase.rpc('record_reset_pin_attempt', { p_success: matched });
      if (attemptError) throw attemptError;
      if (!attempt.ok) {
        const minutes = Math.max(1, Math.ceil((new Date(attempt.lockedUntil).getTime() - Date.now()) / 60000));
        return errorResponse(`تم قفل المحاولات مؤقتاً. حاول بعد ${minutes} دقيقة.`, 429);
      }
      if (!matched) return errorResponse(`رمز الأمان غير صحيح. المحاولات المتبقية: ${5 - attempt.failedAttempts}`, 401);
      const token = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const { error: tokenError } = await supabase.from('store_security').update({
        reset_token_hash: await hashResetToken(token),
        reset_token_expires_at: expiresAt,
      }).eq('id', 1);
      if (tokenError) throw tokenError;
      return json({ resetToken: token, expiresAt });
    }
    if (route === 'admin/reset-security/confirm' && method === 'POST') {
      if (!requireOwner(session)) return errorResponse('فقط مالك المتجر يستطيع إعادة ضبطه', 403);
      const body = await parseBody(request);
      const token = typeof body.resetToken === 'string' ? body.resetToken : '';
      if (!/^[a-f0-9]{64}$/.test(token)) return errorResponse('انتهت صلاحية التأكيد. تحقق من الرمز مرة أخرى.', 400);
      const { data: consumed, error: consumeError } = await supabase.rpc('consume_store_reset_token', { p_token_hash: await hashResetToken(token) });
      if (consumeError) throw consumeError;
      if (!consumed) return errorResponse('انتهت صلاحية التأكيد. تحقق من الرمز مرة أخرى.', 401);
      const { error } = await supabase.rpc('reset_store', { p_owner_id: session.accountId });
      if (error) throw error;
      return json({ ok: true, message: 'تمت إعادة ضبط المتجر' });
    }
    if (route === 'admin/admins' && method === 'GET') {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      const [{ data: admins, error: adminError }, { data: invites, error: inviteError }] = await Promise.all([supabase.from('profiles').select('id, identifier, "createdAt", "isOwner"').eq('role', 'admin').order('createdAt'), supabase.from('admin_invites').select('identifier, "createdAt"').order('createdAt', { ascending: false })]);
      if (adminError || inviteError) throw adminError || inviteError;
      return json({ admins, invites });
    }
    if (route === 'admin/admins' && method === 'POST') {
      if (!requireOwner(session)) return errorResponse('فقط مالك المتجر يستطيع إدارة المشرفين', 403);
      const body = await parseBody(request); const identifier = String(body.identifier || '').trim().toLowerCase(); const { data: profile } = await supabase.from('profiles').select('id, role').eq('identifier', identifier).maybeSingle();
      if (profile?.role === 'admin') return errorResponse('هذا الحساب مشرف مسبقاً', 409);
      if (profile) { const { error } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', profile.id); if (error) throw error; return json({ identifier, role: 'admin', promoted: true }); }
      const { error } = await supabase.from('admin_invites').upsert({ identifier }, { onConflict: 'identifier' }); if (error) throw error; return json({ identifier, role: 'admin', invited: true }, 201);
    }
    if (parts[0] === 'admin' && parts[1] === 'admins' && parts.length === 3 && method === 'DELETE') {
      if (!requireOwner(session)) return errorResponse('فقط مالك المتجر يستطيع إدارة المشرفين', 403);
      const identifier = parts[2].toLowerCase(); const { data: profile } = await supabase.from('profiles').select('id, "isOwner"').eq('identifier', identifier).eq('role', 'admin').maybeSingle();
      if (profile?.isOwner) return errorResponse('لا يمكن حذف مالك المتجر', 400);
      if (profile) await supabase.from('profiles').update({ role: 'customer' }).eq('id', profile.id);
      await supabase.from('admin_invites').delete().eq('identifier', identifier); return empty();
    }
    if (route === 'admin/transfer-ownership' && method === 'POST') {
      if (!requireOwner(session)) return errorResponse('فقط مالك المتجر يمكنه تحويل الملكية', 403);
      const body = await parseBody(request); const identifier = String(body.newOwner || '').trim().toLowerCase(); const { data: target } = await supabase.from('profiles').select('id').eq('identifier', identifier).maybeSingle();
      if (!target) { await supabase.from('admin_invites').upsert({ identifier }, { onConflict: 'identifier' }); return json({ message: 'تم حفظ الحساب كدعوة، وسيصبح مديراً عند التسجيل' }, 202); }
      await supabase.from('profiles').update({ role: 'admin', isOwner: true }).eq('id', target.id); await supabase.from('profiles').update({ isOwner: false }).eq('id', session.accountId); return json({ message: 'تم تحويل الملكية بنجاح', newOwner: identifier });
    }
    if (route === 'admin/reset-store' && method === 'POST') {
      if (!requireOwner(session)) return errorResponse('فقط مالك المتجر يستطيع إعادة ضبطه', 403);
      return errorResponse('يجب التحقق من رمز الأمان قبل إعادة ضبط المتجر', 410);
    }
    return errorResponse('المسار غير موجود', 404);
  } catch (error) {
    console.error('API request failed', error);
    return errorResponse('حدث خطأ داخلي. حاول مرة أخرى.', 500);
  }
}
