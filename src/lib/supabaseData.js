import { supabase } from './supabaseClient';

const asArray = (value) => Array.isArray(value) ? value : [];
const asJsonArray = (value) => Array.isArray(value) ? value : (() => {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
})();
const asVariants = (value) => asJsonArray(value).map((variant) => ({
  name: String(variant?.name || '').trim(),
  values: asArray(variant?.values).map((item) => String(item).trim()).filter(Boolean),
})).filter((variant) => variant.name && variant.values.length);
const productView = (row) => {
  const price = Number(row?.price || 0);
  const discountType = row?.discountType === 'amount' ? 'amount' : 'percentage';
  const discountValue = Number(row?.discountValue ?? row?.discountPercentage ?? 0);
  const discountPercentage = discountType === 'percentage' ? discountValue : 0;
  const productCode = row?.product_code ?? row?.productCode;
  return {
    ...row,
    price,
    discountType,
    discountValue,
    discountPercentage,
    discountedPrice: Number((discountType === 'amount' ? Math.max(0, price - discountValue) : price * (1 - Math.min(100, discountValue) / 100)).toFixed(2)),
    imageUrl: row?.imageUrl || '',
    productCode: String(productCode || '').trim().toUpperCase(),
    productImages: [...new Set([row?.imageUrl, ...asJsonArray(row?.productImages ?? [])].filter(Boolean))],
    variants: asVariants(row?.variants),
    category: row?.category || 'عام',
    stockQuantity: Number(row?.stockQuantity ?? 0),
    inStock: Boolean(row?.inStock),
    featured: Boolean(row?.featured),
    isNew: Boolean(row?.isNew),
    preOrder: !Boolean(row?.inStock),
  };
};
const orderView = (row) => ({ ...row, items: asJsonArray(row?.items), isRead: Boolean(row?.isRead), accountOrderNumber: row?.accountOrderNumber || null });
const throwIfError = ({ data, error }) => { if (error) throw error; return data; };
const getFeaturedProductIds = (data) => {
  const fromCurrent = data?.featuredProductIds;
  const fromLegacy = data?.featuredProducts;
  if (Array.isArray(fromCurrent)) return fromCurrent.map(String);
  if (Array.isArray(fromLegacy)) return fromLegacy.map(String);
  return null;
};

export const defaultSettings = {
  id: 1, storeName: 'نسق', tagline: 'اختيارات تصنع يومك', logoUrl: '', heroTitle: 'أشياء صغيرة، فرق كبير',
  heroDescription: 'منتجات منتقاة بعناية لتمنح تفاصيل يومك معنى أجمل.', heroImageUrl: '', heroButtonText: 'اكتشف المجموعة',
  featuredSectionTitle: 'مختارات نسق', featuredProductIds: null, storeCategories: null,
  instagramUrl: '', tiktokUrl: '', facebookUrl: '', whatsappUrl: '', aboutTitle: 'من نحن؟', aboutText: '',
  policyTitle: 'سياستنا', policyText: 'نراجع كل طلب ونتواصل معك لتأكيد التفاصيل قبل التجهيز.', maintenanceMode: false,
};

const normalizeSettings = (data) => ({
  ...defaultSettings,
  ...(data || {}),
  policyTitle: String(data?.policyTitle || '').trim() || defaultSettings.policyTitle,
  policyText: String(data?.policyText || '').trim() || defaultSettings.policyText,
  featuredSectionTitle: String(data?.featuredSectionTitle || '').trim() || defaultSettings.featuredSectionTitle,
  featuredProductIds: getFeaturedProductIds(data),
  storeCategories: Array.isArray(data?.storeCategories) ? data.storeCategories : null,
  maintenanceMode: Boolean(data?.maintenanceMode),
});

