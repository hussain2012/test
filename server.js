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
const generateProductCode = () => `PRD-${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
const imageExtensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabaseServer = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const uploadStorage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${imageExtensions[file.mimetype] || '.bin'}`),
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024, fieldSize: 1024 * 1024, fields: 100, files: 10 },
  fileFilter: (req, file, callback) => callback(
    imageExtensions[file.mimetype] ? null : new Error('نوع صورة المنتج غير مدعوم'),
    Boolean(imageExtensions[file.mimetype]),
  ),
});
const setupStoreUpload = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024, fieldSize: 1024 * 1024, fields: 1, files: 1 },
  fileFilter: (req, file, callback) => callback(
    ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype) ? null : new Error('نوع صورة المنتج غير مدعوم'),
    ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype),
  ),
}).single('productImage');
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
const securityPinHash = async (pin, salt) => {
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await globalThis.crypto.subtle.deriveBits({
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
const hashResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const parseItems = (value) => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
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

const defaultSiteSettings = {
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
  policyTitle: '',
  policyText: '',
  maintenanceMode: false,
  taxRate: 0,
};

const allowedOrigins = new Set(String(process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(',').map((origin) => origin.trim()).filter(Boolean));
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '1mb' }));
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
    taglineFont: ['cairo', 'sans', 'serif'].includes(row.taglineFont) ? row.taglineFont : defaultSiteSettings.taglineFont,
    taglineColor: /^#[0-9a-fA-F]{6}$/.test(row.taglineColor || '') ? row.taglineColor.toUpperCase() : defaultSiteSettings.taglineColor,
    instagramUrl: row.instagramUrl || '',
    tiktokUrl: row.tiktokUrl || '',
    facebookUrl: row.facebookUrl || '',
    whatsappUrl: row.whatsappUrl || '',
    aboutTitle: row.aboutTitle || defaultSiteSettings.aboutTitle,
    aboutText: row.aboutText || '',
    policyTitle: row.policyTitle || defaultSiteSettings.policyTitle,
    policyText: row.policyText || defaultSiteSettings.policyText,
    maintenanceMode: Boolean(row.maintenanceMode),
    taxRate: Number.isFinite(Number(row.taxRate)) ? Math.min(100, Math.max(0, Number(row.taxRate))) : 0,
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
const publicDiscountData = (row) => row ? ({
  id: row.id,
  code: row.code,
  type: row.type,
  value: Number(row.value),
  active: Boolean(row.active),
}) : null;

const publicProductData = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  productCode: String(row?.product_code ?? row?.productCode ?? '').trim().toUpperCase(),
  price: Number(row.price || 0),
  discountType: row.discountType === 'amount' ? 'amount' : 'percentage',
  discountValue: Number(row.discountValue ?? row.discountPercentage ?? 0),
  discountPercentage: row.discountType === 'amount' ? 0 : Number(row.discountValue ?? row.discountPercentage ?? 0),
  discountedPrice: getDiscountedPrice(row),
  imageUrl: row.imageUrl || '',
  productImages: getProductImages(row),
    variants: Array.isArray(row.variants) ? row.variants : parseItems(row.variants),
  category: String(row.category || '').trim(),
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
  productCode: String(row?.product_code ?? row?.productCode ?? '').trim().toUpperCase(),
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

app.post('/api/admin/owners', async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'فقط مالك المتجر يستطيع إنشاء حساب مالك جديد' });
  if (!requireSupabase(res)) return;

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!name || name.length > 120) {
    return res.status(400).json({ error: 'أدخل الاسم الكريم بما لا يزيد عن 120 حرفاً' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'أدخل بريداً إلكترونياً صحيحاً' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل وبحد أقصى 128 حرفاً' });
  }

  let createdOwnerId = null;
  const removeCreatedOwner = async () => {
    if (!createdOwnerId) return '';
    try {
      const { error } = await supabaseServer.auth.admin.deleteUser(createdOwnerId);
      return error?.message || '';
    } catch (error) {
      return error?.message || 'تعذر حذف الحساب الجديد';
    }
  };

  try {
    const { data, error } = await supabaseServer.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, displayName: name },
    });
    if (error) {
      const alreadyExists = /already|registered|exists/i.test(error.message);
      return res.status(alreadyExists ? 409 : 400).json({
        error: alreadyExists ? 'هذا البريد الإلكتروني مستخدم مسبقاً' : error.message,
      });
    }
    if (!data.user) return res.status(500).json({ error: 'لم يتمكن الخادم من إنشاء حساب المالك' });
    createdOwnerId = data.user.id;

    const { data: promotedOwner, error: promoteError } = await supabaseServer
      .from('profiles')
      .update({ role: 'admin', isOwner: true, displayName: name })
      .eq('id', createdOwnerId)
      .select('id')
      .maybeSingle();
    if (promoteError || !promotedOwner) {
      const cleanupError = await removeCreatedOwner();
      const message = promoteError?.message || 'تعذر إعداد صلاحيات حساب المالك الجديد';
      return res.status(500).json({
        error: cleanupError ? `${message}؛ وتعذر حذف الحساب الجديد: ${cleanupError}` : message,
      });
    }

    const { data: previousOwner, error: transferError } = await supabaseServer
      .from('profiles')
      .update({ isOwner: false })
      .eq('id', getSession(req).accountId)
      .eq('isOwner', true)
      .select('id')
      .maybeSingle();
    if (transferError || !previousOwner) {
      const cleanupError = await removeCreatedOwner();
      const message = transferError?.message || 'تعذر نقل الملكية من الحساب الحالي';
      return res.status(500).json({
        error: cleanupError ? `${message}؛ وتعذر حذف الحساب الجديد: ${cleanupError}` : message,
      });
    }

    res.status(201).json({ ok: true, identifier: email });
  } catch (error) {
    const cleanupError = await removeCreatedOwner();
    const message = error?.message || 'تعذر إنشاء حساب المالك';
    return res.status(500).json({
      error: cleanupError ? `${message}؛ وتعذر حذف الحساب الجديد: ${cleanupError}` : message,
    });
  }
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
  res.json((data || []).map((row) => ({ ...publicDiscountData(row.discounts), savedAt: row.savedAt })));
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
  res.status(201).json({ ...publicDiscountData(coupon), saved: true });
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
  const payload = type === 'product' && req.body?.productId != null ? { type, productId: req.body.productId } : { type };
  const { error } = await supabaseServer.from('page_views').insert(payload);
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
  if (!name || !description || !Number.isFinite(Number(price)) || Number(price) <= 0) return res.status(400).json({ error: 'يرجى إدخال سعر صحيح وإكمال بيانات المنتج' });

  const uploadedImages = (req.files?.productImages ?? []).map(uploadedImageUrl);
  const images = [...parseImageList(req.body?.existingProductImages), ...uploadedImages];
  const uploadedPrimaryImage = uploadedImageUrl(req.files?.primaryImage?.[0]);
  const primaryImage = uploadedPrimaryImage || imageUrl || images[0] || '';
  const { data, error } = await supabaseServer.from('products').insert({
    name,
    description,
    price: Number(price),
    costPrice: Number(costPrice || 0),
    discountType: req.body.discountType === 'amount' ? 'amount' : 'percentage',
    discountValue: Number(req.body.discountValue ?? discountPercentage ?? 0),
    discountPercentage: Number(discountPercentage || 0),
    availabilityMode: ['ready', 'preorder', 'unavailable'].includes(req.body.availabilityMode) ? req.body.availabilityMode : (Number(stockQuantity ?? 10) > 0 ? 'ready' : 'unavailable'),
    variants: parseItems(req.body.variants),
    product_code: generateProductCode(),
    imageUrl: primaryImage,
    productImages: images ?? [],
    category: String(category || '').trim(),
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
    discountType: req.body.discountType === 'amount' ? 'amount' : (req.body.discountType || existingProduct.discountType || 'percentage'),
    discountValue: Number(req.body.discountValue ?? req.body.discountPercentage ?? existingProduct.discountValue ?? existingProduct.discountPercentage ?? 0),
    discountPercentage: Number(req.body.discountPercentage ?? existingProduct.discountPercentage ?? 0),
    availabilityMode: ['ready', 'preorder', 'unavailable'].includes(req.body.availabilityMode) ? req.body.availabilityMode : existingProduct.availabilityMode,
    variants: req.body.variants !== undefined ? parseItems(req.body.variants) : existingProduct.variants,
    ...((req.body.productCode !== undefined || req.body.product_code !== undefined)
      ? { product_code: String(req.body.productCode ?? req.body.product_code ?? '').trim().toUpperCase() || null }
      : {}),
    category: req.body.category ?? existingProduct.category,
    inStock: req.body.inStock === false || req.body.inStock === 'false' ? false : (req.body.inStock === true || req.body.inStock === 'true' ? true : existingProduct.inStock),
    imageUrl: req.body.imageUrl ?? existingProduct.imageUrl,
    productImages: parseImageList(req.body?.existingProductImages).concat((req.files?.productImages ?? []).map(uploadedImageUrl)),
    stockQuantity: Math.max(0, Number(req.body.stockQuantity ?? existingProduct.stockQuantity ?? 10)),
    featured: req.body.featured === true || req.body.featured === 'true' ? true : (req.body.featured === false || req.body.featured === 'false' ? false : existingProduct.featured),
    isNew: req.body.isNew === true || req.body.isNew === 'true' ? true : (req.body.isNew === false || req.body.isNew === 'false' ? false : existingProduct.isNew),
  };

  const images = Array.isArray(body?.productImages) ? body.productImages : [];
  const primaryImage = uploadedImageUrl(req.files?.primaryImage?.[0]) || body.imageUrl || images[0] || '';
  const { data, error } = await supabaseServer.from('products').update({
    ...body,
    imageUrl: primaryImage,
    productImages: images ?? [],
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
  res.json(publicDiscountData(data));
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
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'يجب تسجيل الدخول لإرسال الطلب' });
  if (!requireSupabase(res)) return;
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const { data: accountOrderNumber, error: orderError } = await supabaseServer.rpc('create_order_with_stock', {
    p_account_id: session.accountId,
    p_payload: payload,
  });
  if (orderError) return res.status(400).json({ error: orderError.message });
  const { data: createdOrder, error: lookupError } = await supabaseServer.from('orders')
    .select('id, accountOrderNumber')
    .eq('accountId', session.accountId)
    .eq('requestKey', String(payload.requestId || ''))
    .maybeSingle();
  if (lookupError || !createdOrder) return res.status(500).json({ error: lookupError?.message || 'تعذر استرجاع الطلب بعد إنشائه' });
  res.status(201).json({ id: createdOrder.id, accountOrderNumber: createdOrder.accountOrderNumber ?? accountOrderNumber });
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
    return {
      ...normalized,
      items: normalized.items.map((item) => {
        const { costPrice, ...safeItem } = item || {};
        return safeItem;
      }),
      discountType: discount?.type || null,
      discountValue: discount?.value || 0,
    };
  }));
});

