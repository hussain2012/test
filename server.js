import express from 'express';
import cors from 'cors';
import { DatabaseSync } from 'node:sqlite';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;
const db = new DatabaseSync(path.join(__dirname, 'catalog.db'));
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir));

db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL, price REAL NOT NULL, imageUrl TEXT, category TEXT, inStock INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS discounts (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, type TEXT NOT NULL, value REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, items TEXT NOT NULL, customerName TEXT NOT NULL, province TEXT NOT NULL, address TEXT NOT NULL, nearestLandmark TEXT NOT NULL, phoneNumber TEXT NOT NULL, subtotal REAL NOT NULL, discountCode TEXT, discountAmount REAL NOT NULL, deliveryFee REAL NOT NULL, finalTotal REAL NOT NULL, status TEXT NOT NULL DEFAULT 'new', isRead INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL);
`);

const count = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
if (!count) {
  const seed = db.prepare('INSERT INTO products (name, description, price, imageUrl, category, inStock) VALUES (?, ?, ?, ?, ?, 1)');
  [
    ['كوب خزفي دافئ', 'كوب مصنوع يدوياً بملمس ناعم وتفاصيل بسيطة ترافق صباحك.', 18500, 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=80', 'المنزل'],
    ['حقيبة قماش يومية', 'حقيبة عملية من قماش متين، خفيفة ومناسبة لكل مشاويرك.', 32000, 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=80', 'إكسسوارات'],
    ['شمعة خشب الأرز', 'رائحة هادئة من خشب الأرز والحمضيات في وعاء زجاجي أنيق.', 15000, 'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=900&q=80', 'العناية'],
    ['دفتر يوميات فاخر', 'صفحات عالية الجودة بغلاف مريح لتسجيل أفكارك وخططك.', 12500, 'https://images.unsplash.com/photo-1531346878377-a5be20888e3b?auto=format&fit=crop&w=900&q=80', 'القرطاسية'],
    ['زجاجة ماء معدنية', 'تصميم متين يحافظ على حرارة مشروبك طوال اليوم.', 27000, 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=900&q=80', 'المنزل'],
    ['صابون طبيعي', 'قطعة صابون لطيفة بزيوت طبيعية وعطر نباتي خفيف.', 9000, 'https://images.unsplash.com/photo-1607006483225-5f7c5a44c8b0?auto=format&fit=crop&w=900&q=80', 'العناية']
  ].forEach(item => seed.run(...item));
}
if (!db.prepare('SELECT COUNT(*) as count FROM discounts').get().count) db.prepare('INSERT INTO discounts (code, type, value, active) VALUES (?, ?, ?, 1)').run('NASAQ10', 'percentage', 10);

const productData = row => ({ ...row, inStock: Boolean(row.inStock) });
app.get('/api/products', (req, res) => res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all().map(productData)));
app.post('/api/products', upload.single('image'), (req, res) => {
  const { name, description, price, category, inStock } = req.body;
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : (req.body.imageUrl || '');
  if (!name || !description || !price) return res.status(400).json({ error: 'يرجى إكمال بيانات المنتج' });
  const result = db.prepare('INSERT INTO products (name, description, price, imageUrl, category, inStock) VALUES (?, ?, ?, ?, ?, ?)').run(name, description, Number(price), imageUrl, category || 'عام', inStock === 'false' ? 0 : 1);
  res.status(201).json(productData(db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid)));
});
app.put('/api/products/:id', upload.single('image'), (req, res) => {
  const old = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'المنتج غير موجود' });
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : (req.body.imageUrl ?? old.imageUrl);
  db.prepare('UPDATE products SET name=?, description=?, price=?, imageUrl=?, category=?, inStock=? WHERE id=?').run(req.body.name, req.body.description, Number(req.body.price), imageUrl, req.body.category, req.body.inStock === 'false' ? 0 : 1, req.params.id);
  res.json(productData(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)));
});
app.delete('/api/products/:id', (req, res) => { db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id); res.status(204).end(); });

app.get('/api/discounts', (req, res) => res.json(db.prepare('SELECT * FROM discounts ORDER BY id DESC').all().map(d => ({ ...d, active: Boolean(d.active) }))));
app.post('/api/discounts', (req, res) => { try { const result = db.prepare('INSERT INTO discounts (code,type,value,active) VALUES (?,?,?,?)').run(req.body.code.toUpperCase(), req.body.type, Number(req.body.value), req.body.active === false ? 0 : 1); res.status(201).json(db.prepare('SELECT * FROM discounts WHERE id=?').get(result.lastInsertRowid)); } catch { res.status(400).json({ error: 'كود الخصم مستخدم مسبقاً' }); } });
app.put('/api/discounts/:id', (req, res) => { db.prepare('UPDATE discounts SET code=?, type=?, value=?, active=? WHERE id=?').run(req.body.code.toUpperCase(), req.body.type, Number(req.body.value), req.body.active ? 1 : 0, req.params.id); res.json(db.prepare('SELECT * FROM discounts WHERE id=?').get(req.params.id)); });
app.delete('/api/discounts/:id', (req, res) => { db.prepare('DELETE FROM discounts WHERE id=?').run(req.params.id); res.status(204).end(); });
app.get('/api/discounts/validate/:code', (req, res) => { const discount = db.prepare('SELECT * FROM discounts WHERE code=? AND active=1').get(req.params.code.toUpperCase()); res.json(discount || null); });

app.get('/api/orders', (req, res) => res.json(db.prepare('SELECT * FROM orders ORDER BY datetime(createdAt) DESC').all().map(o => ({ ...o, items: JSON.parse(o.items), isRead: Boolean(o.isRead) }))));
app.get('/api/orders/unread-count', (req, res) => res.json({ count: db.prepare('SELECT COUNT(*) as count FROM orders WHERE isRead=0').get().count }));
app.post('/api/orders', (req, res) => {
  const b = req.body;
  if (!b.customerName || !b.province || !b.address || !b.nearestLandmark || !b.phoneNumber || !b.items?.length) return res.status(400).json({ error: 'يرجى إكمال الحقول المطلوبة' });
  const result = db.prepare('INSERT INTO orders (items,customerName,province,address,nearestLandmark,phoneNumber,subtotal,discountCode,discountAmount,deliveryFee,finalTotal,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(JSON.stringify(b.items), b.customerName, b.province, b.address, b.nearestLandmark, b.phoneNumber, b.subtotal, b.discountCode || '', b.discountAmount, b.deliveryFee, b.finalTotal, new Date().toISOString());
  res.status(201).json({ id: result.lastInsertRowid });
});
app.patch('/api/orders/:id', (req, res) => { if (req.body.status) db.prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status, req.params.id); if (req.body.isRead !== undefined) db.prepare('UPDATE orders SET isRead=? WHERE id=?').run(req.body.isRead ? 1 : 0, req.params.id); res.json({ ok: true }); });

app.listen(port, () => console.log(`الخادم يعمل على http://localhost:${port}`));
