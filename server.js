import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;
const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabaseServer = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, callback) => {
      const extension = path.extname(file.originalname || '').toLowerCase();
      callback(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`);
    },
  }),
});
const productUpload = upload.fields([
  { name: 'primaryImage', maxCount: 1 },
  { name: 'productImages', maxCount: 10 },
]);

const getSession = (req) => req.supabaseSession;
const isAdminRequest = (req) => {
  return getSession(req)?.role === 'admin';
};
const isOwnerRequest = (req) => {
  const session = getSession(req);
  return session?.role === 'admin' && session?.isOwner === true;
};
const parseItems = (value) => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const defaultSiteSettings = {
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
  policyTitle: 'سياستنا',
  policyText: 'نراجع كل طلب ونتواصل معك لتأكيد التفاصيل قبل التجهيز.',
  maintenanceMode: false,
};

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.use(async (req, res, next) => {
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token || !supabaseServer) return next();

  try {
    const { data: { user }, error: userError } = await supabaseServer.auth.getUser(token);
    if (userError || !user) return next();
    const { data: profile } = await supabaseServer
      .from('profiles')
      .select('id, identifier, role, "isOwner", "displayName", "pictureUrl"')
      .eq('id', user.id)
      .maybeSingle();
    if (profile) {
      req.supabaseSession = {
        accountId: user.id,
        identifier: profile.identifier,
        role: profile.role,
        isOwner: profile.isOwner === true,
        displayName: profile.displayName || '',
        pictureUrl: profile.pictureUrl || '',
      };
    }
  } catch {
    // Unauthenticated requests are handled by the route-level authorization checks.
  }
  next();
});
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const normalizeSiteSettings = (row) => ({
    ...defaultSiteSettings,
    ...row,
    instagramUrl: row.instagramUrl || '',
    tiktokUrl: row.tiktokUrl || '',
    facebookUrl: row.facebookUrl || '',
    whatsappUrl: row.whatsappUrl || '',
    aboutTitle: row.aboutTitle || defaultSiteSettings.aboutTitle,
    aboutText: row.aboutText || '',
    policyTitle: row.policyTitle || defaultSiteSettings.policyTitle,
    policyText: row.policyText || defaultSiteSettings.policyText,
    maintenanceMode: Boolean(row.maintenanceMode),
});

const getSiteSettings = async () => {
  if (!supabaseServer) return { ...defaultSiteSettings };
  const { data, error } = await supabaseServer.from('site_settings').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (data) return normalizeSiteSettings(data);
  const { data: inserted, error: insertError } = await supabaseServer.from('site_settings').insert(defaultSiteSettings).select().single();
  if (insertError) throw insertError;
  return normalizeSiteSettings(inserted);
};

const getDiscountedPrice = (product) => {
  const price = Number(product?.price || 0);
  const discount = Number(product?.discountPercentage || 0);
  if (!discount) return Number(price.toFixed(2));
  return Number((price * (1 - discount / 100)).toFixed(2));
};

const getProductImages = (product) => {
  let images = [];
  if (Array.isArray(product?.productImages)) {
    images = product.productImages;
  } else {
    try {
      images = JSON.parse(product?.productImages || '[]');
    } catch {
      images = [];
    }
  }
  if (!Array.isArray(images)) images = [];
  const fallback = product?.imageUrl || '';
  return [...new Set([fallback, ...images].filter(Boolean))];
};

const uploadedImageUrl = (file) => file ? `/uploads/${file.filename}` : '';
const parseImageList = (value) => {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
};

const publicProductData = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  price: Number(row.price || 0),
  discountPercentage: Number(row.discountPercentage || 0),
  discountedPrice: getDiscountedPrice(row),
  imageUrl: row.imageUrl || '',
  productImages: getProductImages(row),
  category: row.category || 'عام',
  stockQuantity: Number(row.stockQuantity ?? 0),
  preOrder: !Boolean(row.inStock),
  inStock: Boolean(row.inStock),
  featured: Boolean(row.featured),
  isNew: Boolean(row.isNew),
});

const adminProductData = (row) => ({
  ...publicProductData(row),
  costPrice: Number(row.costPrice || 0),
  profit: Number((Number(row.price || 0) - Number(row.costPrice || 0)).toFixed(2)),
});

const requireSupabase = (res) => {
  if (supabaseServer) return true;
  res.status(503).json({ error: 'Supabase غير مهيأ على الخادم' });
  return false;
};

const normalizeProductRow = (row) => ({
  ...row,
  productImages: Array.isArray(row?.productImages) ? row.productImages : parseImageList(row?.productImages),
});

const normalizeOrderRow = (row) => ({
  ...row,
  items: Array.isArray(row?.items) ? row.items : parseItems(row?.items),
  isRead: Boolean(row?.isRead),
  accountOrderNumber: row?.accountOrderNumber || null,
});

app.get('/api/admin/admins', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;
  const [{ data: admins, error: adminsError }, { data: invites, error: invitesError }] = await Promise.all([
    supabaseServer.from('profiles').select('id, identifier, "createdAt", "isOwner"').eq('role', 'admin').order('createdAt'),
    supabaseServer.from('admin_invites').select('identifier, "createdAt"').order('createdAt', { ascending: false }),
  ]);
  if (adminsError || invitesError) return res.status(500).json({ error: (adminsError || invitesError).message });
  res.json({ admins, invites });
});

app.post('/api/admin/admins', async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'فقط مالك المتجر يستطيع إدارة المشرفين' });
  if (!requireSupabase(res)) return;
  const identifier = String(req.body.identifier || '').trim().toLowerCase();
  if (!identifier) return res.status(400).json({ error: 'أدخل البريد الإلكتروني' });
  const { data: account, error: accountError } = await supabaseServer.from('profiles').select('id, role').eq('identifier', identifier).maybeSingle();
  if (accountError) return res.status(500).json({ error: accountError.message });
  if (account?.role === 'admin') return res.status(409).json({ error: 'هذا الحساب مشرف مسبقاً' });
  if (account) {
    const { error } = await supabaseServer.from('profiles').update({ role: 'admin' }).eq('id', account.id);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ identifier, role: 'admin', promoted: true });
  }
  const { error: inviteError } = await supabaseServer.from('admin_invites').upsert({ identifier }, { onConflict: 'identifier' });
  if (inviteError) return res.status(400).json({ error: inviteError.message });
  res.status(201).json({ identifier, role: 'admin', invited: true });
});

app.delete('/api/admin/admins/:identifier', async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'فقط مالك المتجر يستطيع إدارة المشرفين' });
  if (!requireSupabase(res)) return;
  const identifier = String(req.params.identifier || '').toLowerCase();
  const { data: account, error: accountError } = await supabaseServer.from('profiles').select('id, "isOwner"').eq('identifier', identifier).eq('role', 'admin').maybeSingle();
  if (accountError) return res.status(500).json({ error: accountError.message });
  if (account?.isOwner) return res.status(400).json({ error: 'لا يمكن حذف مالك المتجر' });
  if (account) {
    const { error } = await supabaseServer.from('profiles').update({ role: 'customer' }).eq('id', account.id);
    if (error) return res.status(400).json({ error: error.message });
  }
  const { error: inviteError } = await supabaseServer.from('admin_invites').delete().eq('identifier', identifier);
  if (inviteError) return res.status(400).json({ error: inviteError.message });
  res.status(204).end();
});

app.post('/api/admin/transfer-ownership', async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'فقط مالك المتجر يمكنه تحويل الملكية' });
  if (!requireSupabase(res)) return;

  const session = getSession(req);
  const currentIdentifier = String(session?.identifier || '').trim().toLowerCase();
  const newOwner = String(req.body.newOwner || '').trim().toLowerCase();

  if (!newOwner || newOwner === currentIdentifier) {
    return res.status(400).json({ error: 'اختر حساباً آخر غير حساب المدير الحالي' });
  }

  const { data: targetAccount, error: targetError } = await supabaseServer.from('profiles').select('id, role').eq('identifier', newOwner).maybeSingle();
  if (targetError) return res.status(500).json({ error: targetError.message });
  if (!targetAccount) {
    const { error } = await supabaseServer.from('admin_invites').upsert({ identifier: newOwner }, { onConflict: 'identifier' });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(202).json({ message: 'تم حفظ الحساب كدعوة، وسيصبح مديراً عند التسجيل' });
  }

  const { error: targetUpdateError } = await supabaseServer.from('profiles').update({ role: 'admin', isOwner: true }).eq('id', targetAccount.id);
  const { error: currentUpdateError } = await supabaseServer.from('profiles').update({ role: 'admin', isOwner: false }).eq('id', session.accountId);
  if (targetUpdateError || currentUpdateError) return res.status(400).json({ error: (targetUpdateError || currentUpdateError).message });

  res.json({ message: 'تم تحويل الملكية بنجاح', newOwner });
});

app.get('/api/account/cart', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'يجب تسجيل الدخول لحفظ السلة' });
  if (!requireSupabase(res)) return;
  const { data, error } = await supabaseServer.from('account_carts').select('items').eq('accountId', session.accountId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: Array.isArray(data?.items) ? data.items : [] });
});

app.put('/api/account/cart', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'يجب تسجيل الدخول لحفظ السلة' });
  if (!requireSupabase(res)) return;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const { error } = await supabaseServer.from('account_carts').upsert({
    accountId: session.accountId,
    items,
    updatedAt: new Date().toISOString(),
  }, { onConflict: 'accountId' });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, items });
});

app.get('/api/account/coupons', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  if (!requireSupabase(res)) return;
  const { data, error } = await supabaseServer.from('account_coupons').select('savedAt, discounts(*)').eq('accountId', session.accountId).order('savedAt', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map((row) => ({ ...row.discounts, active: Boolean(row.discounts?.active), savedAt: row.savedAt })));
});

app.post('/api/account/coupons/:code', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  if (!requireSupabase(res)) return;
  const { data: coupon, error: couponError } = await supabaseServer.from('discounts').select('*').eq('code', String(req.params.code).toUpperCase()).eq('active', true).maybeSingle();
  if (couponError) return res.status(500).json({ error: couponError.message });
  if (!coupon) return res.status(404).json({ error: 'كود الخصم غير صالح أو غير فعال' });
  const { error: saveError } = await supabaseServer.from('account_coupons').upsert({ accountId: session.accountId, discountId: coupon.id }, { onConflict: 'accountId,discountId' });
  if (saveError) return res.status(400).json({ error: saveError.message });
  res.status(201).json({ ...coupon, active: Boolean(coupon.active), saved: true });
});

app.get('/api/site-settings', async (req, res) => {
  try {
    res.json(await getSiteSettings());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/analytics/view', async (req, res) => {
  if (!requireSupabase(res)) return;
  const type = req.body?.type === 'product' ? 'product' : 'home';
  const { error } = await supabaseServer.from('page_views').insert({ type });
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ok: true, type });
});

app.get('/api/products', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabaseServer
    .from('products')
    .select('*')
    .order('featured', { ascending: false })
    .order('isNew', { ascending: false })
    .order('discountPercentage', { ascending: false })
    .order('id', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map((row) => publicProductData(normalizeProductRow(row))));
});

app.get('/api/products/:id', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabaseServer.from('products').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'المنتج غير موجود' });
  res.json(publicProductData(normalizeProductRow(data)));
});

app.get('/api/admin/products', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;
  const { data, error } = await supabaseServer.from('products').select('*').order('id', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map((row) => adminProductData(normalizeProductRow(row))));
});

app.post('/api/admin/products', productUpload, async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;
  const { name, description, price, costPrice, discountPercentage, category, stockQuantity, inStock, imageUrl, featured, isNew } = req.body;
  if (!name || !description || !price) return res.status(400).json({ error: 'يرجى إكمال بيانات المنتج' });

  const uploadedImages = (req.files?.productImages || []).map(uploadedImageUrl);
  const images = [...parseImageList(req.body.existingProductImages), ...uploadedImages];
  const uploadedPrimaryImage = uploadedImageUrl(req.files?.primaryImage?.[0]);
  const primaryImage = uploadedPrimaryImage || imageUrl || images[0] || '';
  const { data, error } = await supabaseServer.from('products').insert({
    name,
    description,
    price: Number(price),
    costPrice: Number(costPrice || 0),
    discountPercentage: Number(discountPercentage || 0),
    imageUrl: primaryImage,
    productImages: images,
    category: category || 'عام',
    stockQuantity: Math.max(0, Number(stockQuantity ?? 10)),
    inStock: !(inStock === false || inStock === 'false'),
    featured: featured === true || featured === 'true',
    isNew: isNew === true || isNew === 'true',
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(adminProductData(normalizeProductRow(data)));
});

app.put('/api/admin/products/:id', productUpload, async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;
  const { data: existing, error: existingError } = await supabaseServer.from('products').select('*').eq('id', req.params.id).maybeSingle();
  if (existingError) return res.status(500).json({ error: existingError.message });
  if (!existing) return res.status(404).json({ error: 'المنتج غير موجود' });
  const existingProduct = normalizeProductRow(existing);
  const body = {
    name: req.body.name ?? existingProduct.name,
    description: req.body.description ?? existingProduct.description,
    price: Number(req.body.price ?? existingProduct.price),
    costPrice: Number(req.body.costPrice ?? existingProduct.costPrice ?? 0),
    discountPercentage: Number(req.body.discountPercentage ?? existingProduct.discountPercentage ?? 0),
    category: req.body.category ?? existingProduct.category,
    inStock: req.body.inStock === false || req.body.inStock === 'false' ? false : (req.body.inStock === true || req.body.inStock === 'true' ? true : existingProduct.inStock),
    imageUrl: req.body.imageUrl ?? existingProduct.imageUrl,
    productImages: parseImageList(req.body.existingProductImages).concat((req.files?.productImages || []).map(uploadedImageUrl)),
    stockQuantity: Math.max(0, Number(req.body.stockQuantity ?? existingProduct.stockQuantity ?? 10)),
    featured: req.body.featured === true || req.body.featured === 'true' ? true : (req.body.featured === false || req.body.featured === 'false' ? false : existingProduct.featured),
    isNew: req.body.isNew === true || req.body.isNew === 'true' ? true : (req.body.isNew === false || req.body.isNew === 'false' ? false : existingProduct.isNew),
  };

  const images = body.productImages;
  const primaryImage = uploadedImageUrl(req.files?.primaryImage?.[0]) || body.imageUrl || images[0] || '';
  const { data, error } = await supabaseServer.from('products').update({
    ...body,
    imageUrl: primaryImage,
    productImages: images,
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(adminProductData(normalizeProductRow(data)));
});

app.delete('/api/admin/products/:id', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;
  const { error } = await supabaseServer.from('products').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).end();
});

app.get('/api/discounts', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;
  const { data, error } = await supabaseServer.from('discounts').select('*').order('id', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map((discount) => ({ ...discount, active: Boolean(discount.active) })));
});
app.post('/api/discounts', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;
  const { data, error } = await supabaseServer.from('discounts').insert({ code: String(req.body.code).toUpperCase(), type: req.body.type, value: Number(req.body.value), active: req.body.active !== false }).select().single();
  if (error) return res.status(400).json({ error: error.code === '23505' ? 'كود الخصم مستخدم مسبقاً' : error.message });
  res.status(201).json({ ...data, active: Boolean(data.active) });
});
app.put('/api/discounts/:id', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;
  const { data, error } = await supabaseServer.from('discounts').update({ code: String(req.body.code).toUpperCase(), type: req.body.type, value: Number(req.body.value), active: Boolean(req.body.active) }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ...data, active: Boolean(data.active) });
});
app.delete('/api/discounts/:id', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;
  const { error } = await supabaseServer.from('discounts').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).end();
});
app.get('/api/discounts/validate/:code', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabaseServer.from('discounts').select('*').eq('code', String(req.params.code).toUpperCase()).eq('active', true).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ? { ...data, active: Boolean(data.active) } : null);
});

app.get('/api/orders', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;
  const { data, error } = await supabaseServer.from('orders').select('*').order('createdAt', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(normalizeOrderRow));
});
app.get('/api/orders/unread-count', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;
  const { count, error } = await supabaseServer.from('orders').select('id', { count: 'exact', head: true }).eq('isRead', false);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ count: count || 0 });
});
app.post('/api/orders', async (req, res) => {
  let siteSettings;
  try {
    siteSettings = await getSiteSettings();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
  if (siteSettings.maintenanceMode) return res.status(503).json({ error: 'الطلبات متوقفة مؤقتاً بسبب الصيانة' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'يجب تسجيل الدخول لإرسال الطلب' });
  if (!requireSupabase(res)) return;
  const b = req.body;
  if (!b.customerName || !b.province || !b.address || !b.nearestLandmark || !b.phoneNumber || !b.items?.length) {
    return res.status(400).json({ error: 'يرجى إكمال الحقول المطلوبة' });
  }

  const productIds = b.items.map((item) => item.productId);
  const { data: products, error: productsError } = await supabaseServer.from('products').select('id, costPrice, discountPercentage').in('id', productIds);
  if (productsError) return res.status(500).json({ error: productsError.message });
  const productMap = new Map((products || []).map((product) => [String(product.id), product]));
  const enrichedItems = b.items.map((item) => {
    const product = productMap.get(String(item.productId));
    return {
      productId: item.productId,
      name: item.name,
      price: Number(item.price || 0),
      quantity: Number(item.quantity || 0),
      costPrice: Number(product?.costPrice || 0),
      discountPercentage: Number(product?.discountPercentage || 0),
    };
  });

  const { data: latestOrder, error: latestOrderError } = await supabaseServer.from('orders').select('accountOrderNumber').eq('accountId', session.accountId).order('accountOrderNumber', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (latestOrderError) return res.status(500).json({ error: latestOrderError.message });
  const accountOrderNumber = Number(latestOrder?.accountOrderNumber || 0) + 1;
  const { data: createdOrder, error: orderError } = await supabaseServer.from('orders').insert({
    items: enrichedItems,
    customerName: b.customerName,
    province: b.province,
    address: b.address,
    nearestLandmark: b.nearestLandmark,
    phoneNumber: b.phoneNumber,
    subtotal: Number(b.subtotal || 0),
    discountCode: b.discountCode || '',
    discountAmount: Number(b.discountAmount || 0),
    deliveryFee: Number(b.deliveryFee || 0),
    finalTotal: Number(b.finalTotal || 0),
    accountId: session.accountId,
    accountOrderNumber,
    status: 'processing',
    createdAt: new Date().toISOString(),
  }).select('id').single();
  if (orderError) return res.status(400).json({ error: orderError.message });
  res.status(201).json({ id: createdOrder.id });
});

app.get('/api/account/orders', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  if (!requireSupabase(res)) return;
  const { data: orders, error } = await supabaseServer.from('orders').select('*').eq('accountId', session.accountId).order('createdAt', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const discountCodes = [...new Set((orders || []).map((order) => order.discountCode).filter(Boolean))];
  const { data: discounts, error: discountsError } = discountCodes.length
    ? await supabaseServer.from('discounts').select('code, type, value').in('code', discountCodes)
    : { data: [], error: null };
  if (discountsError) return res.status(500).json({ error: discountsError.message });
  const discountMap = new Map((discounts || []).map((discount) => [discount.code, discount]));
  res.json((orders || []).map((order) => {
    const normalized = normalizeOrderRow(order);
    const discount = discountMap.get(order.discountCode);
    return { ...normalized, discountType: discount?.type || null, discountValue: discount?.value || 0 };
  }));
});

app.patch('/api/orders/:id', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;
  const updates = {};
  if (req.body.status) updates.status = req.body.status;
  if (req.body.isRead !== undefined) updates.isRead = Boolean(req.body.isRead);
  if (!Object.keys(updates).length) return res.json({ ok: true });
  const { error } = await supabaseServer.from('orders').update(updates).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

app.get('/api/admin/analytics', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;

  const [{ count: homeViews, error: homeViewsError }, { count: productViews, error: productViewsError }, { data: orderRows, error: ordersError }] = await Promise.all([
    supabaseServer.from('page_views').select('id', { count: 'exact', head: true }).eq('type', 'home'),
    supabaseServer.from('page_views').select('id', { count: 'exact', head: true }).eq('type', 'product'),
    supabaseServer.from('orders').select('*'),
  ]);
  if (homeViewsError || productViewsError || ordersError) return res.status(500).json({ error: (homeViewsError || productViewsError || ordersError).message });
  const orders = (orderRows || []).map(normalizeOrderRow);
  const deliveredOrders = orders.filter((order) => order.status === 'delivered');
  const cancelledOrders = orders.filter((order) => order.status === 'cancelled');

  const currentDate = new Date();
  const currentMonthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const lastMonthStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  const currentMonthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  const lastMonthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);

  const revenueForMonth = (start, end) => deliveredOrders
    .filter((order) => new Date(order.createdAt) >= start && new Date(order.createdAt) < end)
    .reduce((sum, order) => sum + Number(order.finalTotal || 0), 0);

  const currentRevenue = revenueForMonth(currentMonthStart, currentMonthEnd);
  const lastRevenue = revenueForMonth(lastMonthStart, lastMonthEnd);
  const growth = lastRevenue === 0 ? (currentRevenue > 0 ? 100 : 0) : Number((((currentRevenue - lastRevenue) / lastRevenue) * 100).toFixed(2));
  const orderStats = {
    total: orders.length,
    new: orders.filter((order) => order.status === 'new').length,
    processing: orders.filter((order) => order.status === 'processing').length,
    delivered: deliveredOrders.length,
    cancelled: cancelledOrders.length,
  };

  const totalProfit = deliveredOrders.reduce((sum, order) => {
    const items = parseItems(order.items);
    const orderProfit = items.reduce((itemSum, item) => {
      const unitProfit = Number(item.price || 0) - Number(item.costPrice || 0);
      return itemSum + unitProfit * Number(item.quantity || 0);
    }, 0);
    return sum + orderProfit;
  }, 0);

  res.json({
    totalViews: (homeViews || 0) + (productViews || 0),
    homeViews,
    productViews,
    orderStats,
    currentRevenue,
    lastRevenue,
    growth,
    totalProfit,
    totalLosses: 0,
  });
});

app.get('/api/admin/site-settings', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  try {
    res.json(await getSiteSettings());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/reset-store', async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'فقط مالك المتجر يستطيع إعادة ضبطه' });
  if (!requireSupabase(res)) return;

  const resetOperations = await Promise.all([
    supabaseServer.from('account_coupons').delete().neq('discountId', 0),
    supabaseServer.from('account_carts').delete().neq('accountId', '00000000-0000-0000-0000-000000000000'),
    supabaseServer.from('orders').delete().neq('id', 0),
    supabaseServer.from('products').delete().neq('id', 0),
    supabaseServer.from('discounts').delete().neq('id', 0),
    supabaseServer.from('page_views').delete().neq('id', 0),
    supabaseServer.from('admin_invites').delete().neq('identifier', ''),
    supabaseServer.from('site_settings').delete().neq('id', 0),
  ]);
  const resetError = resetOperations.find((result) => result.error)?.error;
  if (resetError) return res.status(500).json({ error: resetError.message });

  const [{ error: settingsError }, { error: defaultDiscountError }] = await Promise.all([
    supabaseServer.from('site_settings').insert(defaultSiteSettings),
    supabaseServer.from('discounts').insert({ code: 'NASAQ10', type: 'percentage', value: 10, active: true }),
  ]);
  if (settingsError || defaultDiscountError) return res.status(500).json({ error: (settingsError || defaultDiscountError).message });

  res.json({ ok: true, message: 'تمت إعادة ضبط المتجر إلى الحالة الافتراضية' });
});

app.post('/api/admin/site-settings', upload.fields([{ name: 'logoImage', maxCount: 1 }, { name: 'heroImage', maxCount: 1 }]), async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'فقط مالك المتجر يستطيع تعديل الإعدادات' });
  if (!requireSupabase(res)) return;
  let previous;
  try {
    previous = await getSiteSettings();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
  const logoUrl = req.files?.logoImage?.[0] ? `/uploads/${req.files.logoImage[0].filename}` : (req.body.logoUrl || previous.logoUrl || '');
  const heroImageUrl = req.files?.heroImage?.[0] ? `/uploads/${req.files.heroImage[0].filename}` : (req.body.heroImageUrl || previous.heroImageUrl || '');

  const settings = {
    storeName: req.body.storeName || previous.storeName,
    tagline: req.body.tagline || previous.tagline,
    logoUrl,
    heroTitle: req.body.heroTitle || previous.heroTitle,
    heroDescription: req.body.heroDescription || previous.heroDescription,
    heroImageUrl,
    heroButtonText: req.body.heroButtonText || previous.heroButtonText,
    instagramUrl: req.body.instagramUrl !== undefined ? String(req.body.instagramUrl).trim() : (previous.instagramUrl || ''),
    tiktokUrl: req.body.tiktokUrl !== undefined ? String(req.body.tiktokUrl).trim() : (previous.tiktokUrl || ''),
    facebookUrl: req.body.facebookUrl !== undefined ? String(req.body.facebookUrl).trim() : (previous.facebookUrl || ''),
    whatsappUrl: req.body.whatsappUrl !== undefined ? String(req.body.whatsappUrl).trim() : (previous.whatsappUrl || ''),
    aboutTitle: req.body.aboutTitle !== undefined ? String(req.body.aboutTitle).trim() : (previous.aboutTitle || defaultSiteSettings.aboutTitle),
    aboutText: req.body.aboutText !== undefined ? String(req.body.aboutText).trim() : (previous.aboutText || ''),
    policyTitle: req.body.policyTitle !== undefined ? String(req.body.policyTitle).trim() : (previous.policyTitle || defaultSiteSettings.policyTitle),
    policyText: req.body.policyText !== undefined ? String(req.body.policyText).trim() : (previous.policyText || defaultSiteSettings.policyText),
    maintenanceMode: req.body.maintenanceMode === 'true' || req.body.maintenanceMode === true,
  };

  const { data: existing } = await supabaseServer.from('site_settings').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
  const { error } = existing
    ? await supabaseServer.from('site_settings').update(settings).eq('id', existing.id)
    : await supabaseServer.from('site_settings').insert(settings);
  if (error) return res.status(400).json({ error: error.message });

  res.json({ ...defaultSiteSettings, ...settings, maintenanceMode: Boolean(settings.maintenanceMode) });
});

app.listen(port, () => console.log(`الخادم يعمل على http://localhost:${port}`));