app.patch('/api/orders/:id', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (!requireSupabase(res)) return;
  if (req.body.status !== undefined) {
    if (!['processing', 'delivered', 'cancelled'].includes(req.body.status)) {
      return res.status(400).json({ error: 'حالة الطلب غير صحيحة' });
    }
    const { error } = await supabaseServer.rpc('update_order_status', {
      p_order_id: req.params.id,
      p_status: req.body.status,
      p_actor_id: getSession(req).accountId,
    });
    if (error) return res.status(400).json({ error: error.message });
  }
  if (req.body.isRead !== undefined) {
    const { error } = await supabaseServer.from('orders').update({ isRead: Boolean(req.body.isRead) }).eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
  }
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

  const ordersForMonth = (start, end) => deliveredOrders
    .filter((order) => new Date(order.createdAt) >= start && new Date(order.createdAt) < end);
  const revenueForMonth = (start, end) => ordersForMonth(start, end)
    .reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + Number(item.price || 0) * Number(item.quantity || 0), 0), 0);

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

  const totalProfit = ordersForMonth(currentMonthStart, currentMonthEnd).reduce((sum, order) => {
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
    bestSeller: getBestSeller(deliveredOrders),
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

app.post('/api/admin/setup-store', (req, res, next) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'فقط مالك المتجر يستطيع إنشاء المتجر' });
  if (!requireSupabase(res)) return;
  setupStoreUpload(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.message });
    next();
  });
}, async (req, res) => {
  let createdAdminId = null;
  let imagePath = null;
  const cleanupErrors = [];
  try {
    let setup;
    try {
      setup = JSON.parse(req.body?.setup || '');
    } catch {
      return res.status(400).json({ error: 'بيانات إنشاء المتجر غير صالحة' });
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
      return res.status(400).json({ error: 'تحقق من اسم المتجر والشعار ونصوص التعريف والسياسات' });
    }

    const admin = setup.admin || null;
    if (admin && (!String(admin.name || '').trim() || String(admin.name).trim().length > 120 ||
      !emailPattern.test(String(admin.email || '').trim()))) {
      return res.status(400).json({ error: 'بيانات المشرف غير مكتملة أو غير صالحة' });
    }

    const product = setup.product || null;
    if (product && (!String(product.name || '').trim() || String(product.name).trim().length > 160 ||
      !String(product.description || '').trim() || String(product.description).trim().length > 5000 ||
      !Number.isFinite(Number(product.price)) || Number(product.price) <= 0 ||
      String(product.stockQuantity ?? '').trim() === '' ||
      !Number.isInteger(Number(product.stockQuantity)) || Number(product.stockQuantity) < 0)) {
      return res.status(400).json({ error: 'بيانات المنتج الأول غير مكتملة أو غير صالحة' });
    }
    if (req.file && !product) return res.status(400).json({ error: 'لا يمكن رفع صورة من دون إضافة منتج' });

    if (admin) {
      const { data, error } = await supabaseServer.auth.admin.createUser({
        email: String(admin.email).trim().toLowerCase(),
        email_confirm: true,
        user_metadata: { full_name: String(admin.name).trim() },
      });
      if (error) {
        const status = /already|registered|exists/i.test(error.message) ? 409 : 400;
        return res.status(status).json({ error: /already|registered|exists/i.test(error.message) ? 'هذا البريد الإلكتروني مستخدم مسبقاً' : error.message });
      }
      createdAdminId = data.user.id;
    }

    let imageUrl = '';
    if (req.file && product) {
      const extensionByType = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
      imagePath = `store-products/${crypto.randomUUID()}.${extensionByType[req.file.mimetype]}`;
      const { error } = await supabaseServer.storage.from('uploads').upload(
        imagePath,
        await fs.promises.readFile(req.file.path),
        { contentType: req.file.mimetype, upsert: false },
      );
      if (error) throw error;
      imageUrl = supabaseServer.storage.from('uploads').getPublicUrl(imagePath).data.publicUrl;
    }

    const { error } = await supabaseServer.rpc('complete_store_setup', {
      p_owner_id: getSession(req).accountId,
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
    res.status(201).json({ ok: true, message: 'تم إنشاء المتجر بنجاح' });
  } catch (error) {
    if (imagePath) {
      try {
        const { error: storageError } = await supabaseServer.storage.from('uploads').remove([imagePath]);
        if (storageError) cleanupErrors.push(storageError.message);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError.message);
      }
    }
    if (createdAdminId) {
      try {
        const { error: authError } = await supabaseServer.auth.admin.deleteUser(createdAdminId);
        if (authError) cleanupErrors.push(authError.message);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError.message);
      }
    }
    const message = cleanupErrors.length
      ? `${error.message} تعذر التراجع عن بعض الموارد: ${cleanupErrors.join('؛ ')}`
      : error.message;
    return res.status(500).json({ error: message });
  } finally {
    if (req.file?.path) {
      try {
        await fs.promises.unlink(req.file.path);
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('Failed to remove temporary store setup image:', error.message);
      }
    }
  }
});

