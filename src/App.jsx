import { useEffect, useRef, useState, createContext, useContext } from 'react';
import { Routes, Route, Link, useNavigate, useLocation, Navigate, useParams } from 'react-router-dom';

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = `${API_BASE_URL}/api`;
const provinces = ['بغداد','البصرة','نينوى','أربيل','النجف','كربلاء','كركوك','السليمانية','دهوك','الأنبار','بابل','ذي قار','ديالى','الديوانية','ميسان','المثنى','صلاح الدين','واسط'];
const defaultSettings = {
  storeName: 'نسق',
  tagline: 'اختيارات تصنع يومك',
  logoUrl: '',
  heroTitle: 'أشياء صغيرة، فرق كبير',
  heroDescription: 'منتجات منتقاة بعناية لتمنح تفاصيل يومك معنى أجمل.',
  heroImageUrl: '',
  heroButtonText: 'اكتشف المجموعة',
};

const money = (value) => `${new Intl.NumberFormat('ar-IQ').format(Number(value || 0))} د.ع`;

const adminHeaders = () => ({
  'x-admin-token': localStorage.getItem('sessionToken') || '',
});

const adminFetch = (url, options = {}) => fetch(url, {
  ...options,
  headers: {
    ...(options.headers || {}),
    ...adminHeaders(),
  },
});

const CartContext = createContext();

const useCart = () => useContext(CartContext);

function CartProvider({ children }) {
  const accountCartLoaded = useRef(!localStorage.getItem('sessionToken'));
  const [cart, setCart] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('cart') || '[]');
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('cart', JSON.stringify(cart));
    if (!accountCartLoaded.current || !localStorage.getItem('sessionToken')) return;
    fetch(`${API}/account/cart`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ items: cart }),
    }).catch(() => {});
  }, [cart]);

  useEffect(() => {
    const loadAccountCart = async () => {
      const token = localStorage.getItem('sessionToken');
      if (!token) {
        accountCartLoaded.current = true;
        return;
      }
      accountCartLoaded.current = false;
      try {
        const response = await fetch(`${API}/account/cart`, { headers: adminHeaders() });
        if (!response.ok) return;
        const data = await response.json();
        setCart(Array.isArray(data.items) ? data.items : []);
      } finally {
        accountCartLoaded.current = true;
      }
    };
    loadAccountCart();
    window.addEventListener('account-session-changed', loadAccountCart);
    return () => window.removeEventListener('account-session-changed', loadAccountCart);
  }, []);

  const addItem = (product, quantity = 1) => {
    const sellingPrice = Number(product.discountedPrice ?? product.price ?? 0);
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) {
        return current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + quantity, price: sellingPrice } : item);
      }
      return [...current, { ...product, id: Number(product.id), quantity, price: sellingPrice }];
    });
  };

  const updateItem = (id, quantity) => {
    setCart((current) => quantity < 1 ? current.filter((item) => item.id !== id) : current.map((item) => item.id === id ? { ...item, quantity } : item));
  };

  const clearCart = () => setCart([]);
  const subtotal = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);

  return (
    <CartContext.Provider value={{ cart, addItem, updateItem, clearCart, count: cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0), subtotal }}>
      {children}
    </CartContext.Provider>
  );
}

function useSiteSettings() {
  const [settings, setSettings] = useState(defaultSettings);

  useEffect(() => {
    fetch(`${API}/site-settings`)
      .then((res) => res.json())
      .then((data) => setSettings({ ...defaultSettings, ...data }))
      .catch(() => setSettings(defaultSettings));
  }, []);

  return settings;
}

function ProductImage({ src, alt, className = '' }) {
  return src ? <img className={className} src={src} alt={alt} /> : <div className={`image-empty ${className}`}>لا توجد صورة</div>;
}

function AddToCartButton({ product, quantity = 1, className = 'primary', disabled = false, label = 'أضف للسلة', disabledLabel = 'غير متوفر' }) {
  const { addItem, cart } = useCart();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const inCart = cart.some((item) => item.id === Number(product.id));

  useEffect(() => {
    if (!status) return undefined;
    const timer = setTimeout(() => setStatus(''), 1700);
    return () => clearTimeout(timer);
  }, [status]);

  const handleClick = () => {
    if (disabled) return;
    if (inCart) {
      navigate('/checkout');
      return;
    }
    addItem(product, quantity);
    setStatus('تمت الإضافة ✓');
  };

  return (
    <button type="button" className={className} disabled={disabled} onClick={handleClick}>
      {status || (disabled ? disabledLabel : (inCart ? 'عرض السلة' : label))}
    </button>
  );
}