export async function getSiteSettings() {
  const data = throwIfError(await supabase.from('site_settings').select('*').order('id', { ascending: false }).limit(1).maybeSingle());
  return normalizeSettings(data);
}
export async function recordView(type) { return throwIfError(await supabase.from('page_views').insert({ type: type === 'product' ? 'product' : 'home' }).select().single()); }
export async function listProducts() { const data = throwIfError(await supabase.from('products').select('*').order('featured', { ascending: false }).order('isNew', { ascending: false }).order('discountPercentage', { ascending: false }).order('id', { ascending: false })); return asArray(data).map(productView); }
export async function getProduct(id) { const data = throwIfError(await supabase.from('products').select('*').eq('id', id).maybeSingle()); return data ? productView(data) : null; }
export async function getCart(userId) { const data = throwIfError(await supabase.from('account_carts').select('items').eq('accountId', userId).maybeSingle()); return asArray(data?.items); }
export async function saveCart(userId, items) { return throwIfError(await supabase.from('account_carts').upsert({ accountId: userId, items: asArray(items), updatedAt: new Date().toISOString() }, { onConflict: 'accountId' })); }
export async function validateDiscount(code) { return throwIfError(await supabase.from('discounts').select('*').eq('code', String(code).toUpperCase()).eq('active', true).maybeSingle()); }
export async function saveCoupon(userId, discountId) { return throwIfError(await supabase.from('account_coupons').upsert({ accountId: userId, discountId }, { onConflict: 'accountId,discountId' })); }
export async function createOrder(payload, userId) {
  const products = throwIfError(await supabase.from('products').select('id,costPrice,discountPercentage,discountType,discountValue').in('id', asArray(payload.items).map((item) => item.productId)));
  const byId = new Map(asArray(products).map((product) => [String(product.id), product]));
  const items = asArray(payload.items).map((item) => ({
    ...item,
    selectedVariants: item.selectedVariants || {},
    costPrice: Number(byId.get(String(item.productId))?.costPrice || 0),
    discountPercentage: Number(byId.get(String(item.productId))?.discountPercentage || 0),
    discountType: byId.get(String(item.productId))?.discountType || 'percentage',
    discountValue: Number(byId.get(String(item.productId))?.discountValue ?? byId.get(String(item.productId))?.discountPercentage ?? 0),
  }));
  const latest = throwIfError(await supabase.from('orders').select('accountOrderNumber').eq('accountId', userId).order('accountOrderNumber', { ascending: false, nullsFirst: false }).limit(1).maybeSingle());
  const accountOrderNumber = Number(latest?.accountOrderNumber || 0) + 1;
  const data = throwIfError(await supabase.from('orders').insert({
    ...payload,
    items,
    accountId: userId,
    accountOrderNumber,
    status: 'new',
    createdAt: new Date().toISOString(),
  }).select('id,accountOrderNumber').single());
  return data.accountOrderNumber ?? accountOrderNumber;
}
export async function getAccountOrders(userId) { const data = throwIfError(await supabase.from('orders').select('*').eq('accountId', userId).order('createdAt', { ascending: false })); return asArray(data).map(orderView); }

export async function adminProducts() { const data = throwIfError(await supabase.from('products').select('*').order('id', { ascending: false })); return asArray(data).map((row) => ({ ...productView(row), costPrice: Number(row.costPrice || 0), profit: Number((Number(row.price || 0) - Number(row.costPrice || 0)).toFixed(2)) })); }
const safeUploadName = (file) => String(file?.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '-');
const productCodeColumn = (form) => {
  if (!Object.prototype.hasOwnProperty.call(form ?? {}, 'productCode') && !Object.prototype.hasOwnProperty.call(form ?? {}, 'product_code')) return {};
  const value = String(form?.productCode ?? form?.product_code ?? '').trim().toUpperCase();
  return { product_code: value || null };
};
async function uploadFiles(primaryImageFile, additionalImageFiles = []) { const urls = []; for (const file of [primaryImageFile, ...asArray(additionalImageFiles)].filter(Boolean)) { const path = `products/${crypto.randomUUID()}-${safeUploadName(file)}`; throwIfError(await supabase.storage.from('uploads').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })); urls.push(supabase.storage.from('uploads').getPublicUrl(path).data.publicUrl); } return urls; }
export async function uploadCategoryImage(file) { const path = `categories/${crypto.randomUUID()}-${safeUploadName(file)}`; throwIfError(await supabase.storage.from('uploads').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })); return supabase.storage.from('uploads').getPublicUrl(path).data.publicUrl; }
export async function moveProductsToCategory(currentCategory, nextCategory) { if (currentCategory === nextCategory) return; return throwIfError(await supabase.from('products').update({ category: nextCategory }).eq('category', currentCategory)); }
export async function createProduct(form, primaryFile, additionalFiles) {
  const productForm = form ?? {};
  const uploaded = await uploadFiles(primaryFile, additionalFiles);
  const images = [...asArray(productForm.productImages), ...uploaded];
  const data = throwIfError(await supabase.from('products').insert({
    name: productForm.name,
    ...productCodeColumn(productForm),
    description: productForm.description,
    price: Number(productForm.price),
    costPrice: Number(productForm.costPrice || 0),
    discountType: productForm.discountType === 'amount' ? 'amount' : 'percentage',
    discountValue: Number(productForm.discountValue ?? productForm.discountPercentage ?? 0),
    discountPercentage: productForm.discountType === 'amount' ? 0 : Number(productForm.discountValue ?? productForm.discountPercentage ?? 0),
    category: productForm.category || 'عام',
    imageUrl: (primaryImageFile ? uploaded[0] : '') || productForm.imageUrl || images[0] || '',
    productImages: images ?? [],
    variants: asVariants(productForm.variants),
    stockQuantity: Math.max(0, Number(productForm.stockQuantity ?? 10)),
    inStock: Boolean(productForm.inStock),
    featured: Boolean(productForm.featured),
    isNew: Boolean(productForm.isNew),
  }).select().single());
  return productView(data);
}