app.get('/api/admin/reset-security', async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'فقط مالك المتجر يستطيع إدارة رمز الأمان' });
  if (!requireSupabase(res)) return;
  const { data, error } = await supabaseServer.from('store_security').select('id').eq('id', 1).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ configured: Boolean(data) });
});

app.post('/api/admin/reset-security', async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'فقط مالك المتجر يستطيع إنشاء رمز الأمان' });
  if (!requireSupabase(res)) return;
  const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
  if (pin.length < 6 || pin.length > 128) return res.status(400).json({ error: 'يجب أن يتكون رمز الأمان من 6 خانات على الأقل وبحد أقصى 128 خانة' });
  const { data: existing, error: selectError } = await supabaseServer.from('store_security').select('id').eq('id', 1).maybeSingle();
  if (selectError) return res.status(500).json({ error: selectError.message });
  if (existing) return res.status(409).json({ error: 'تم إنشاء رمز الأمان مسبقاً' });
  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = await securityPinHash(pin, salt);
  const { error } = await supabaseServer.from('store_security').insert({ id: 1, pin_hash: pinHash, pin_salt: salt });
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'تم إنشاء رمز الأمان مسبقاً' : error.message });
  res.status(201).json({ configured: true });
});

app.post('/api/admin/reset-security/verify', async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'فقط مالك المتجر يستطيع إعادة ضبطه' });
  if (!requireSupabase(res)) return;
  const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
  if (!pin || pin.length > 128) return res.status(400).json({ error: 'أدخل رمز الأمان' });
  const { data: security, error } = await supabaseServer.from('store_security').select('pin_hash, pin_salt, locked_until').eq('id', 1).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!security) return res.status(409).json({ error: 'أنشئ رمز الأمان أولاً' });
  if (security.locked_until && new Date(security.locked_until).getTime() > Date.now()) {
    const minutes = Math.ceil((new Date(security.locked_until).getTime() - Date.now()) / 60000);
    return res.status(429).json({ error: `تم قفل المحاولات مؤقتاً. حاول بعد ${minutes} دقيقة.` });
  }
  const candidateHash = await securityPinHash(pin, security.pin_salt);
  const matched = equalHashes(candidateHash, security.pin_hash);
  const { data: attempt, error: attemptError } = await supabaseServer.rpc('record_reset_pin_attempt', { p_success: matched });
  if (attemptError) return res.status(500).json({ error: attemptError.message });
  if (!attempt.ok) {
    const minutes = Math.max(1, Math.ceil((new Date(attempt.lockedUntil).getTime() - Date.now()) / 60000));
    return res.status(429).json({ error: `تم قفل المحاولات مؤقتاً. حاول بعد ${minutes} دقيقة.` });
  }
  if (!matched) return res.status(401).json({ error: `رمز الأمان غير صحيح. المحاولات المتبقية: ${5 - attempt.failedAttempts}` });
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { error: tokenError } = await supabaseServer.from('store_security').update({
    reset_token_hash: hashResetToken(token),
    reset_token_expires_at: expiresAt,
  }).eq('id', 1);
  if (tokenError) return res.status(500).json({ error: tokenError.message });
  res.json({ resetToken: token, expiresAt });
});