function App() {
  return (
    <CartProvider>
      <Routes>
        <Route path="/" element={<Store />} />
        <Route path="/product/:id" element={<ProductDetailPage />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/my-orders" element={<MyOrders />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin/*" element={<Admin />} />
        <Route path="*" element={<Store />} />
      </Routes>
    </CartProvider>
  );
}

function StoreNav({ settings }) {
  const { count } = useCart();

  return (
    <header className="nav">
      <Link to="/" className="brand">
        {settings.logoUrl ? <img src={settings.logoUrl} alt={settings.storeName} className="logo" /> : <span>{settings.storeName}</span>}
        <small>{settings.tagline}</small>
      </Link>
      <nav>
        <Link to="/">المتجر</Link>
        <Link to="/login">تسجيل الدخول</Link>
        {localStorage.getItem('sessionToken') && <Link to="/my-orders">طلباتي</Link>}
        <Link to="/checkout" className="cart-link">السلة <b>{count}</b></Link>
      </nav>
    </header>
  );
}

function Store() {
  const settings = useSiteSettings();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('الكل');

  useEffect(() => {
    fetch(`${API}/analytics/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'home' }),
    }).catch(() => {});

    fetch(`${API}/products`)
      .then((res) => res.json())
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, []);

  const categories = ['الكل', ...new Set(products.map((product) => product.category || 'عام'))];
  const visibleProducts = products.filter((product) => {
    const matchesCategory = category === 'الكل' || product.category === category;
    const query = search.trim().toLowerCase();
    const matchesQuery = !query || product.name.toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });

  return (
    <>
      <StoreNav settings={settings} />
      <main>
        {settings.maintenanceMode && <div className="maintenance-banner">المتجر في وضع الصيانة: يمكنك تصفح المنتجات، والطلبات متوقفة مؤقتاً.</div>}
        <section className="hero">
          <div>
            <p className="eyebrow">{settings.tagline}</p>
            <h1>{settings.heroTitle}</h1>
            <p>{settings.heroDescription}</p>
            <a href="#catalog" className="primary">{settings.heroButtonText} <span>←</span></a>
          </div>
          <div className="hero-art">
            <ProductImage src={settings.heroImageUrl} alt={settings.heroTitle} />
          </div>
        </section>

        <section id="catalog" className="catalog">
          <div className="section-head">
            <div>
              <p className="eyebrow">المجموعة الحالية</p>
              <h2>منتجات تستحق مكاناً في يومك</h2>
            </div>
            <div className="filters">
              <input aria-label="بحث" placeholder="ابحث عن منتج..." value={search} onChange={(event) => setSearch(event.target.value)} />
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="empty">جاري تحميل المنتجات...</div>
          ) : !products.length ? (
            <div className="empty">لا توجد منتجات</div>
          ) : !visibleProducts.length ? (
            <div className="empty">لا توجد منتجات مطابقة للبحث</div>
          ) : (
            <div className="product-grid">
              {visibleProducts.map((product) => <ProductCard key={product.id} product={product} maintenanceMode={settings.maintenanceMode} />)}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function ProductCard({ product, maintenanceMode = false }) {
  const hasDiscount = Number(product.discountPercentage || 0) > 0;
  const unitPrice = Number(product.discountedPrice ?? product.price ?? 0);

  return (
    <article className="product" key={product.id}>
      <Link to={`/product/${product.id}`} className="product-image">
        <ProductImage src={product.imageUrl} alt={product.name} />
            {!product.inStock && <span className="sold">{maintenanceMode ? 'المتجر في وضع الصيانة' : 'طلب مسبق'}</span>}
      </Link>
      <div className="product-info">
        <span>{product.category}</span>
        <Link to={`/product/${product.id}`} className="product-name"><h3>{product.name}</h3></Link>
        <p>{product.description}</p>
        <div className="product-bottom">
          <div className="price-wrap">
            {hasDiscount ? <><span className="old-price">{money(product.price)}</span><strong>{money(unitPrice)}</strong></> : <strong>{money(product.price)}</strong>}
          </div>
          <AddToCartButton product={product} quantity={1} className="mini-button" disabled={!product.inStock || maintenanceMode} label="أضف للسلة" disabledLabel={maintenanceMode ? 'المتجر في وضع الصيانة' : 'غير متوفر'} />
        </div>
      </div>
    </article>
  );
}

function ProductDetailPage() {
  const { id } = useParams();
  const settings = useSiteSettings();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState('');

  useEffect(() => {
    fetch(`${API}/analytics/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'product' }),
    }).catch(() => {});

    setLoading(true);
    setError('');
    fetch(`${API}/products/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'تعذر تحميل المنتج');
        return data;
      })
      .then((data) => {
        setProduct(data);
        setSelectedImage(data.productImages?.[0] || data.imageUrl || '');
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <><StoreNav settings={settings} /><div className="empty">جاري تحميل المنتج...</div></>;
  }

  if (error || !product) {
    return <><StoreNav settings={settings} /><div className="empty"><h2>{error || 'المنتج غير موجود'}</h2><Link to="/" className="primary">العودة إلى المتجر</Link></div></>;
  }

  const hasDiscount = Number(product.discountPercentage || 0) > 0;
  const finalPrice = Number(product.discountedPrice ?? product.price ?? 0);

  return (
    <>
      <StoreNav settings={settings} />
      <main className="detail-page">
        <div className="product-detail-layout">
          <div className="detail-image-wrap">
            <ProductImage src={selectedImage} alt={product.name} />
            <div className="detail-thumbnails">
              {(product.productImages?.length ? product.productImages : [product.imageUrl]).filter(Boolean).map((image, index) => (
                <button type="button" className={selectedImage === image ? 'selected' : ''} key={`${image}-${index}`} onClick={() => setSelectedImage(image)}>
                  <ProductImage src={image} alt={`${product.name} ${index + 1}`} />
                </button>
              ))}
            </div>
          </div>
          <div className="detail-content">
            <span className="category-badge">{product.category}</span>
            <h1>{product.name}</h1>
            <div className="price-stack">
              {hasDiscount ? <><span className="old-price">{money(product.price)}</span><strong>{money(finalPrice)}</strong></> : <strong>{money(product.price)}</strong>}
            </div>
            <div className={`status-pill ${settings.maintenanceMode ? 'maintenance' : (product.inStock ? 'available' : 'unavailable')}`}>
              {settings.maintenanceMode ? 'المتجر في وضع الصيانة' : (product.inStock ? `متوفر في المخزون: ${product.stockQuantity} قطعة` : 'طلب مسبق')}
            </div>
            <p className="detail-description">{product.description}</p>
            <div className="quantity-row">
              <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button>
              <span>{quantity}</span>
              <button type="button" onClick={() => setQuantity((value) => value + 1)}>+</button>
            </div>
            <AddToCartButton product={product} quantity={quantity} disabled={!product.inStock || settings.maintenanceMode} className="primary block" label="أضف للسلة" disabledLabel={settings.maintenanceMode ? 'المتجر في وضع الصيانة' : 'غير متوفر'} />
            <Link to="/" className="back-link">العودة إلى المتجر</Link>
          </div>
        </div>
      </main>
    </>
  );
}

function Field({ label, name, type = 'text', value, onChange, placeholder, required = true, allowReveal = false, onKeyDown }) {
  const [revealed, setRevealed] = useState(false);
  const inputType = allowReveal && revealed ? 'text' : type;
  return (
    <label className="field-label">
      {label}
      <span className="input-with-action">
        <input name={name} type={inputType} value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} required={required} />
        {allowReveal && <button type="button" className="reveal-password" onClick={() => setRevealed((current) => !current)} aria-label={revealed ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>{revealed ? 'إخفاء' : 'إظهار'}</button>}
      </span>
    </label>
  );
}

function Checkout() {
  const settings = useSiteSettings();
  const { cart, subtotal, updateItem, clearCart } = useCart();
  const [form, setForm] = useState({ customerName: '', province: '', address: '', nearestLandmark: '', phoneNumber: '', discountCode: '' });
  const [discount, setDiscount] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const navigate = useNavigate();

  const delivery = form.province && form.province !== 'بغداد' ? 5000 : 3000;
  const discountAmount = discount ? (discount.type === 'percentage' ? subtotal * Number(discount.value || 0) / 100 : Math.min(Number(discount.value || 0), subtotal)) : 0;
  const total = subtotal - discountAmount + delivery;

  const handleChange = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  const applyDiscount = async () => {
    if (!form.discountCode.trim()) return;
    const res = await fetch(`${API}/discounts/validate/${encodeURIComponent(form.discountCode.trim())}`);
    const data = await res.json();
    setDiscount(data || null);
    if (!data) {
      setError('كود الخصم غير صالح أو غير فعال');
      return;
    }
    if (localStorage.getItem('sessionToken')) {
      fetch(`${API}/account/coupons/${encodeURIComponent(data.code)}`, {
        method: 'POST',
        headers: adminHeaders(),
      }).catch(() => {});
    }
  };

  const submitOrder = async (event) => {
    event.preventDefault();
    setError('');
    if (settings.maintenanceMode) return setError('الطلبات متوقفة مؤقتاً بسبب الصيانة');
    if (!localStorage.getItem('sessionToken')) return navigate('/login');

    if (!/^07\d{9}$/.test(form.phoneNumber)) return setError('يرجى إدخال رقم هاتف عراقي صحيح');
    if (!form.customerName || !form.province || !form.address || !form.nearestLandmark) return setError('يرجى إكمال جميع الحقول المطلوبة');
    if (!cart.length) return setError('السلة فارغة');

    const payload = {
      items: cart.map((item) => ({ productId: item.id, name: item.name, price: Number(item.price || 0), quantity: Number(item.quantity || 0) })),
      customerName: form.customerName,
      province: form.province,
      address: form.address,
      nearestLandmark: form.nearestLandmark,
      phoneNumber: form.phoneNumber,
      subtotal,
      discountCode: discount?.code || '',
      discountAmount,
      deliveryFee: delivery,
      finalTotal: total,
    };

    const res = await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.id) {
      clearCart();
      setDone(data.id);
    } else {
      setError(data.error || 'تعذر إرسال الطلب');
    }
  };

  if (done) {
    return (
      <>
        <StoreNav settings={settings} />
        <main className="confirmation">
          <div className="check">✓</div>
          <p className="eyebrow">تم استلام طلبك</p>
          <h1>شكراً لاختيارك نسق</h1>
          <p>طلبك رقم <strong>#{done}</strong> قيد المراجعة، وسنتواصل معك قريباً لتأكيده.</p>
          <Link to="/" className="primary">العودة إلى المتجر</Link>
        </main>
      </>
    );
  }

  return (
    <>
      <StoreNav settings={settings} />
      <main className="checkout">
        <div className="checkout-head">
          <p className="eyebrow">الخطوة الأخيرة</p>
          <h1>إتمام الطلب</h1>
        </div>

        {!cart.length ? (
          <div className="empty">السلة فارغة حالياً. <Link to="/">تصفح المنتجات</Link></div>
        ) : (
          <div className="checkout-layout">
            <form className="order-form" onSubmit={submitOrder}>
              <Field label="الاسم" name="customerName" value={form.customerName} onChange={handleChange} />
              <label className="field-label">
                المحافظة
                <select name="province" value={form.province} onChange={handleChange} required>
                  <option value="">اختر المحافظة</option>
                  {provinces.map((province) => <option key={province} value={province}>{province}</option>)}
                </select>
              </label>
              <Field label="العنوان" name="address" value={form.address} onChange={handleChange} />
              <Field label="اقرب نقطة دالة" name="nearestLandmark" value={form.nearestLandmark} onChange={handleChange} />
              <Field label="رقم هاتف" name="phoneNumber" type="tel" value={form.phoneNumber} onChange={handleChange} placeholder="07xxxxxxxxx" />
              <div className="discount-field">
                <Field label="كود خصم اذا توفر" name="discountCode" value={form.discountCode} onChange={handleChange} required={false} />
                <button type="button" onClick={applyDiscount}>تطبيق</button>
              </div>
              {error && <p className="error">{error}</p>}
              <button type="submit" className="primary full" disabled={settings.maintenanceMode}>{settings.maintenanceMode ? 'الطلبات متوقفة للصيانة' : 'تأكيد وإرسال الطلب'}</button>
            </form>

            <aside className="receipt">
              <h2>ملخص الطلب</h2>
              {cart.map((item) => (
                <div className="receipt-item" key={item.id}>
                  <ProductImage src={item.imageUrl} alt={item.name} />
                  <div>
                    <strong>{item.name}</strong>
                    <small>{money(item.price)} × {item.quantity}</small>
                    <div className="qty">
                      <button type="button" onClick={() => updateItem(item.id, item.quantity - 1)}>−</button>
                      <span>{item.quantity}</span>
                      <button type="button" onClick={() => updateItem(item.id, item.quantity + 1)}>+</button>
                    </div>
                  </div>
                </div>
              ))}
              <div className="totals">
                <div><span>السعر الاجمالي</span><strong>{money(subtotal)}</strong></div>
                <div><span>الخصم {discount ? `(${discount.type === 'percentage' ? `${discount.value}%` : money(discount.value)})` : ''}</span><strong>- {money(discountAmount)}</strong></div>
                <div><span>التوصيل</span><strong>{money(delivery)}</strong></div>
                <div className="total-row"><span>السعر الاجمالي</span><strong>{money(total)}</strong></div>
              </div>
            </aside>
          </div>
        )}
      </main>
    </>
  );
}

function MyOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/account/orders`, { headers: adminHeaders() })
      .then((res) => res.ok ? res.json() : [])
      .then(setOrders)
      .finally(() => setLoading(false));
  }, []);

  const statusLabels = { new: 'جديد', processing: 'قيد التجهيز', delivered: 'تم التوصيل', cancelled: 'ملغي' };
  return (
    <>
      <StoreNav settings={useSiteSettings()} />
      <main className="account-orders">
        <p className="eyebrow">حسابي</p>
        <h1>طلباتي</h1>
        {loading ? <div className="empty">جاري تحميل الطلبات...</div> : !orders.length ? <div className="empty">لا توجد طلبات</div> : (
          <div className="account-order-list">
            {orders.map((order) => <article className={`account-order status-${order.status}`} key={order.id}>
              <div className="account-order-heading"><div><strong>طلب #{order.accountOrderNumber || order.id}</strong><small>{new Date(order.createdAt).toLocaleString('ar-IQ')}</small></div><span className="account-order-status">{statusLabels[order.status] || order.status}</span></div>
              <div className="account-order-items">{(order.items || []).map((item) => <div key={`${order.id}-${item.productId}`}><span>{item.name} × {item.quantity}</span><strong>{money(Number(item.price || 0) * Number(item.quantity || 0))}</strong></div>)}</div>
              <div className="account-order-totals"><span>المجموع: {money(order.subtotal)}</span><span>الخصم {order.discountValue ? `(${order.discountType === 'percentage' ? `${order.discountValue}%` : money(order.discountValue)})` : ''}: - {money(order.discountAmount)}</span><span>التوصيل: {money(order.deliveryFee)}</span><strong>الإجمالي: {money(order.finalTotal)}</strong></div>
            </article>)}
          </div>
        )}
      </main>
    </>
  );
}