export async function updateProduct(idOrForm, form, primaryFile, additionalFiles) {
  // 1. استخراج النموذج (Form) والـ ID بشكل مرن من أي مكان
  let actualForm = typeof idOrForm === 'object' && idOrForm !== null ? idOrForm : (form || {});
  let rawId = typeof idOrForm !== 'object' ? idOrForm : (idOrForm?.id || idOrForm?.productId || form?.id || form?.productId);

  // تنظيف الـ ID إذا كان كائناً
  if (typeof rawId === 'object' && rawId !== null) {
    rawId = rawId.id || rawId.value;
  }

  let productId = String(rawId ?? '').trim();

  // 2. إذا لم يكن هناك ID صالح (منتج جديد أو غير محدد)، تحويل العملية تلقائياً إلى إنشاء منتج جديد
  if (!productId || productId === 'null' || productId === 'undefined' || productId === '[object Object]' || productId === '0') {
    if (typeof createProduct === 'function') {
      return await createProduct(actualForm, primaryFile, additionalFiles);
    }
  }

  // 3. رفع الصور إذا وجد ملفات جديدة
  const uploaded = typeof uploadFiles === 'function' ? await uploadFiles(primaryFile, additionalFiles) : [];
  const productImages = [
    ...(Array.isArray(actualForm?.productImages) ? actualForm.productImages : []),
    ...uploaded,
  ];

  // 4. تجهيز البيانات
  const rawPayload = {
    ...actualForm,
    discountType: actualForm?.discountType === 'amount' ? 'amount' : 'percentage',
    discountValue: Number(actualForm?.discountValue ?? actualForm?.discountPercentage ?? 0),
    discountPercentage: actualForm?.discountType === 'amount' ? 0 : Number(actualForm?.discountValue ?? actualForm?.discountPercentage ?? 0),
    imageUrl: (primaryFile ? uploaded[0] : '') || actualForm?.imageUrl || productImages[0] || '',
    productImages,
  };

  const payload = typeof sanitizeProductPayload === 'function' 
    ? sanitizeProductPayload(rawPayload) 
    : { ...rawPayload };

  // حذف الـ id من الحمولة حتى لا يتعارض مع استعلام Supabase
  delete payload.id;

  // 5. تنفيذ التحديث في Supabase
  const { data, error } = await supabase
    .from('products')
    .update(payload)
    .eq('id', Number(productId))
    .select()
    .single();

  if (error) throw error;
  return data;
}
export async function deleteProduct(id) { return throwIfError(await supabase.from('products').delete().eq('id', id)); }
export async function listOrders() { const data = throwIfError(await supabase.from('orders').select('*').order('createdAt', { ascending: false })); return asArray(data).map(orderView); }
export async function updateOrder(id, updates) { return throwIfError(await supabase.from('orders').update(updates).eq('id', id)); }
export async function unreadOrderCount() { const { count } = throwIfError(await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('isRead', false)); return count || 0; }
export async function listDiscounts() { return asArray(throwIfError(await supabase.from('discounts').select('*').order('id', { ascending: false }))); }
export async function createDiscount(form) { return throwIfError(await supabase.from('discounts').insert({ code: String(form.code).toUpperCase(), type: form.type, value: Number(form.value), active: form.active !== false }).select().single()); }
export async function updateDiscount(id, form) { return throwIfError(await supabase.from('discounts').update({ code: String(form.code).toUpperCase(), type: form.type, value: Number(form.value), active: Boolean(form.active) }).eq('id', id).select().single()); }
export async function deleteDiscount(id) { return throwIfError(await supabase.from('discounts').delete().eq('id', id)); }
export async function analytics() { const [{ count: homeViews }, { count: productViews }, orders] = await Promise.all([supabase.from('page_views').select('id', { count: 'exact', head: true }).eq('type', 'home'), supabase.from('page_views').select('id', { count: 'exact', head: true }).eq('type', 'product'), listOrders()]); const delivered = orders.filter((order) => order.status === 'delivered'); const totalProfit = delivered.reduce((sum, order) => sum + order.items.reduce((sub, item) => sub + (Number(item.price || 0) - Number(item.costPrice || 0)) * Number(item.quantity || 0), 0), 0); return { totalViews: (homeViews || 0) + (productViews || 0), homeViews: homeViews || 0, productViews: productViews || 0, orderStats: { total: orders.length, new: orders.filter((o) => o.status === 'new').length, processing: orders.filter((o) => o.status === 'processing').length, delivered: delivered.length, cancelled: orders.filter((o) => o.status === 'cancelled').length }, currentRevenue: delivered.reduce((sum, order) => sum + Number(order.finalTotal || 0), 0), lastRevenue: 0, growth: 0, totalProfit, totalLosses: 0 }; }
export async function accountCount() { const { count, error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }); if (error) throw error; return count || 0; }
export async function listAdmins() { const [admins, invites] = await Promise.all([supabase.from('profiles').select('id,identifier,createdAt,isOwner').eq('role', 'admin').order('createdAt'), supabase.from('admin_invites').select('identifier,createdAt').order('createdAt', { ascending: false })]); return { admins: asArray(throwIfError(admins)), invites: asArray(throwIfError(invites)) }; }
export async function inviteAdmin(identifier) { const normalized = String(identifier).trim().toLowerCase(); const profile = throwIfError(await supabase.from('profiles').select('id,role').eq('identifier', normalized).maybeSingle()); if (profile?.role === 'admin') throw new Error('هذا الحساب مشرف مسبقاً'); if (profile) return throwIfError(await supabase.from('profiles').update({ role: 'admin' }).eq('id', profile.id)); return throwIfError(await supabase.from('admin_invites').upsert({ identifier: normalized }, { onConflict: 'identifier' })); }
export async function removeAdmin(identifier) { const profile = throwIfError(await supabase.from('profiles').select('id,isOwner').eq('identifier', String(identifier).toLowerCase()).eq('role', 'admin').maybeSingle()); if (profile?.isOwner) throw new Error('لا يمكن حذف مالك المتجر'); if (profile) await supabase.from('profiles').update({ role: 'customer' }).eq('id', profile.id); return throwIfError(await supabase.from('admin_invites').delete().eq('identifier', String(identifier).toLowerCase())); }
export async function saveSiteSettings(settings) {
  const current = await getSiteSettings();
  const payload = { ...settings, id: undefined };
  if (Object.prototype.hasOwnProperty.call(current || {}, 'featuredProducts') && !Object.prototype.hasOwnProperty.call(payload, 'featuredProducts')) {
    payload.featuredProducts = payload.featuredProductIds ?? null;
    delete payload.featuredProductIds;
  }
  const data = throwIfError(await supabase.from('site_settings').update(payload).eq('id', current.id).select().single());
  return { ...defaultSettings, ...data, featuredProductIds: getFeaturedProductIds(data), storeCategories: Array.isArray(data?.storeCategories) ? data.storeCategories : null };
}
export async function resetStore() { await Promise.all([supabase.from('account_coupons').delete().neq('discountId', 0), supabase.from('account_carts').delete().neq('accountId', ''), supabase.from('orders').delete().neq('id', 0), supabase.from('products').delete().neq('id', 0), supabase.from('discounts').delete().neq('id', 0), supabase.from('page_views').delete().neq('id', 0), supabase.from('admin_invites').delete().neq('identifier', ''), supabase.from('site_settings').delete().neq('id', 0)]); throwIfError(await supabase.from('site_settings').insert(defaultSettings)); throwIfError(await supabase.from('discounts').insert({ code: 'NASAQ10', type: 'percentage', value: 10, active: true })); }