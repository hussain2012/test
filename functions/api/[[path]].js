import { createClient } from '@supabase/supabase-js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
});
const empty = (status = 204) => new Response(null, {
  status,
  headers: { 'Access-Control-Allow-Origin': '*' },
});
const errorResponse = (message, status = 500) => json({ error: message }, status);
const bool = (value) => value === true || value === 'true' || value === 1 || value === '1';
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const parseJson = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || ''); return Array.isArray(parsed) ? parsed : fallback; } catch { return fallback; }
};
const defaultSettings = {
  id: 1,
  storeName: 'نسق',
  tagline: 'اختيارات تصنع يومك',
  logoUrl: '',
  heroTitle: 'أشياء صغيرة، فرق كبير',
  heroDescription: 'منتجات منتقاة بعناية لتمنح تفاصيل يومك معنى أجمل.',
  heroImageUrl: '',
  heroButtonText: 'اكتشف المجموعة',
  instagramUrl: '',
  tiktokUrl: '',
  facebookUrl: '',
  whatsappUrl: '',
  aboutTitle: 'من نحن؟',
  aboutText: '',
  maintenanceMode: false,
};

const createSupabase = (env) => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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
const parseBody = async (request) => {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    return Object.fromEntries([...form.entries()].filter(([key, value]) => typeof value === 'string' || !value?.name));
  }
  return request.json().catch(() => ({}));
};
const normalizeProduct = (row) => {
  const images = Array.isArray(row.productImages) ? row.productImages : parseJson(row.productImages);
  const price = number(row.price);
  const discount = number(row.discountPercentage);
  return {
    id: row.id, name: row.name, description: row.description, price,
    discountPercentage: discount,
    discountedPrice: Number((price * (1 - discount / 100)).toFixed(2)),
    imageUrl: row.imageUrl || '', productImages: [...new Set([row.imageUrl, ...images].filter(Boolean))],
    category: row.category || 'عام', stockQuantity: number(row.stockQuantity),
    preOrder: !Boolean(row.inStock), inStock: Boolean(row.inStock),
    featured: Boolean(row.featured), isNew: Boolean(row.isNew),
  };
};
const normalizeOrder = (row) => ({
  ...row,
  items: Array.isArray(row.items) ? row.items : parseJson(row.items),
  isRead: Boolean(row.isRead), accountOrderNumber: row.accountOrderNumber || null,
});
const uploadFormFiles = async (request, form, supabase) => {
  const uploaded = {};
  for (const [key, value] of [...form.entries()]) {
    if (!value || typeof value === 'string' || !value.name) continue;
    const path = `uploads/${crypto.randomUUID()}-${value.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    const { error } = await supabase.storage.from('uploads').upload(path, value, { contentType: value.type || 'application/octet-stream', upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from('uploads').getPublicUrl(path);
    uploaded[key] = data.publicUrl;
  }
  return uploaded;
};
const getSettings = async (supabase) => {
  const { data, error } = await supabase.from('site_settings').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return { ...defaultSettings, ...(data || {}), maintenanceMode: Boolean(data?.maintenanceMode) };
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
      const { data, error } = await supabase.from('products').select('*').order('featured', { ascending: false }).order('isNew', { ascending: false }).order('discountPercentage', { ascending: false }).order('id', { ascending: false });
      if (error) throw error;
      return json((data || []).map(normalizeProduct));
    }
    if (parts[0] === 'products' && parts.length === 2 && method === 'GET') {
      const { data, error } = await supabase.from('products').select('*').eq('id', parts[1]).maybeSingle();
      if (error) throw error;
      return data ? json(normalizeProduct(data)) : errorResponse('المنتج غير موجود', 404);
    }
    if (route === 'admin/products' && method === 'GET') {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      const { data, error } = await supabase.from('products').select('*').order('id', { ascending: false });
      if (error) throw error;
      return json((data || []).map((row) => ({ ...normalizeProduct(row), costPrice: number(row.costPrice), profit: Number((number(row.price) - number(row.costPrice)).toFixed(2)) })));
    }
    if (parts[0] === 'admin' && parts[1] === 'products' && parts.length === 2 && ['POST'].includes(method)) {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      const form = await request.formData();
      const files = await uploadFormFiles(request, form, supabase);
      const body = Object.fromEntries([...form.entries()].filter(([key, value]) => typeof value === 'string'));
      const images = [...parseJson(body.existingProductImages), ...(files.productImages ? [files.productImages] : [])];
      const { data, error } = await supabase.from('products').insert({
        name: body.name, description: body.description, price: number(body.price), costPrice: number(body.costPrice), discountPercentage: number(body.discountPercentage),
        imageUrl: files.primaryImage || body.imageUrl || images[0] || '', productImages: images, category: body.category || 'عام', stockQuantity: Math.max(0, number(body.stockQuantity, 10)),
        inStock: !['false', '0'].includes(String(body.inStock)), featured: bool(body.featured), isNew: bool(body.isNew),
      }).select().single();
      if (error) throw error;
      return json(normalizeProduct(data), 201);
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
      const { data: existing, error: existingError } = await supabase.from('products').select('*').eq('id', parts[2]).single();
      if (existingError) throw existingError;
      const images = [...parseJson(body.existingProductImages), ...(files.productImages ? [files.productImages] : [])];
      const { data, error } = await supabase.from('products').update({
        name: body.name ?? existing.name, description: body.description ?? existing.description, price: number(body.price, existing.price), costPrice: number(body.costPrice, existing.costPrice),
        discountPercentage: number(body.discountPercentage, existing.discountPercentage), imageUrl: files.primaryImage || body.imageUrl || images[0] || existing.imageUrl || '', productImages: images,
        category: body.category ?? existing.category, stockQuantity: Math.max(0, number(body.stockQuantity, existing.stockQuantity)), inStock: body.inStock === undefined ? existing.inStock : !['false', '0'].includes(String(body.inStock)),
        featured: body.featured === undefined ? existing.featured : bool(body.featured), isNew: body.isNew === undefined ? existing.isNew : bool(body.isNew),
      }).eq('id', parts[2]).select().single();
      if (error) throw error;
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
      return json((data || []).map(normalizeOrder));
    }
    if (route === 'account/coupons' && method === 'GET') {
      if (!session) return errorResponse('يجب تسجيل الدخول', 401);
      const { data, error } = await supabase.from('account_coupons').select('savedAt, discounts(*)').eq('accountId', session.accountId).order('savedAt', { ascending: false });
      if (error) throw error;
      return json((data || []).map((row) => ({ ...row.discounts, active: Boolean(row.discounts?.active), savedAt: row.savedAt })));
    }
    if (parts[0] === 'account' && parts[1] === 'coupons' && parts.length === 3 && method === 'POST') {
      if (!session) return errorResponse('يجب تسجيل الدخول', 401);
      const { data: discount, error: discountError } = await supabase.from('discounts').select('*').eq('code', parts[2].toUpperCase()).eq('active', true).maybeSingle();
      if (discountError) throw discountError;
      if (!discount) return errorResponse('كود الخصم غير صالح أو غير فعال', 404);
      const { error } = await supabase.from('account_coupons').upsert({ accountId: session.accountId, discountId: discount.id }, { onConflict: 'accountId,discountId' });
      if (error) throw error;
      return json({ ...discount, active: true, saved: true }, 201);
    }

    if (parts[0] === 'discounts' && parts[1] === 'validate' && parts.length === 3 && method === 'GET') {
      const { data, error } = await supabase.from('discounts').select('*').eq('code', parts[2].toUpperCase()).eq('active', true).maybeSingle();
      if (error) throw error;
      return json(data ? { ...data, active: true } : null);
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
      const settings = await getSettings(supabase);
      if (settings.maintenanceMode) return errorResponse('الطلبات متوقفة مؤقتاً بسبب الصيانة', 503);
      const body = await parseBody(request);
      if (!body.customerName || !body.province || !body.address || !body.nearestLandmark || !body.phoneNumber || !body.items?.length) return errorResponse('يرجى إكمال الحقول المطلوبة', 400);
      const ids = body.items.map((item) => item.productId);
      const { data: products, error: productsError } = await supabase.from('products').select('id, costPrice, discountPercentage').in('id', ids);
      if (productsError) throw productsError;
      const productMap = new Map((products || []).map((product) => [String(product.id), product]));
      const items = body.items.map((item) => ({ ...item, price: number(item.price), quantity: number(item.quantity), costPrice: number(productMap.get(String(item.productId))?.costPrice), discountPercentage: number(productMap.get(String(item.productId))?.discountPercentage) }));
      const { data: latest } = await supabase.from('orders').select('accountOrderNumber').eq('accountId', session.accountId).order('accountOrderNumber', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      const { data, error } = await supabase.from('orders').insert({ items, customerName: body.customerName, province: body.province, address: body.address, nearestLandmark: body.nearestLandmark, phoneNumber: body.phoneNumber, subtotal: number(body.subtotal), discountCode: body.discountCode || '', discountAmount: number(body.discountAmount), deliveryFee: number(body.deliveryFee), finalTotal: number(body.finalTotal), accountId: session.accountId, accountOrderNumber: number(latest?.accountOrderNumber) + 1, status: 'processing', createdAt: new Date().toISOString() }).select('id').single();
      if (error) throw error;
      return json({ id: data.id }, 201);
    }
    if (parts[0] === 'orders' && parts.length === 2 && method === 'PATCH') {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      const body = await parseBody(request); const updates = {};
      if (body.status) updates.status = body.status;
      if (body.isRead !== undefined) updates.isRead = bool(body.isRead);
      const { error } = await supabase.from('orders').update(updates).eq('id', parts[1]);
      if (error) throw error;
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
      const revenue = delivered.reduce((sum, order) => sum + number(order.finalTotal), 0);
      const totalProfit = delivered.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + (number(item.price) - number(item.costPrice)) * number(item.quantity), 0), 0);
      return json({ totalViews: (homeViews || 0) + (productViews || 0), homeViews: homeViews || 0, productViews: productViews || 0, orderStats: { total: rows.length, new: rows.filter((o) => o.status === 'new').length, processing: rows.filter((o) => o.status === 'processing').length, delivered: delivered.length, cancelled: rows.filter((o) => o.status === 'cancelled').length }, currentRevenue: revenue, lastRevenue: 0, growth: 0, totalProfit, totalLosses: 0 });
    }
    if (route === 'admin/site-settings' && method === 'GET') {
      if (!requireAdmin(session)) return errorResponse('غير مصرح', 401);
      return json(await getSettings(supabase));
    }
    if (route === 'admin/site-settings' && method === 'POST') {
      if (!requireOwner(session)) return errorResponse('فقط مالك المتجر يستطيع تعديل الإعدادات', 403);
      const form = await request.formData(); const body = Object.fromEntries([...form.entries()].filter(([key, value]) => typeof value === 'string')); const files = await uploadFormFiles(request, form, supabase); const previous = await getSettings(supabase);
      const settings = { ...previous, ...body, logoUrl: files.logoImage || body.logoUrl || previous.logoUrl, heroImageUrl: files.heroImage || body.heroImageUrl || previous.heroImageUrl, maintenanceMode: bool(body.maintenanceMode) }; delete settings.id;
      const { error } = await supabase.from('site_settings').update(settings).eq('id', previous.id); if (error) throw error;
      return json({ ...settings, id: previous.id });
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
      await Promise.all([supabase.from('account_coupons').delete().neq('discountId', 0), supabase.from('account_carts').delete().neq('accountId', '00000000-0000-0000-0000-000000000000'), supabase.from('orders').delete().neq('id', 0), supabase.from('products').delete().neq('id', 0), supabase.from('discounts').delete().neq('id', 0), supabase.from('page_views').delete().neq('id', 0), supabase.from('admin_invites').delete().neq('identifier', ''), supabase.from('site_settings').delete().neq('id', 0)]);
      await supabase.from('site_settings').insert(defaultSettings); await supabase.from('discounts').insert({ code: 'NASAQ10', type: 'percentage', value: 10, active: true }); return json({ ok: true, message: 'تمت إعادة ضبط المتجر إلى الحالة الافتراضية' });
    }
    return errorResponse('المسار غير موجود', 404);
  } catch (error) {
    return errorResponse(error.message || 'حدث خطأ غير متوقع', 500);
  }
}
