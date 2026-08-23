import express from 'express';
import cors from 'cors';
import { DatabaseSync } from 'node:sqlite';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;
const persistentDataDir = '/data';
let databasePath = path.join(__dirname, 'catalog.db');
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
if (isRailway) {
  try {
    fs.mkdirSync(persistentDataDir, { recursive: true });
    databasePath = path.join(persistentDataDir, 'catalog.db');
  } catch {
    // Fall back to the project directory when the persistent volume is unavailable.
  }
}
const db = new DatabaseSync(databasePath);
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

const sessions = new Map();
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
const verifyPassword = (password, storedHash) => {
  const [salt, key] = String(storedHash || '').split(':');
  if (!salt || !key) return false;
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derivedKey, 'hex'), Buffer.from(key, 'hex'));
};
const getSession = (req) => sessions.get(req.headers['x-admin-token']);
const isAdminRequest = (req) => {
  return getSession(req)?.role === 'admin';
};

const ensureColumn = (table, column, definition) => {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!existing.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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
  maintenanceMode: false,
};

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    costPrice REAL DEFAULT 0,
    discountPercentage REAL DEFAULT 0,
    imageUrl TEXT,
    productImages TEXT,
    category TEXT,
    stockQuantity INTEGER DEFAULT 10,
    inStock INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS discounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    value REAL NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    items TEXT NOT NULL,
    customerName TEXT NOT NULL,
    province TEXT NOT NULL,
    address TEXT NOT NULL,
    nearestLandmark TEXT NOT NULL,
    phoneNumber TEXT NOT NULL,
    subtotal REAL NOT NULL,
    discountCode TEXT,
    discountAmount REAL NOT NULL,
    deliveryFee REAL NOT NULL,
    finalTotal REAL NOT NULL,
    accountId INTEGER,
    accountOrderNumber INTEGER,
    status TEXT NOT NULL DEFAULT 'processing',
    isRead INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS site_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    storeName TEXT,
    tagline TEXT,
    logoUrl TEXT,
    heroTitle TEXT,
    heroDescription TEXT,
    heroImageUrl TEXT,
    heroButtonText TEXT
  );
  CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer',
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS account_carts (
    accountId INTEGER PRIMARY KEY,
    items TEXT NOT NULL DEFAULT '[]',
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS account_coupons (
    accountId INTEGER NOT NULL,
    discountId INTEGER NOT NULL,
    savedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (accountId, discountId),
    FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (discountId) REFERENCES discounts(id) ON DELETE CASCADE
  );
`);

ensureColumn('products', 'costPrice', 'REAL DEFAULT 0');
ensureColumn('products', 'discountPercentage', 'REAL DEFAULT 0');
ensureColumn('products', 'productImages', 'TEXT');
ensureColumn('products', 'stockQuantity', 'INTEGER DEFAULT 10');
ensureColumn('site_settings', 'storeName', 'TEXT');
ensureColumn('site_settings', 'tagline', 'TEXT');
ensureColumn('site_settings', 'logoUrl', 'TEXT');
ensureColumn('site_settings', 'heroTitle', 'TEXT');
ensureColumn('site_settings', 'heroDescription', 'TEXT');
ensureColumn('site_settings', 'heroImageUrl', 'TEXT');
ensureColumn('site_settings', 'heroButtonText', 'TEXT');
ensureColumn('site_settings', 'maintenanceMode', 'INTEGER DEFAULT 0');
ensureColumn('orders', 'accountId', 'INTEGER');
ensureColumn('orders', 'accountOrderNumber', 'INTEGER');

const ordersMissingAccountNumbers = db.prepare('SELECT id, accountId FROM orders WHERE accountId IS NOT NULL AND accountOrderNumber IS NULL ORDER BY accountId, datetime(createdAt), id').all();
const accountOrderCounters = new Map();
ordersMissingAccountNumbers.forEach((order) => {
  const nextNumber = (accountOrderCounters.get(order.accountId) || 0) + 1;
  accountOrderCounters.set(order.accountId, nextNumber);
  db.prepare('UPDATE orders SET accountOrderNumber = ? WHERE id = ?').run(nextNumber, order.id);
});

const administratorEmail = 'hausain12moh@gmail.com';
const administratorPassword = 'Hussain_20_12';
const administrator = db.prepare('SELECT id FROM accounts WHERE identifier = ?').get(administratorEmail);
if (!administrator) {
  db.prepare('INSERT INTO accounts (identifier, passwordHash, role) VALUES (?, ?, ?)').run(administratorEmail, hashPassword(administratorPassword), 'admin');
}

const getSiteSettings = () => {
  const row = db.prepare('SELECT * FROM site_settings ORDER BY id DESC LIMIT 1').get();
  if (!row) {
    db.prepare('INSERT INTO site_settings (storeName, tagline, logoUrl, heroTitle, heroDescription, heroImageUrl, heroButtonText) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(defaultSiteSettings.storeName, defaultSiteSettings.tagline, defaultSiteSettings.logoUrl, defaultSiteSettings.heroTitle, defaultSiteSettings.heroDescription, defaultSiteSettings.heroImageUrl, defaultSiteSettings.heroButtonText);
    return { ...defaultSiteSettings };
  }
  return { ...defaultSiteSettings, ...row, maintenanceMode: Boolean(row.maintenanceMode) };
};

const getDiscountedPrice = (product) => {
  const price = Number(product?.price || 0);
  const discount = Number(product?.discountPercentage || 0);
  if (!discount) return Number(price.toFixed(2));
  return Number((price * (1 - discount / 100)).toFixed(2));
};

const getProductImages = (product) => {
  let images = [];
  try {
    images = JSON.parse(product?.productImages || '[]');
  } catch {
    images = [];
  }
  if (!Array.isArray(images)) images = [];
  const fallback = product?.imageUrl || '';
  return [...new Set([fallback, ...images].filter(Boolean))];
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
});

const adminProductData = (row) => ({
  ...publicProductData(row),
  costPrice: Number(row.costPrice || 0),
  profit: Number((Number(row.price || 0) - Number(row.costPrice || 0)).toFixed(2)),
});

if (!db.prepare('SELECT COUNT(*) as count FROM discounts').get().count) {
  db.prepare('INSERT INTO discounts (code, type, value, active) VALUES (?, ?, ?, 1)').run('NASAQ10', 'percentage', 10);
}

getSiteSettings();

app.post('/api/auth/register', (req, res) => {
  const identifier = String(req.body.identifier || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
  const isPhone = /^07\d{9}$/.test(identifier);
  if ((!isEmail && !isPhone) || password.length < 6) {
    return res.status(400).json({ error: 'أدخل بريداً إلكترونياً أو رقم هاتف عراقياً، وكلمة مرور من 6 أحرف على الأقل' });
  }
  try {
    const result = db.prepare('INSERT INTO accounts (identifier, passwordHash, role) VALUES (?, ?, ?)').run(identifier, hashPassword(password), 'customer');
    res.status(201).json({ id: result.lastInsertRowid, identifier, role: 'customer' });
  } catch {
    res.status(409).json({ error: 'هذا الحساب مسجل مسبقاً' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const identifier = String(req.body.identifier || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const account = db.prepare('SELECT * FROM accounts WHERE identifier = ?').get(identifier);
  if (!account || !verifyPassword(password, account.passwordHash)) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { accountId: account.id, role: account.role, identifier: account.identifier });
  res.json({ token, role: account.role, identifier: account.identifier });
});

app.post('/api/auth/logout', (req, res) => {
  sessions.delete(req.headers['x-admin-token']);
  res.status(204).end();
});

app.get('/api/account/cart', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'يجب تسجيل الدخول لحفظ السلة' });
  const row = db.prepare('SELECT items FROM account_carts WHERE accountId = ?').get(session.accountId);
  let items = [];
  try { items = JSON.parse(row?.items || '[]'); } catch { items = []; }
  res.json({ items: Array.isArray(items) ? items : [] });
});

app.put('/api/account/cart', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'يجب تسجيل الدخول لحفظ السلة' });
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  db.prepare(`INSERT INTO account_carts (accountId, items, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(accountId) DO UPDATE SET items=excluded.items, updatedAt=CURRENT_TIMESTAMP`).run(session.accountId, JSON.stringify(items));
  res.json({ ok: true, items });
});

app.get('/api/account/coupons', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  const coupons = db.prepare(`SELECT d.* FROM discounts d JOIN account_coupons ac ON ac.discountId = d.id WHERE ac.accountId = ? ORDER BY ac.savedAt DESC`).all(session.accountId);
  res.json(coupons.map((coupon) => ({ ...coupon, active: Boolean(coupon.active) })));
});

app.post('/api/account/coupons/:code', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  const coupon = db.prepare('SELECT * FROM discounts WHERE code = ? AND active = 1').get(String(req.params.code).toUpperCase());
  if (!coupon) return res.status(404).json({ error: 'كود الخصم غير صالح أو غير فعال' });
  db.prepare('INSERT OR IGNORE INTO account_coupons (accountId, discountId) VALUES (?, ?)').run(session.accountId, coupon.id);
  res.status(201).json({ ...coupon, active: Boolean(coupon.active), saved: true });
});

app.get('/api/site-settings', (req, res) => res.json(getSiteSettings()));

app.post('/api/analytics/view', (req, res) => {
  const type = req.body?.type === 'product' ? 'product' : 'home';
  db.prepare('INSERT INTO page_views (type) VALUES (?)').run(type);
  res.status(201).json({ ok: true, type });
});

app.get('/api/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  res.json(rows.map(publicProductData));
});

app.get('/api/products/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'المنتج غير موجود' });
  res.json(publicProductData(row));
});

app.get('/api/admin/products', (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  const rows = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  res.json(rows.map(adminProductData));
});

app.post('/api/admin/products', (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  const { name, description, price, costPrice, discountPercentage, category, stockQuantity, inStock, imageUrl, productImages } = req.body;
  if (!name || !description || !price) return res.status(400).json({ error: 'يرجى إكمال بيانات المنتج' });

  const images = Array.isArray(productImages) ? productImages.filter(Boolean) : [];
  const primaryImage = imageUrl || images[0] || '';
  const result = db.prepare('INSERT INTO products (name, description, price, costPrice, discountPercentage, imageUrl, productImages, category, stockQuantity, inStock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, description, Number(price), Number(costPrice || 0), Number(discountPercentage || 0), primaryImage, JSON.stringify(images), category || 'عام', Math.max(0, Number(stockQuantity ?? 10)), inStock === false ? 0 : 1);

  res.status(201).json(adminProductData(db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid)));
});

app.put('/api/admin/products/:id', (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'المنتج غير موجود' });
  const body = {
    name: req.body.name ?? existing.name,
    description: req.body.description ?? existing.description,
    price: Number(req.body.price ?? existing.price),
    costPrice: Number(req.body.costPrice ?? existing.costPrice ?? 0),
    discountPercentage: Number(req.body.discountPercentage ?? existing.discountPercentage ?? 0),
    category: req.body.category ?? existing.category,
    inStock: req.body.inStock === false ? 0 : (req.body.inStock === true ? 1 : existing.inStock),
    imageUrl: req.body.imageUrl ?? existing.imageUrl,
    productImages: Array.isArray(req.body.productImages) ? req.body.productImages.filter(Boolean) : getProductImages(existing),
    stockQuantity: Math.max(0, Number(req.body.stockQuantity ?? existing.stockQuantity ?? 10)),
  };

  const images = body.productImages;
  const primaryImage = body.imageUrl || images[0] || '';
  db.prepare('UPDATE products SET name=?, description=?, price=?, costPrice=?, discountPercentage=?, imageUrl=?, productImages=?, category=?, stockQuantity=?, inStock=? WHERE id=?')
    .run(body.name, body.description, body.price, body.costPrice, body.discountPercentage, primaryImage, JSON.stringify(images), body.category, body.stockQuantity, body.inStock, req.params.id);

  res.json(adminProductData(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)));
});

app.delete('/api/admin/products/:id', (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

app.get('/api/discounts', (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  res.json(db.prepare('SELECT * FROM discounts ORDER BY id DESC').all().map((d) => ({ ...d, active: Boolean(d.active) })));
});
app.post('/api/discounts', (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  try {
    const result = db.prepare('INSERT INTO discounts (code,type,value,active) VALUES (?,?,?,?)').run(String(req.body.code).toUpperCase(), req.body.type, Number(req.body.value), req.body.active === false ? 0 : 1);
    res.status(201).json(db.prepare('SELECT * FROM discounts WHERE id=?').get(result.lastInsertRowid));
  } catch {
    res.status(400).json({ error: 'كود الخصم مستخدم مسبقاً' });
  }
});
app.put('/api/discounts/:id', (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  db.prepare('UPDATE discounts SET code=?, type=?, value=?, active=? WHERE id=?').run(String(req.body.code).toUpperCase(), req.body.type, Number(req.body.value), req.body.active ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM discounts WHERE id=?').get(req.params.id));
});
app.delete('/api/discounts/:id', (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  db.prepare('DELETE FROM discounts WHERE id=?').run(req.params.id);
  res.status(204).end();
});
app.get('/api/discounts/validate/:code', (req, res) => {
  const discount = db.prepare('SELECT * FROM discounts WHERE code=? AND active=1').get(String(req.params.code).toUpperCase());
  res.json(discount || null);
});

app.get('/api/orders', (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  res.json(db.prepare('SELECT * FROM orders ORDER BY datetime(createdAt) DESC').all().map((o) => ({ ...o, items: JSON.parse(o.items), isRead: Boolean(o.isRead), accountOrderNumber: o.accountOrderNumber || null })));
});
app.get('/api/orders/unread-count', (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  res.json({ count: db.prepare('SELECT COUNT(*) as count FROM orders WHERE isRead=0').get().count });
});
app.post('/api/orders', (req, res) => {
  if (getSiteSettings().maintenanceMode) return res.status(503).json({ error: 'الطلبات متوقفة مؤقتاً بسبب الصيانة' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'يجب تسجيل الدخول لإرسال الطلب' });
  const b = req.body;
  if (!b.customerName || !b.province || !b.address || !b.nearestLandmark || !b.phoneNumber || !b.items?.length) {
    return res.status(400).json({ error: 'يرجى إكمال الحقول المطلوبة' });
  }

  const enrichedItems = b.items.map((item) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.productId);
    return {
      productId: item.productId,
      name: item.name,
      price: Number(item.price || 0),
      quantity: Number(item.quantity || 0),
      costPrice: Number(product?.costPrice || 0),
      discountPercentage: Number(product?.discountPercentage || 0),
    };
  });

  const accountOrderNumber = db.prepare('SELECT COALESCE(MAX(accountOrderNumber), 0) + 1 AS nextNumber FROM orders WHERE accountId = ?').get(session.accountId).nextNumber;
  const result = db.prepare('INSERT INTO orders (items,customerName,province,address,nearestLandmark,phoneNumber,subtotal,discountCode,discountAmount,deliveryFee,finalTotal,accountId,accountOrderNumber,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(JSON.stringify(enrichedItems), b.customerName, b.province, b.address, b.nearestLandmark, b.phoneNumber, Number(b.subtotal || 0), b.discountCode || '', Number(b.discountAmount || 0), Number(b.deliveryFee || 0), Number(b.finalTotal || 0), session.accountId, accountOrderNumber, 'processing', new Date().toISOString());
  res.status(201).json({ id: result.lastInsertRowid });
});

app.get('/api/account/orders', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  const orders = db.prepare('SELECT * FROM orders WHERE accountId = ? ORDER BY datetime(createdAt) DESC').all(session.accountId);
  res.json(orders.map((order) => {
    const discount = order.discountCode ? db.prepare('SELECT type, value FROM discounts WHERE code = ?').get(order.discountCode) : null;
    return {
      ...order,
      items: JSON.parse(order.items),
      isRead: Boolean(order.isRead),
      accountOrderNumber: order.accountOrderNumber || null,
      discountType: discount?.type || null,
      discountValue: discount?.value || 0,
    };
  }));
});

app.patch('/api/orders/:id', (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  if (req.body.status) db.prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status, req.params.id);
  if (req.body.isRead !== undefined) db.prepare('UPDATE orders SET isRead=? WHERE id=?').run(req.body.isRead ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/analytics', (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });

  const homeViews = db.prepare("SELECT COUNT(*) as count FROM page_views WHERE type='home'").get().count;
  const productViews = db.prepare("SELECT COUNT(*) as count FROM page_views WHERE type='product'").get().count;
  const orders = db.prepare('SELECT * FROM orders').all();
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
    const items = JSON.parse(order.items || '[]');
    const orderProfit = items.reduce((itemSum, item) => {
      const unitProfit = Number(item.price || 0) - Number(item.costPrice || 0);
      return itemSum + unitProfit * Number(item.quantity || 0);
    }, 0);
    return sum + orderProfit;
  }, 0);

  const productStats = {};
  [...deliveredOrders, ...cancelledOrders].forEach((order) => {
    JSON.parse(order.items || '[]').forEach((item) => {
      const key = String(item.productId);
      const current = productStats[key] || { productId: item.productId, name: item.name, soldQuantity: 0, cancelledQuantity: 0, profit: 0 };
      const quantity = Number(item.quantity || 0);
      if (order.status === 'cancelled') current.cancelledQuantity += quantity;
      if (order.status === 'delivered') {
        current.soldQuantity += quantity;
        current.profit += (Number(item.price || 0) - Number(item.costPrice || 0)) * quantity;
      }
      productStats[key] = current;
    });
  });
  const productsSummary = Object.values(productStats).map((item) => ({ ...item, profit: Number(item.profit.toFixed(2)) }));
  const highestProfitProduct = productsSummary.reduce((best, item) => !best || item.profit > best.profit ? item : best, null);
  const lowestProfitProduct = productsSummary.reduce((worst, item) => !worst || item.profit < worst.profit ? item : worst, null);
  const mostCancelledProduct = productsSummary.reduce((most, item) => !most || item.cancelledQuantity > most.cancelledQuantity ? item : most, null);

  res.json({
    totalViews: homeViews + productViews,
    homeViews,
    productViews,
    orderStats,
    currentRevenue,
    lastRevenue,
    growth,
    totalProfit,
    totalLosses: 0,
    highestProfitProduct,
    lowestProfitProduct,
    mostCancelledProduct,
    productsSummary,
  });
});

app.get('/api/admin/site-settings', (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  res.json(getSiteSettings());
});

app.post('/api/admin/site-settings', upload.fields([{ name: 'logoImage', maxCount: 1 }, { name: 'heroImage', maxCount: 1 }]), (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح' });
  const previous = getSiteSettings();
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
    maintenanceMode: req.body.maintenanceMode === 'true' || req.body.maintenanceMode === true,
  };

  const existing = db.prepare('SELECT * FROM site_settings ORDER BY id DESC LIMIT 1').get();
  if (existing) {
    db.prepare('UPDATE site_settings SET storeName=?, tagline=?, logoUrl=?, heroTitle=?, heroDescription=?, heroImageUrl=?, heroButtonText=?, maintenanceMode=? WHERE id=?')
      .run(settings.storeName, settings.tagline, settings.logoUrl, settings.heroTitle, settings.heroDescription, settings.heroImageUrl, settings.heroButtonText, settings.maintenanceMode ? 1 : 0, existing.id);
  } else {
    db.prepare('INSERT INTO site_settings (storeName, tagline, logoUrl, heroTitle, heroDescription, heroImageUrl, heroButtonText, maintenanceMode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(settings.storeName, settings.tagline, settings.logoUrl, settings.heroTitle, settings.heroDescription, settings.heroImageUrl, settings.heroButtonText, settings.maintenanceMode ? 1 : 0);
  }

  res.json({ ...defaultSiteSettings, ...settings, maintenanceMode: Boolean(settings.maintenanceMode) });
});

app.listen(port, () => console.log(`الخادم يعمل على http://localhost:${port}`));
