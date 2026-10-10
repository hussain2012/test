import { supabase } from './supabaseClient';

const asArray = (value) => Array.isArray(value) ? value : [];
const asJsonArray = (value) => Array.isArray(value) ? value : (() => {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
})();
const asProductRows = (value) => asArray(value).filter((row) => row && typeof row === 'object');
const getBestSeller = (orders) => {
  const quantities = new Map();
  orders.forEach((order) => order.items.forEach((item) => {
    const quantity = Number(item.quantity || 0);
    const name = String(item.name || '').trim();
    if (quantity <= 0 || !name) return;
    const key = String(item.productId ?? name);
    const product = quantities.get(key) || { name, quantity: 0 };
    product.quantity += quantity;
    quantities.set(key, product);
  }));
  return [...quantities.values()].sort((first, second) => second.quantity - first.quantity)[0] || null;
};
const getProductAnalytics = (views, orders) => {
  const productStats = {};
  views.forEach((view) => {
    if (view.productId == null) return;
    const key = String(view.productId);
    productStats[key] = productStats[key] || { clicks: 0, quantity: 0, revenue: 0, netProfit: 0 };
    productStats[key].clicks += 1;
  });
  orders.forEach((order) => order.items.forEach((item) => {
    if (item.productId == null) return;
    const key = String(item.productId);
    const stats = productStats[key] || (productStats[key] = { clicks: 0, quantity: 0, revenue: 0, netProfit: 0 });
    const quantity = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    stats.quantity += quantity;
    stats.revenue += price * quantity;
    stats.netProfit += (price - Number(item.costPrice || 0)) * quantity;
  }));
  return productStats;
};
const asVariants = (value) => asJsonArray(value).map((variant) => ({
  name: String(variant?.name || '').trim(),
  selectionMode: 'single',
  priceMode: 'replace',
  required: true,
  maxSelections: 1,
  values: asArray(variant?.values).map((item) => typeof item === 'object' && item !== null
    ? { label: String(item.label ?? item.value ?? '').trim(), price: Number(item.price || 0) }
    : { label: String(item).trim(), price: 0 }).filter((item) => item.label),
})).filter((variant) => variant.name && variant.values.length);
const productView = (row) => {
  const price = Number(row?.price || 0);
  const stockQuantity = Number(row?.stockQuantity ?? 0);
  const storedAvailabilityMode = row?.availabilityMode;
  const availabilityMode = ['ready', 'preorder', 'unavailable'].includes(storedAvailabilityMode)
    ? (storedAvailabilityMode === 'ready' && stockQuantity <= 0 ? 'unavailable' : storedAvailabilityMode)
    : (stockQuantity <= 0 ? 'unavailable' : (Boolean(row?.inStock) ? 'ready' : 'preorder'));
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
    category: String(row?.category || '').trim(),
    stockQuantity,
    availabilityMode,
    inStock: availabilityMode === 'ready',
    preOrder: availabilityMode === 'preorder',
    isUnavailable: availabilityMode === 'unavailable',
    featured: Boolean(row?.featured),
    isNew: Boolean(row?.isNew),
  };
};
const orderView = (row) => ({ ...row, items: asJsonArray(row?.items), isRead: Boolean(row?.isRead), accountOrderNumber: row?.accountOrderNumber || null });
const throwIfError = ({ data, error }) => { if (error) throw error; return data; };
async function apiRequest(path, method = 'GET', payload) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  let body;
  if (payload instanceof FormData) {
    body = payload;
  } else if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }
  const response = await fetch(path, { method, headers, body });
  let result = null;
  if (response.status !== 204) {
    try {
      result = await response.json();
    } catch {
      const contentType = response.headers.get('content-type') || 'unknown content type';
      throw new Error(`API request ${method} ${path} returned a non-JSON response (HTTP ${response.status}, ${contentType})`);
    }
  }
  if (!response.ok) throw new Error(`API request ${method} ${path} failed (HTTP ${response.status}): ${result?.error || 'تعذر إكمال الطلب'}`);
  return result;
}
const productFormData = (payload) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    if (key === 'productImages') {
      form.append('existingProductImages', JSON.stringify(value));
      continue;
    }
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return form;
};
const getFeaturedProductIds = (data) => {
  const fromCurrent = data?.featuredProductIds;
  const fromLegacy = data?.featuredProducts;
  if (Array.isArray(fromCurrent)) return fromCurrent.map(String);
  if (Array.isArray(fromLegacy)) return fromLegacy.map(String);
  return null;
};