function Login() {
  const [mode, setMode] = useState('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [capsLock, setCapsLock] = useState(false);
  const navigate = useNavigate();

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const endpoint = mode === 'login' ? 'login' : 'register';
    const response = await fetch(`${API}/auth/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || 'تعذر إتمام العملية');
      return;
    }
    if (mode === 'register') {
      setMessage('تم إنشاء الحساب. يمكنك تسجيل الدخول الآن.');
      setMode('login');
      setPassword('');
      return;
    }
    localStorage.setItem('sessionToken', data.token);
    localStorage.setItem('accountRole', data.role);
    localStorage.setItem('accountIdentifier', data.identifier);
    window.dispatchEvent(new Event('account-session-changed'));
    if (data.role === 'admin') navigate('/admin');
    else navigate('/');
  };

  if (localStorage.getItem('sessionToken') && localStorage.getItem('accountRole') === 'admin') {
    return <Navigate to="/admin" replace />;
  }

  return (
    <main className="login-page">
      <Link to="/" className="brand">نسق</Link>
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">حساب نسق</p>
        <h1>{mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}</h1>
        <p>{mode === 'login' ? 'سجّل الدخول بالبريد الإلكتروني أو رقم الهاتف.' : 'أنشئ حساباً بالبريد الإلكتروني أو رقم الهاتف.'}</p>
        <Field label="البريد الإلكتروني أو رقم الهاتف" name="identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
        <Field label="كلمة المرور" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => setCapsLock(event.getModifierState('CapsLock'))} allowReveal />
        {capsLock && <p className="caps-lock-message">الأحرف الكبيرة مفعلة</p>}
        {error && <p className="error">{error}</p>}
        {message && <p className="success-message">{message}</p>}
        <button type="submit" className="primary full">{mode === 'login' ? 'تسجيل الدخول' : 'إنشاء الحساب'}</button>
        <button type="button" className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setMessage(''); }}>
          {mode === 'login' ? 'إنشاء حساب جديد' : 'لديك حساب؟ تسجيل الدخول'}
        </button>
        <Link to="/" className="back">العودة للمتجر</Link>
      </form>
    </main>
  );
}

function Admin() {
  const location = useLocation();
  const requestedPage = location.pathname.split('/')[2] || 'overview';
  const page = requestedPage === 'product-discounts' ? 'products' : requestedPage;
  const navigate = useNavigate();

  if (!localStorage.getItem('sessionToken') || localStorage.getItem('accountRole') !== 'admin') {
    return <Login />;
  }

  const titleMap = {
    overview: 'نظرة عامة',
    products: 'المنتجات',
    orders: 'الطلبات',
    discounts: 'أكواد الخصم',
    analytics: 'الإحصائيات',
    settings: 'إعدادات المتجر',
  };

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <Link to="/" className="brand">نسق<small>لوحة التحكم</small></Link>
        <Link className={page === 'overview' ? 'active' : ''} to="/admin">نظرة عامة</Link>
        <Link className={page === 'products' ? 'active' : ''} to="/admin/products">المنتجات</Link>
        <Link className={page === 'orders' ? 'active' : ''} to="/admin/orders">الطلبات</Link>
        <Link className={page === 'discounts' ? 'active' : ''} to="/admin/discounts">أكواد الخصم</Link>
        <Link className={page === 'analytics' ? 'active' : ''} to="/admin/analytics">الإحصائيات</Link>
        <Link className={page === 'settings' ? 'active' : ''} to="/admin/settings">إعدادات المتجر</Link>
        <button type="button" className="logout" onClick={async () => { await fetch(`${API}/auth/logout`, { method: 'POST', headers: adminHeaders() }); localStorage.removeItem('sessionToken'); localStorage.removeItem('accountRole'); localStorage.removeItem('accountIdentifier'); window.dispatchEvent(new Event('account-session-changed')); navigate('/'); }}>تسجيل الخروج</button>
      </aside>

      <section className="admin-content">
        <div className="admin-top">
          <div>
            <p className="eyebrow">صباح الخير</p>
            <h1>{titleMap[page] || 'لوحة الإدارة'}</h1>
          </div>
          <Link to="/" className="view-store">عرض المتجر ↗</Link>
        </div>

        {page === 'products' ? <ProductsAdmin /> : page === 'orders' ? <OrdersAdmin /> : page === 'discounts' ? <DiscountsAdmin /> : page === 'analytics' ? <AnalyticsAdmin /> : page === 'settings' ? <SiteSettingsAdmin /> : <Overview />}
      </section>
    </div>
  );
}

function Overview() {
  const [stats, setStats] = useState({ totalViews: 0, currentRevenue: 0, growth: 0, totalProfit: 0, totalLosses: 0, homeViews: 0, productViews: 0, orderStats: {} });

  useEffect(() => {
    Promise.all([
      adminFetch(`${API}/admin/analytics`),
      adminFetch(`${API}/orders`),
      adminFetch(`${API}/orders/unread-count`),
    ])
      .then(async ([analyticsRes, ordersRes, unreadRes]) => {
        const analytics = await analyticsRes.json();
        const orders = await ordersRes.json();
        const unread = await unreadRes.json();
        setStats({ ...analytics, orderCount: orders.length, unreadCount: unread.count });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="dashboard-overview">
      <div className="stats">
        <div><span>مبيعات هذا الشهر</span><strong>{money(stats.currentRevenue)}</strong><small>مقارنة بالشهر السابق: {stats.growth || 0}%</small></div>
        <div><span>الطلبات الكلية</span><strong>{stats.orderStats?.total || 0}</strong><small>جديد: {stats.orderStats?.new || 0} | قيد التجهيز: {stats.orderStats?.processing || 0}</small></div>
        <div><span>طلبات مكتملة</span><strong>{stats.orderStats?.delivered || 0}</strong><small>الأرباح المحققة: {money(stats.totalProfit)}</small></div>
        <div><span>الزيارات</span><strong>{stats.totalViews || 0}</strong><small>الرئيسية: {stats.homeViews || 0} | المنتجات: {stats.productViews || 0}</small></div>
        <div className="highlight"><span>صافي الأرباح</span><strong>{money(stats.totalProfit)}</strong><small>الطلبات الملغاة لا تُحتسب خسارة</small></div>
      </div>
    </div>
  );
}

function ProductsAdmin() {
  const emptyForm = { name: '', description: '', price: '', costPrice: '', discountPercentage: '', category: '', imageUrl: '', productImages: [], stockQuantity: 10, inStock: true };
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const response = await adminFetch(`${API}/admin/products`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر تحميل المنتجات');
      setItems(Array.isArray(data) ? data : []);
      setError('');
    } catch (reason) {
      setItems([]);
      setError(reason.message || 'تعذر تحميل المنتجات');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');
    const payload = {
      ...form,
      price: Number(form.price),
      costPrice: Number(form.costPrice || 0),
      discountPercentage: Number(form.discountPercentage || 0),
      stockQuantity: Number(form.stockQuantity || 0),
      inStock: Boolean(form.inStock),
    };

    const method = editingId ? 'PUT' : 'POST';
    const url = editingId ? `${API}/admin/products/${editingId}` : `${API}/admin/products`;

    const response = await adminFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setError(result.error || 'تعذر حفظ المنتج');
      return;
    }

    resetForm();
    setMessage(editingId ? 'تم تحديث المنتج' : 'تمت إضافة المنتج');
    await load();
  };

  const handleDelete = async (id) => {
    const response = await adminFetch(`${API}/admin/products/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('تعذر حذف المنتج');
      return;
    }
    setMessage('تم حذف المنتج');
    load();
  };

  const startEdit = (product) => {
    setEditingId(product.id);
    setForm({
      name: product.name,
      description: product.description,
      price: product.price,
      costPrice: product.costPrice ?? 0,
      discountPercentage: product.discountPercentage ?? 0,
      category: product.category,
      imageUrl: product.imageUrl || '',
      productImages: product.productImages || [],
      stockQuantity: product.stockQuantity ?? 0,
      inStock: product.inStock,
    });
  };

  return (
    <>
      <form className="admin-form" onSubmit={submit}>
        <h2>{editingId ? 'تعديل المنتج' : 'إضافة منتج'}</h2>
        <input placeholder="اسم المنتج" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input placeholder="سعر البيع" type="number" required value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
        <input placeholder="سعر الشراء" type="number" value={form.costPrice} onChange={(event) => setForm({ ...form, costPrice: event.target.value })} />
        <label className="field-label">نسبة الخصم %<input aria-label="نسبة الخصم" placeholder="0 بدون خصم" type="number" min="0" max="100" value={form.discountPercentage} onChange={(event) => setForm({ ...form, discountPercentage: event.target.value })} /></label>
        <input placeholder="التصنيف" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
        <label className="field-label">الكمية في المخزون<input type="number" min="0" value={form.stockQuantity} onChange={(event) => setForm({ ...form, stockQuantity: event.target.value })} /></label>
        <input placeholder="رابط الصورة الرئيسية" value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} />
        <textarea className="image-list-input" placeholder="روابط صور إضافية، رابط في كل سطر" value={form.productImages?.join('\n') || ''} onChange={(event) => setForm({ ...form, productImages: event.target.value.split(/\n|,/).map((item) => item.trim()).filter(Boolean) })} />
        <textarea placeholder="الوصف" required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        <label className="check-label">
          <input type="checkbox" checked={form.inStock} onChange={(event) => setForm({ ...form, inStock: event.target.checked })} />
          متوفر في المخزون
        </label>
        <button type="submit" className="primary">{editingId ? 'حفظ التعديلات' : 'حفظ المنتج'}</button>
        {editingId && <button type="button" className="secondary-button" onClick={resetForm}>إلغاء</button>}
        {message && <p className="success-message">{message}</p>}
        {error && <p className="error">{error}</p>}
      </form>

      <div className="admin-table">
        <div className="table-title">
          <h2>كل المنتجات</h2>
          <span>{items.length} منتجات</span>
        </div>
        {items.map((product) => (
          <div className="table-row product-row" key={product.id}>
            <ProductImage src={product.imageUrl} alt={product.name} />
            <strong>{product.name}</strong>
            <span>{product.category}</span>
            <span>{money(product.price)}</span>
            <span>{product.discountPercentage ? `${product.discountPercentage}% خصم` : 'بدون خصم'}</span>
            <span>{product.inStock ? `${product.stockQuantity} قطعة` : 'طلب مسبق'}</span>
            <span>{money(product.costPrice || 0)}</span>
            <span>{money(product.profit || 0)}</span>
            <span>{product.inStock ? 'متوفر' : 'غير متوفر'}</span>
            <div className="inline-actions">
              <button type="button" onClick={() => startEdit(product)}>تعديل</button>
              <button type="button" className="danger" onClick={() => handleDelete(product.id)}>حذف</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ProductDiscountAdmin() {
  const [items, setItems] = useState([]);

  const load = () => adminFetch(`${API}/admin/products`).then((res) => res.json()).then(setItems);

  useEffect(() => { load(); }, []);

  const updateDiscount = (productId, value) => {
    setItems((current) => current.map((product) => product.id === productId ? { ...product, discountPercentage: Number(value || 0) } : product));
  };

  const saveProduct = async (product) => {
    await adminFetch(`${API}/admin/products/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: product.name,
        description: product.description,
        price: Number(product.price),
        costPrice: Number(product.costPrice || 0),
        discountPercentage: Number(product.discountPercentage || 0),
        category: product.category,
        imageUrl: product.imageUrl || '',
        productImages: product.productImages || [],
        inStock: Boolean(product.inStock),
      }),
    });
    load();
  };

  return (
    <div className="admin-table">
      <div className="table-title">
        <h2>خصومات المنتجات</h2>
        <span>{items.length} منتج</span>
      </div>
      {items.map((product) => {
        const finalPrice = Number(product.discountPercentage || 0) > 0 ? Number(product.price) * (1 - Number(product.discountPercentage || 0) / 100) : Number(product.price || 0);
        return (
          <div className="table-row discount-row" key={product.id}>
            <strong>{product.name}</strong>
            <span>{money(product.price)}</span>
            <span>{money(finalPrice)}</span>
            <input type="number" min="0" max="100" value={product.discountPercentage || 0} onChange={(event) => updateDiscount(product.id, event.target.value)} />
            <button type="button" onClick={() => saveProduct(product)}>حفظ</button>
          </div>
        );
      })}
    </div>
  );
}

function OrdersAdmin() {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('all');

  const load = () => adminFetch(`${API}/orders`).then((res) => res.json()).then(setOrders);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  const updateOrder = async (id, status) => {
    await adminFetch(`${API}/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, isRead: true }),
    });
    load();
  };

  const visibleOrders = orders.filter((order) => filter === 'all' || order.status === filter);

  return (
    <div className="orders">
      <div className="order-filter">
        <span>كل الطلبات ({orders.length})</span>
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">كل الحالات</option>
          <option value="new">جديد</option>
          <option value="processing">قيد التجهيز</option>
          <option value="delivered">تم التوصيل</option>
          <option value="cancelled">ملغي</option>
        </select>
      </div>
      <div className="order-legend"><span><i className="legend-dot delivered-dot" />مكتمل</span><span><i className="legend-dot cancelled-dot" />ملغي</span><span><i className="legend-dot processing-dot" />قيد التجهيز</span><span><i className="legend-unread" />غير مقروء</span></div>

      {visibleOrders.map((order) => (
        <article className={`order-card status-${order.status} ${order.isRead ? '' : 'unread-order'}`} key={order.id}>
          <div className="order-card-head">
            <div>
              <span className="order-id">طلب #{order.id}</span>
              <small>{new Date(order.createdAt).toLocaleString('ar-IQ')}</small>
              {!order.isRead && <b className="unread-badge">طلب غير مقروء</b>}
            </div>
            <select value={order.status} onChange={(event) => updateOrder(order.id, event.target.value)}>
              <option value="new">جديد</option>
              <option value="processing">قيد التجهيز</option>
              <option value="delivered">تم التوصيل</option>
              <option value="cancelled">ملغي</option>
            </select>
          </div>

          <div className="order-details">
            <p><b>الاسم</b>{order.customerName}</p>
            <p><b>المحافظة</b>{order.province}</p>
            <p><b>العنوان</b>{order.address}</p>
            <p><b>اقرب نقطة دالة</b>{order.nearestLandmark}</p>
            <p><b>رقم هاتف</b>{order.phoneNumber}</p>
            <p><b>السعر الاجمالي</b>{money(order.subtotal)}</p>
            <p><b>كود الخصم</b>{order.discountCode || 'لا يوجد'}</p>
            <p><b>الخصم</b>{money(order.discountAmount)}</p>
            <p><b>التوصيل</b>{money(order.deliveryFee)}</p>
            <p><b>السعر الاجمالي</b><strong>{money(order.finalTotal)}</strong></p>
          </div>

          <div className="ordered-items">
            {(order.items || []).map((item) => <span key={`${order.id}-${item.productId}`}>{item.name} × {item.quantity}</span>)}
          </div>
        </article>
      ))}

      {!visibleOrders.length && <div className="empty">لا توجد طلبات حالياً</div>}
    </div>
  );
}

function DiscountsAdmin() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ code: '', type: 'percentage', value: 10 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = () => adminFetch(`${API}/discounts`).then((res) => res.json()).then(setItems);

  useEffect(() => { load(); }, []);

  const save = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');
    const response = await adminFetch(`${API}/discounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setError(result.error || 'تعذر إضافة الكود');
      return;
    }
    setForm({ code: '', type: 'percentage', value: 10 });
    setMessage('تمت إضافة كود الخصم');
    load();
  };

  const toggle = async (discount) => {
    await adminFetch(`${API}/discounts/${discount.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...discount, active: !discount.active }),
    });
    load();
  };

  return (
    <>
      <form className="admin-form compact" onSubmit={save}>
        <h2>إضافة كود خصم</h2>
        <input placeholder="الكود" required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
        <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
          <option value="percentage">نسبة مئوية</option>
          <option value="fixed">مبلغ ثابت</option>
        </select>
        <label className="field-label">قيمة الخصم {form.type === 'percentage' ? '(%)' : '(د.ع)'}<input type="number" min="0" placeholder="القيمة" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} /></label>
        <button type="submit" className="primary">إضافة الكود</button>
        {message && <p className="success-message">{message}</p>}
        {error && <p className="error">{error}</p>}
      </form>

      <div className="admin-table">
        <div className="table-title"><h2>أكواد الخصم</h2></div>
        {items.map((discount) => (
          <div className="table-row" key={discount.id}>
            <strong>{discount.code}</strong>
            <span>{discount.type === 'percentage' ? 'نسبة مئوية' : 'مبلغ ثابت'}</span>
            <span>{discount.value}{discount.type === 'percentage' ? '%' : ' د.ع'}</span>
            <span className={discount.active ? 'active-status' : 'inactive-status'}>{discount.active ? 'فعال' : 'متوقف'}</span>
            <div className="inline-actions">
              <button type="button" onClick={() => toggle(discount)}>{discount.active ? 'إيقاف' : 'تفعيل'}</button>
              <button type="button" className="danger" onClick={() => adminFetch(`${API}/discounts/${discount.id}`, { method: 'DELETE' }).then(load)}>حذف</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function AnalyticsAdmin() {
  const [stats, setStats] = useState({ totalViews: 0, homeViews: 0, productViews: 0, currentRevenue: 0, lastRevenue: 0, growth: 0, totalProfit: 0, totalLosses: 0, orderStats: {}, highestProfitProduct: null, lowestProfitProduct: null, mostCancelledProduct: null });

  useEffect(() => {
    adminFetch(`${API}/admin/analytics`)
      .then((res) => res.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div className="stats analytics-grid">
      <div><span>إجمالي الزيارات</span><strong>{stats.totalViews || 0}</strong><small>{stats.homeViews || 0} زيارة للصفحة الرئيسية</small></div>
      <div><span>الزيارات للمنتجات</span><strong>{stats.productViews || 0}</strong><small>{stats.homeViews || 0} رئيسية / {stats.productViews || 0} تفاصيل</small></div>
      <div><span>إيرادات هذا الشهر</span><strong>{money(stats.currentRevenue)}</strong><small>الإيراد السابق: {money(stats.lastRevenue)}</small></div>
      <div><span>نسبة النمو</span><strong>{stats.growth || 0}%</strong><small>مقارنة بالشهر الماضي</small></div>
      <div><span>الأرباح</span><strong>{money(stats.totalProfit)}</strong><small>مجموع ربح الطلبات المسلمة</small></div>
      <div><span>الملغاة</span><strong>{stats.orderStats?.cancelled || 0}</strong><small>لا تُحتسب خسارة مالية</small></div>
      <div className="product-stat"><span>أعلى ربح</span><strong>{stats.highestProfitProduct?.name || 'لا توجد بيانات'}</strong><small>{stats.highestProfitProduct ? money(stats.highestProfitProduct.profit) : 'بعد إكمال الطلبات'}</small></div>
      <div className="product-stat"><span>أقل ربح</span><strong>{stats.lowestProfitProduct?.name || 'لا توجد بيانات'}</strong><small>{stats.lowestProfitProduct ? money(stats.lowestProfitProduct.profit) : 'بعد إكمال الطلبات'}</small></div>
      <div className="product-stat"><span>الأكثر إلغاءً</span><strong>{stats.mostCancelledProduct?.name || 'لا توجد بيانات'}</strong><small>{stats.mostCancelledProduct ? `${stats.mostCancelledProduct.cancelledQuantity} قطعة` : 'بعد وجود طلبات ملغاة'}</small></div>
    </div>
  );
}

function SiteSettingsAdmin() {
  const [settings, setSettings] = useState(defaultSettings);
  const [logoFile, setLogoFile] = useState(null);
  const [heroFile, setHeroFile] = useState(null);

  useEffect(() => {
    adminFetch(`${API}/admin/site-settings`)
      .then((res) => res.json())
      .then((data) => setSettings({ ...defaultSettings, ...data }))
      .catch(() => setSettings(defaultSettings));
  }, []);

  const save = async (event) => {
    event.preventDefault();
    const formData = new FormData();
    Object.entries(settings).forEach(([key, value]) => {
      if (value !== null && value !== undefined) formData.append(key, value);
    });
    if (logoFile) formData.append('logoImage', logoFile);
    if (heroFile) formData.append('heroImage', heroFile);

    const res = await fetch(`${API}/admin/site-settings`, {
      method: 'POST',
      headers: adminHeaders(),
      body: formData,
    });

    const data = await res.json();
    setSettings({ ...defaultSettings, ...data });
    setLogoFile(null);
    setHeroFile(null);
  };

  return (
    <form className="admin-form settings-form" onSubmit={save}>
      <h2>إعدادات المتجر</h2>
      <input placeholder="اسم المتجر" value={settings.storeName} onChange={(event) => setSettings({ ...settings, storeName: event.target.value })} />
      <input placeholder="الشعار أو الرابط" value={settings.logoUrl} onChange={(event) => setSettings({ ...settings, logoUrl: event.target.value })} />
      <input type="file" onChange={(event) => setLogoFile(event.target.files[0])} />
      <input placeholder="الشعار / العنوان الفرعي" value={settings.tagline} onChange={(event) => setSettings({ ...settings, tagline: event.target.value })} />
      <input placeholder="عنوان الهيرو" value={settings.heroTitle} onChange={(event) => setSettings({ ...settings, heroTitle: event.target.value })} />
      <textarea placeholder="وصف الهيرو" value={settings.heroDescription} onChange={(event) => setSettings({ ...settings, heroDescription: event.target.value })} />
      <input placeholder="رابط صورة الهيرو" value={settings.heroImageUrl} onChange={(event) => setSettings({ ...settings, heroImageUrl: event.target.value })} />
      <input type="file" onChange={(event) => setHeroFile(event.target.files[0])} />
      <input placeholder="نص زر الهيرو" value={settings.heroButtonText} onChange={(event) => setSettings({ ...settings, heroButtonText: event.target.value })} />
      <label className="maintenance-control"><input type="checkbox" checked={Boolean(settings.maintenanceMode)} onChange={(event) => setSettings({ ...settings, maintenanceMode: event.target.checked })} /><span><strong>وضع الصيانة</strong><small>السماح بتصفح المنتجات مع إيقاف إضافة المنتجات وإرسال الطلبات</small></span></label>
      <button type="submit" className="primary">حفظ الإعدادات</button>
    </form>
  );
}

export default App;