app.post('/api/admin/reset-security/confirm', async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'فقط مالك المتجر يستطيع إعادة ضبطه' });
  if (!requireSupabase(res)) return;
  const token = typeof req.body?.resetToken === 'string' ? req.body.resetToken : '';
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'انتهت صلاحية التأكيد. تحقق من الرمز مرة أخرى.' });
  const { data: consumed, error: consumeError } = await supabaseServer.rpc('consume_store_reset_token', { p_token_hash: hashResetToken(token) });
  if (consumeError) return res.status(500).json({ error: consumeError.message });
  if (!consumed) return res.status(401).json({ error: 'انتهت صلاحية التأكيد. تحقق من الرمز مرة أخرى.' });
  const { error } = await supabaseServer.rpc('reset_store', { p_owner_id: getSession(req).accountId });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, message: 'تمت إعادة ضبط المتجر' });
});

app.post('/api/admin/reset-store', async (req, res) => {
  return res.status(410).json({ error: 'يجب التحقق من رمز الأمان قبل إعادة ضبط المتجر' });
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
    taglineFont: ['cairo', 'sans', 'serif'].includes(req.body.taglineFont) ? req.body.taglineFont : previous.taglineFont,
    taglineColor: /^#[0-9a-fA-F]{6}$/.test(req.body.taglineColor || '') ? req.body.taglineColor.toUpperCase() : previous.taglineColor,
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

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('API request failed', error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  res.status(status).json({ error: status === 500 ? 'حدث خطأ داخلي. حاول مرة أخرى.' : error.message });
});

app.listen(port, () => console.log(`الخادم يعمل على http://localhost:${port}`));