export const defaultSettings = {
  storeName: '', tagline: '', logoUrl: '', heroTitle: '', heroDescription: '', heroImageUrl: '', heroButtonText: '',
  featuredSectionTitle: '', featuredProductIds: null, storeCategories: null, deliveryFee: 5000, taxRate: 0,
  instagramUrl: '', tiktokUrl: '', facebookUrl: '', whatsappUrl: '', aboutTitle: '', aboutText: '',
  policyTitle: '', policyText: '', taglineFont: 'cairo', taglineColor: '#1B1813', maintenanceMode: false,
};

const normalizeSettings = (data) => {
  const deliveryFee = Number(data?.deliveryFee);
  const taxRate = Number(data?.taxRate);
  return {
    ...defaultSettings,
    ...(data || {}),
    policyTitle: String(data?.policyTitle || '').trim() || defaultSettings.policyTitle,
    policyText: String(data?.policyText || '').trim() || defaultSettings.policyText,
    featuredSectionTitle: String(data?.featuredSectionTitle || '').trim() || defaultSettings.featuredSectionTitle,
    featuredProductIds: getFeaturedProductIds(data),
    storeCategories: Array.isArray(data?.storeCategories) ? data.storeCategories : null,
    deliveryFee: Number.isFinite(deliveryFee) && deliveryFee >= 0 ? deliveryFee : defaultSettings.deliveryFee,
    taxRate: Number.isFinite(taxRate) && taxRate >= 0 && taxRate <= 100 ? taxRate : 0,
    taglineFont: ['cairo', 'sans', 'serif'].includes(data?.taglineFont) ? data.taglineFont : defaultSettings.taglineFont,
    taglineColor: /^#[0-9a-fA-F]{6}$/.test(data?.taglineColor || '') ? data.taglineColor.toUpperCase() : defaultSettings.taglineColor,
    maintenanceMode: Boolean(data?.maintenanceMode),
  };
};

export async function getSiteSettings() {
  const data = throwIfError(await supabase.from('site_settings').select('*').order('id', { ascending: false }).limit(1).maybeSingle());
  return normalizeSettings(data);
}
export async function recordView(type, productId) {
  const viewType = type === 'product' ? 'product' : 'home';
  const payload = viewType === 'product' && productId != null ? { type: viewType, productId } : { type: viewType };
  return throwIfError(await supabase.from('page_views').insert(payload).select().single());
}
export async function listProducts() {
  const data = await apiRequest('/api/products');
  return asProductRows(data).map(productView);
}
export async function getProduct(id) {
  const data = await apiRequest(`/api/products/${encodeURIComponent(id)}`).catch((error) => {
    if (String(error?.message || '').includes('المنتج غير موجود')) return null;
    throw error;
  });
  return data && typeof data === 'object' ? productView(data) : null;
}
export async function getCart(userId) { const data = throwIfError(await supabase.from('account_carts').select('items').eq('accountId', userId).maybeSingle()); return asArray(data?.items); }
export async function saveCart(userId, items) { return throwIfError(await supabase.from('account_carts').upsert({ accountId: userId, items: asArray(items), updatedAt: new Date().toISOString() }, { onConflict: 'accountId' })); }
export async function validateDiscount(code) {
  return apiRequest(`/api/discounts/validate/${encodeURIComponent(String(code).trim().toUpperCase())}`);
}
export async function saveCoupon(userId, discountId) { return throwIfError(await supabase.from('account_coupons').upsert({ accountId: userId, discountId }, { onConflict: 'accountId,discountId' })); }
export async function createOrder(payload, userId) {
  return throwIfError(await supabase.rpc('create_order_with_stock', {
    p_account_id: userId,
    p_payload: payload,
  }));
}
export async function cancelOrder(orderId) {
  return throwIfError(await supabase.rpc('cancel_order_if_new', { p_order_id: orderId }));
}
export async function getAccountOrders() {
  const data = await apiRequest('/api/account/orders');
  return asArray(data).map(orderView);
}

export async function adminProducts() {
  const data = await apiRequest('/api/admin/products');
  return asProductRows(data).map((row) => ({
    ...productView(row),
    costPrice: Number(row.costPrice || 0),
    profit: Number((Number(row.price || 0) - Number(row.costPrice || 0)).toFixed(2)),
  }));
}
const safeImageExtensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const validateUploadImage = (file) => {
  const extension = safeImageExtensions[file?.type];
  if (!extension || file.size > 5 * 1024 * 1024) throw new Error('اختر صورة بصيغة مدعومة وحجم لا يتجاوز 5 ميغابايت');
  return extension;
};
const generatedProductCode = () => `PRD-${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
const productCodeColumn = (form, generateIfMissing = false) => {
  if (!Object.prototype.hasOwnProperty.call(form ?? {}, 'productCode') && !Object.prototype.hasOwnProperty.call(form ?? {}, 'product_code')) {
    return generateIfMissing ? { product_code: generatedProductCode() } : {};
  }
  const value = String(form?.productCode ?? form?.product_code ?? '').trim().toUpperCase();
  return { product_code: value || (generateIfMissing ? generatedProductCode() : null) };
};
async function uploadFiles(primaryImageFile, additionalImageFiles = []) {
  const urls = [];
  for (const file of [primaryImageFile, ...asArray(additionalImageFiles)].filter(Boolean)) {
    const extension = validateUploadImage(file);
    const path = `products/${crypto.randomUUID()}.${extension}`;
    throwIfError(await supabase.storage.from('uploads').upload(path, file, { contentType: file.type, upsert: false }));
    urls.push(supabase.storage.from('uploads').getPublicUrl(path).data.publicUrl);
  }
  return urls;
}
export async function uploadCategoryImage(file) {
  const extension = validateUploadImage(file);
  const path = `categories/${crypto.randomUUID()}.${extension}`;
  throwIfError(await supabase.storage.from('uploads').upload(path, file, { contentType: file.type, upsert: false }));
  return supabase.storage.from('uploads').getPublicUrl(path).data.publicUrl;
}
export async function moveProductsToCategory(currentCategory, nextCategory) { if (currentCategory === nextCategory) return; return throwIfError(await supabase.from('products').update({ category: nextCategory }).eq('category', currentCategory)); }
export async function createProduct(form, primaryFile, additionalFiles) {
  const productForm = form ?? {};
  const uploaded = await uploadFiles(primaryFile, additionalFiles);
  const images = [...asArray(productForm.productImages), ...uploaded];
  const availabilityMode = ['ready', 'preorder', 'unavailable'].includes(productForm.availabilityMode)
    ? (productForm.availabilityMode === 'ready' && Number(productForm.stockQuantity ?? 0) <= 0 ? 'unavailable' : productForm.availabilityMode)
    : (Number(productForm.stockQuantity ?? 0) <= 0 ? 'unavailable' : (productForm.inStock ? 'ready' : 'preorder'));
  const payload = {
    name: productForm.name,
    ...productCodeColumn(productForm, true),
    description: productForm.description,
    price: Number(productForm.price),
    costPrice: Number(productForm.costPrice || 0),
    discountType: productForm.discountType === 'amount' ? 'amount' : 'percentage',
    discountValue: Number(productForm.discountValue ?? productForm.discountPercentage ?? 0),
    discountPercentage: productForm.discountType === 'amount' ? 0 : Number(productForm.discountValue ?? productForm.discountPercentage ?? 0),
    availabilityMode,
    category: String(productForm.category || '').trim(),
    imageUrl: (primaryFile ? uploaded[0] : '') || productForm.imageUrl || images[0] || '',
    productImages: images ?? [],
    variants: asVariants(productForm.variants),
    stockQuantity: Math.max(0, Number(productForm.stockQuantity ?? 10)),
    inStock: productForm.availabilityMode === 'ready' && Number(productForm.stockQuantity ?? 0) > 0,
    featured: Boolean(productForm.featured),
    isNew: Boolean(productForm.isNew),
  };
  const data = await apiRequest('/api/admin/products', 'POST', productFormData({ ...payload, availabilityMode }));
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
    ...productCodeColumn(actualForm, true),
    availabilityMode: ['ready', 'preorder', 'unavailable'].includes(actualForm?.availabilityMode)
      ? (actualForm.availabilityMode === 'ready' && Number(actualForm.stockQuantity ?? 0) <= 0 ? 'unavailable' : actualForm.availabilityMode)
      : (Number(actualForm?.stockQuantity ?? 0) <= 0 ? 'unavailable' : (actualForm?.inStock ? 'ready' : 'preorder')),
    inStock: actualForm?.availabilityMode === 'ready' && Number(actualForm?.stockQuantity ?? 0) > 0,
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
  delete payload.productCode;

  // 5. تنفيذ التحديث في Supabase
  const data = await apiRequest(`/api/admin/products/${encodeURIComponent(productId)}`, 'PUT', productFormData(payload));
  return productView(data);
}
export async function deleteProduct(id) { return apiRequest(`/api/admin/products/${encodeURIComponent(id)}`, 'DELETE'); }
export async function listOrders() { return asArray(await apiRequest('/api/orders')).map(orderView); }
export async function updateOrder(id, updates) { return apiRequest(`/api/orders/${encodeURIComponent(id)}`, 'PATCH', updates); }
export async function unreadOrderCount() {
  const result = await apiRequest('/api/orders/unread-count');
  return Number(result?.count || 0);
}
export async function listDiscounts() { return asArray(await apiRequest('/api/discounts')); }
const discountPayload = (form) => {
  const type = form.type === 'fixed' ? 'fixed' : 'percentage';
  const value = Number(form.value);
  if (!Number.isFinite(value) || value < 0 || (type === 'percentage' && value > 100)) {
    throw new Error(type === 'percentage' ? 'يجب أن تكون نسبة الخصم بين 0 و100.' : 'أدخل مبلغ خصم صحيحاً.');
  }
  return { code: String(form.code).trim().toUpperCase(), type, value, active: form.active !== false };
};
export async function createDiscount(form) { return apiRequest('/api/discounts', 'POST', discountPayload(form)); }
export async function updateDiscount(id, form) { return apiRequest(`/api/discounts/${encodeURIComponent(id)}`, 'PUT', discountPayload(form)); }
export async function deleteDiscount(id) { return apiRequest(`/api/discounts/${encodeURIComponent(id)}`, 'DELETE'); }
export async function analytics() {
  const [{ count: homeViews }, { data: productViews, error: productViewsError }, orders] = await Promise.all([
    supabase.from('page_views').select('id', { count: 'exact', head: true }).eq('type', 'home'),
    supabase.from('page_views').select('productId').eq('type', 'product'),
    listOrders(),
  ]);
  if (productViewsError) throw productViewsError;
  const delivered = orders.filter((order) => order.status === 'delivered');
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const ordersForMonth = (start, end) => delivered.filter((order) => {
    const createdAt = new Date(order.createdAt);
    return createdAt >= start && createdAt < end;
  });
  const revenueForOrders = (monthOrders) => monthOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + Number(item.price || 0) * Number(item.quantity || 0), 0), 0);
  const profitForOrders = (monthOrders) => monthOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + (Number(item.price || 0) - Number(item.costPrice || 0)) * Number(item.quantity || 0), 0), 0);
  const currentMonthOrders = ordersForMonth(currentMonthStart, nextMonthStart);
  const currentRevenue = revenueForOrders(currentMonthOrders);
  const lastRevenue = revenueForOrders(ordersForMonth(lastMonthStart, currentMonthStart));
  const growth = lastRevenue === 0 ? (currentRevenue > 0 ? 100 : 0) : Number((((currentRevenue - lastRevenue) / lastRevenue) * 100).toFixed(2));
  return {
    homeViews: homeViews || 0,
    orderStats: { total: orders.length, new: orders.filter((order) => order.status === 'new').length, processing: orders.filter((order) => order.status === 'processing').length, delivered: delivered.length, cancelled: orders.filter((order) => order.status === 'cancelled').length },
    currentRevenue,
    lastRevenue,
    growth,
    totalProfit: profitForOrders(currentMonthOrders),
    bestSeller: getBestSeller(delivered),
    productStats: getProductAnalytics(productViews || [], delivered),
    totalLosses: 0,
  };
}
export async function accountCount() { const { count, error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }); if (error) throw error; return count || 0; }
export async function listAdmins() { const [admins, invites] = await Promise.all([supabase.from('profiles').select('id,identifier,createdAt,isOwner').eq('role', 'admin').order('createdAt'), supabase.from('admin_invites').select('identifier,createdAt').order('createdAt', { ascending: false })]); return { admins: asArray(throwIfError(admins)), invites: asArray(throwIfError(invites)) }; }
export async function inviteAdmin(identifier) { const normalized = String(identifier).trim().toLowerCase(); const profile = throwIfError(await supabase.from('profiles').select('id,role').eq('identifier', normalized).maybeSingle()); if (profile?.role === 'admin') throw new Error('هذا الحساب مشرف مسبقاً'); if (profile) return throwIfError(await supabase.from('profiles').update({ role: 'admin' }).eq('id', profile.id)); return throwIfError(await supabase.from('admin_invites').upsert({ identifier: normalized }, { onConflict: 'identifier' })); }
export async function removeAdmin(identifier) { const profile = throwIfError(await supabase.from('profiles').select('id,isOwner').eq('identifier', String(identifier).toLowerCase()).eq('role', 'admin').maybeSingle()); if (profile?.isOwner) throw new Error('لا يمكن حذف مالك المتجر'); if (profile) throwIfError(await supabase.from('profiles').update({ role: 'customer' }).eq('id', profile.id)); return throwIfError(await supabase.from('admin_invites').delete().eq('identifier', String(identifier).toLowerCase())); }
export async function createOwnerAccount(name, email, password) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) throw new Error('يجب تسجيل الدخول كمالك للمتجر');
  const response = await fetch('/api/admin/owners', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, email, password }),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('تعذر قراءة رد خادم إنشاء حساب المالك');
  }
  if (!response.ok) throw new Error(result?.error || 'تعذر إنشاء حساب المالك');
  return result;
}
export async function saveSiteSettings(settings) {
  const current = await getSiteSettings();
  const payload = { ...settings, id: undefined };
  if (Object.prototype.hasOwnProperty.call(current || {}, 'featuredProducts') && !Object.prototype.hasOwnProperty.call(payload, 'featuredProducts')) {
    payload.featuredProducts = payload.featuredProductIds ?? null;
    delete payload.featuredProductIds;
  }
  const query = current.id
    ? supabase.from('site_settings').update(payload).eq('id', current.id)
    : supabase.from('site_settings').insert(payload);
  const data = throwIfError(await query.select().single());
  return {
    ...defaultSettings,
    ...data,
    featuredProductIds: getFeaturedProductIds(data),
    storeCategories: Array.isArray(data?.storeCategories) ? data.storeCategories : null,
    deliveryFee: normalizeSettings(data).deliveryFee,
  };
}
export async function completeStoreSetup(setup, productImage) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) throw new Error('يجب تسجيل الدخول كمالك للمتجر');
  const form = new FormData();
  form.append('setup', JSON.stringify(setup));
  if (productImage) form.append('productImage', productImage);
  const response = await fetch('/api/admin/setup-store', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: form,
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('تعذر قراءة رد خادم إنشاء المتجر');
  }
  if (!response.ok) throw new Error(result?.error || 'تعذر إنشاء المتجر');
  return result;
}
async function resetSecurityRequest(path, body) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) throw new Error('يجب تسجيل الدخول كمالك للمتجر');
  const response = await fetch(`/api/admin/reset-security${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('تعذر قراءة رد خادم إعادة الضبط');
  }
  if (!response.ok) throw new Error(result?.error || 'تعذر تنفيذ عملية إعادة الضبط');
  return result;
}
export async function getResetSecurityStatus() { return resetSecurityRequest(''); }
export async function createResetSecurityPin(pin) { return resetSecurityRequest('', { pin }); }
export async function verifyResetSecurityPin(pin) { return resetSecurityRequest('/verify', { pin }); }
export async function confirmResetStore(resetToken) { return resetSecurityRequest('/confirm', { resetToken }); }