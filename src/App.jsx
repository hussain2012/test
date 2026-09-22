import { useEffect, useRef, useState, createContext, useContext } from 'react';
import { Routes, Route, Link, useNavigate, useLocation, Navigate, useParams } from 'react-router-dom';
import { supabase } from './lib/supabaseClient';
import {
  accountCount, adminProducts, analytics, createDiscount, createOrder, createProduct, deleteDiscount, deleteProduct,
  defaultSettings, getAccountOrders, getCart, getProduct, getSiteSettings, inviteAdmin, listAdmins, listDiscounts,
  listOrders, listProducts, recordView, removeAdmin, resetStore as resetStoreData, saveCart, saveCoupon, saveSiteSettings, updateDiscount,
  unreadOrderCount, updateOrder, updateProduct, validateDiscount,
} from './lib/supabaseData';

const mediaUrl = (value) => {
  const source = String(value || '').trim();
  if (!source || source.startsWith('blob:')) return '';
  return source;
};
const provinces = ['بغداد','البصرة','نينوى','أربيل','النجف','كربلاء','كركوك','السليمانية','دهوك','الأنبار','بابل','ذي قار','ديالى','الديوانية','ميسان','المثنى','صلاح الدين','واسط'];
const money = (value) => `${new Intl.NumberFormat('ar-IQ').format(Number(value || 0))} د.ع`;
const SITE_SETTINGS_CACHE_KEY = 'site-settings-cache';
const parseVariantLines = (value) => String(value || '').split('\n').map((line) => {
  const [name, values] = line.split(':');
  return { name: String(name || '').trim(), values: String(values || '').split(',').map((item) => item.trim()).filter(Boolean) };
}).filter((variant) => variant.name && variant.values.length);
const variantsToText = (variants) => (Array.isArray(variants) ? variants : []).map((variant) => `${variant.name}: ${variant.values.join(', ')}`).join('\n');
const selectedVariantText = (variants) => Object.entries(variants || {}).map(([name, value]) => `${name}: ${value}`).join('، ');
const variantKey = (variants) => JSON.stringify(variants || {});
const authRedirectUrl = () => typeof window !== 'undefined'
  ? window.location.origin
  : 'https://test2-mar-efc5.vercel.app';
const authErrorMessage = (error, fallback) => {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  if (message.includes('rate limit') || message.includes('too many')) return 'تم تجاوز عدد المحاولات. انتظر قليلاً ثم حاول مرة أخرى.';
  if (message.includes('invalid login credentials') || code === 'invalid_credentials') return 'البريد أو كلمة المرور غير صحيحة. إذا لم تعيّن كلمة مرور من قبل، أرسل رابط دخول جديداً أدناه.';
  if (message.includes('email not confirmed')) return 'يجب تأكيد البريد الإلكتروني أولاً عبر الرابط المرسل إليك.';
  if (code === 'otp_expired' || message.includes('otp_expired') || message.includes('expired') || message.includes('invalid token')) return 'انتهت صلاحية الرابط. اطلب رابط دخول جديداً من صفحة التسجيل.';
  if (message.includes('invalid email')) return 'أدخل بريداً إلكترونياً صحيحاً.';
  if (message.includes('already registered') || message.includes('user already')) return 'هذا البريد مسجل مسبقاً.';
  return fallback;
};

const AuthContext = createContext(null);

const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let profileRequestId = 0;
    const loadProfile = async (user) => {
      const requestId = ++profileRequestId;
      if (!user) {
        setProfile(null);
        return;
      }
      try {
        const { data } = await supabase.from('profiles').select('id, identifier, role, "isOwner", "displayName", "pictureUrl"').eq('id', user.id).maybeSingle();
        if (requestId === profileRequestId) setProfile(data || null);
      } catch {
        if (requestId === profileRequestId) setProfile(null);
      }
    };

    supabase.auth.getSession()
      .then(async ({ data: { session: currentSession }, error }) => {
        if (error) throw error;
        setSession(currentSession);
        await loadProfile(currentSession?.user || null);
      })
      .catch(() => {
        setSession(null);
        setProfile(null);
      })
      .finally(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
      window.dispatchEvent(new Event('account-session-changed'));
      if (!nextSession || event === 'SIGNED_OUT') setProfile(null);
      if (nextSession?.user) loadProfile(nextSession.user);
    });
    return () => subscription.unsubscribe();
  }, []);

  const value = { session, user: session?.user || null, profile, loading };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const signOut = async (setError) => {
  const { error } = await supabase.auth.signOut();
  if (error && setError) setError('تعذر تسجيل الخروج. حاول مرة أخرى.');
  return !error;
};

const CartContext = createContext();

const useCart = () => useContext(CartContext);

function CartProvider({ children }) {
  const { session } = useAuth();
  const accountCartLoaded = useRef(!session);
  const [cart, setCart] = useState(() => {
    try {
      const storedCart = JSON.parse(localStorage.getItem('cart') || '[]');
      return Array.isArray(storedCart) ? storedCart : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('cart', JSON.stringify(cart));
    if (!accountCartLoaded.current || !session) return;
    saveCart(session.user.id, cart).catch(() => {});
  }, [cart, session]);

  useEffect(() => {
    const loadAccountCart = async () => {
      if (!session) {
        accountCartLoaded.current = true;
        return;
      }
      accountCartLoaded.current = false;
      try {
        const items = await getCart(session.user.id);
        setCart(Array.isArray(items) ? items : []);
      } finally {
        accountCartLoaded.current = true;
      }
    };
    loadAccountCart();
    window.addEventListener('account-session-changed', loadAccountCart);
    return () => window.removeEventListener('account-session-changed', loadAccountCart);
  }, [session]);

  const addItem = (product, quantity = 1) => {
    const sellingPrice = Number(product.discountedPrice ?? product.price ?? 0);
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) {
        return (Array.isArray(current) ? current : []).map((item) => item.id === product.id ? { ...item, quantity: item.quantity + quantity, price: sellingPrice } : item);
      }
      return [...current, { ...product, id: Number(product.id), quantity, price: sellingPrice }];
    });
  };

  const updateItem = (id, quantity) => {
    setCart((current) => quantity < 1 ? (Array.isArray(current) ? current : []).filter((item) => item.id !== id) : (Array.isArray(current) ? current : []).map((item) => item.id === id ? { ...item, quantity } : item));
  };

  const clearCart = () => setCart([]);
  const subtotal = (Array.isArray(cart) ? cart : []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);

  return (
    <CartContext.Provider value={{ cart, addItem, updateItem, clearCart, count: cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0), subtotal }}>
      {children}
    </CartContext.Provider>
  );
}

function useSiteSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(SITE_SETTINGS_CACHE_KEY) || 'null');
      return cached && typeof cached === 'object' ? { ...defaultSettings, ...cached } : defaultSettings;
    } catch {
      return defaultSettings;
    }
  });

  useEffect(() => {
    getSiteSettings()
      .then((data) => {
        const nextSettings = { ...defaultSettings, ...(data || {}) };
        setSettings(nextSettings);
        try {
          localStorage.setItem(SITE_SETTINGS_CACHE_KEY, JSON.stringify(nextSettings));
        } catch {
          // Continue with the in-memory settings when browser storage is unavailable.
        }
      })
      .catch(() => {});
  }, []);

  return settings;
}

function ProductImage({ src, alt, className = '' }) {
  const [failed, setFailed] = useState(false);
  const resolvedSource = mediaUrl(src);
  useEffect(() => setFailed(false), [resolvedSource]);
  return resolvedSource && !failed
    ? <img className={className} src={resolvedSource} alt={alt} onError={() => setFailed(true)} />
    : <div className={`image-empty ${className}`}>لا توجد صورة</div>;
}

function AddToCartButton({ product, quantity = 1, className = 'primary', disabled = false, label = 'أضف للسلة', disabledLabel = 'غير متوفر' }) {
  const { addItem, cart } = useCart();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const productVariantKey = variantKey(product.selectedVariants);
  const inCart = cart.some((item) => item.id === Number(product.id) && variantKey(item.selectedVariants) === productVariantKey);

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
    <AuthProvider>
      <CartProvider>
        <AppContent />
      </CartProvider>
    </AuthProvider>
  );
}

function AppContent() {
  return (
    <Routes>
      <Route path="/" element={<Store />} />
      <Route path="/product/:id" element={<ProductDetailPage />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/account" element={<AccountPage />} />
      <Route path="/my-orders" element={<MyOrders />} />
      <Route path="/login" element={<Login />} />
      <Route path="/admin/*" element={<Admin />} />
      <Route path="*" element={<Store />} />
    </Routes>
  );
}

function AccountPage() {
  const { user, profile } = useAuth();
  const settings = useSiteSettings();
  const navigate = useNavigate();
  const metadata = user?.user_metadata || {};
  const [name, setName] = useState(metadata.full_name || metadata.name || profile?.displayName || '');
  const [favoriteName, setFavoriteName] = useState('');
  const [favorite, setFavorite] = useState({ customerName: name, province: '', address: '', nearestLandmark: '', phoneNumber: '' });
  const [favorites, setFavorites] = useState(Array.isArray(metadata.saved_addresses) ? metadata.saved_addresses : []);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [passwordSet, setPasswordSet] = useState(metadata.password_set === true);
  const [activePanel, setActivePanel] = useState('account');

  if (!user) return <Navigate to="/login" replace />;

  const displayName = name || profile?.displayName || '';
  const updateFavoriteField = (event) => setFavorite((current) => ({ ...current, [event.target.name]: event.target.value }));

  const saveAccountName = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const { error: authError } = await supabase.auth.updateUser({ data: { full_name: name.trim() } });
    if (authError) return setError('تعذر حفظ الاسم. حاول مرة أخرى.');
    await supabase.from('profiles').update({ displayName: name.trim() }).eq('id', user.id);
    setMessage('تم حفظ الاسم');
  };

  const savePassword = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (newPassword.length < 6) return setError('يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.');
    if (newPassword !== confirmPassword) return setError('تأكيد كلمة المرور غير مطابق.');
    const { error: authError } = await supabase.auth.updateUser({ password: newPassword, data: { password_set: true } });
    if (authError) return setError(authErrorMessage(authError, 'تعذر حفظ كلمة المرور. حاول مرة أخرى.'));
    setNewPassword('');
    setConfirmPassword('');
    setPasswordSet(true);
    setMessage('تم تعيين كلمة المرور بنجاح');
  };

  const saveFavorite = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!favoriteName.trim() || !favorite.customerName.trim() || !favorite.province || !favorite.address.trim() || !favorite.nearestLandmark.trim() || !/^07\d{9}$/.test(favorite.phoneNumber)) {
      return setError('أكمل اسم الخيار وكل بيانات الطلب، وتأكد من رقم الهاتف.');
    }
    const nextFavorites = [...favorites, { ...favorite, id: `${Date.now()}`, label: favoriteName.trim() }];
    const { error: authError } = await supabase.auth.updateUser({ data: { saved_addresses: nextFavorites } });
    if (authError) return setError('تعذر حفظ الخيار المفضل. حاول مرة أخرى.');
    setFavorites(nextFavorites);
    setFavoriteName('');
    setFavorite({ customerName: name, province: '', address: '', nearestLandmark: '', phoneNumber: '' });
    setMessage('تم حفظ الخيار المفضل');
  };

  const deleteFavorite = async (favoriteId) => {
    const nextFavorites = favorites.filter((item) => item.id !== favoriteId);
    const { error: authError } = await supabase.auth.updateUser({ data: { saved_addresses: nextFavorites } });
    if (authError) return setError('تعذر حذف الخيار المفضل. حاول مرة أخرى.');
    setFavorites(nextFavorites);
  };

  return (
    <>
      <StoreNav settings={settings} />
      <main className="account-page">
        <div className="account-page-head"><p className="eyebrow">حسابك</p><h1>{displayName ? `أهلاً، ${displayName}` : 'أهلاً بك'}</h1><p>{user.email}</p></div>
        <section className="account-menu" aria-label="قائمة الحساب">
          <h2>الإعدادات</h2>
          <button type="button" className={`account-menu-row ${activePanel === 'account' ? 'active' : ''}`} onClick={() => setActivePanel('account')}><span className="account-menu-icon">◉</span><strong>بيانات الحساب</strong><span className="account-menu-arrow">‹</span></button>
          <button type="button" className={`account-menu-row ${activePanel === 'password' ? 'active' : ''}`} onClick={() => setActivePanel('password')}><span className="account-menu-icon">⌑</span><strong>{passwordSet ? 'تغيير كلمة المرور' : 'عيّن كلمة المرور'}</strong><span className="account-menu-arrow">‹</span></button>
          <h2>المساعدة</h2>
          <Link to="/my-orders" className="account-menu-row"><span className="account-menu-icon">★</span><strong>طلباتي السابقة</strong><span className="account-menu-arrow">‹</span></Link>
          <button type="button" className={`account-menu-row ${activePanel === 'favorites' ? 'active' : ''}`} onClick={() => setActivePanel('favorites')}><span className="account-menu-icon">⌖</span><strong>خيارات الطلب المفضلة</strong><span className="account-menu-arrow">‹</span></button>
          <button type="button" className={`account-menu-row ${activePanel === 'policy' ? 'active' : ''}`} onClick={() => setActivePanel('policy')}><span className="account-menu-icon">▣</span><strong>{settings.policyTitle}</strong><span className="account-menu-arrow">‹</span></button>
          <h2>الحساب</h2>
          <button type="button" className="account-menu-row account-logout-row" onClick={() => signOut(setError)}><span className="account-menu-icon">↪</span><strong>تسجيل الخروج</strong><span className="account-menu-arrow">‹</span></button>
        </section>
        <div className="account-sections">
          {activePanel === 'account' && <form className="account-panel" onSubmit={saveAccountName}><h2>بيانات الحساب</h2><Field label="اسمك" name="accountName" value={name} onChange={(event) => setName(event.target.value)} /><button type="submit" className="primary">حفظ الاسم</button></form>}
          {activePanel === 'password' && <form className="account-panel" onSubmit={savePassword}><h2>{passwordSet ? 'تغيير كلمة المرور' : 'تنبيه: عيّن كلمة مرور'}</h2>{!passwordSet && <p className="account-warning">حسابك يعمل حالياً عبر رابط البريد. عيّن كلمة مرور حتى تسجل الدخول بها لاحقاً.</p>}<Field label="كلمة المرور الجديدة" name="accountPassword" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} allowReveal /><Field label="تأكيد كلمة المرور" name="accountPasswordConfirm" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} allowReveal /><button type="submit" className="primary">{passwordSet ? 'تغيير كلمة المرور' : 'تعيين كلمة المرور'}</button></form>}
          {activePanel === 'policy' && <section className="account-panel account-policy"><h2>{settings.policyTitle}</h2><p>{settings.policyText}</p></section>}
          {activePanel === 'favorites' && <section className="account-panel account-favorites"><h2>خيارات الطلب المفضلة</h2>{favorites.map((item) => <div className="favorite-row" key={item.id}><button type="button" className="favorite-use" onClick={() => navigate(`/checkout?favorite=${item.id}`)}>{item.label}</button><button type="button" className="danger favorite-delete" onClick={() => deleteFavorite(item.id)}>حذف</button></div>)}{!favorites.length && <p className="account-muted">احفظ عنواناً ورقماً لتعبئتهما بسرعة عند الطلب.</p>}<form className="favorite-form" onSubmit={saveFavorite}><Field label="اسم الخيار" name="favoriteName" value={favoriteName} onChange={(event) => setFavoriteName(event.target.value)} placeholder="مثلاً: البيت" /><Field label="الاسم" name="customerName" value={favorite.customerName} onChange={updateFavoriteField} /><label className="field-label">المحافظة<select name="province" value={favorite.province} onChange={updateFavoriteField} required><option value="">اختر المحافظة</option>{provinces.map((province) => <option key={province} value={province}>{province}</option>)}</select></label><Field label="العنوان" name="address" value={favorite.address} onChange={updateFavoriteField} /><Field label="أقرب نقطة دالة" name="nearestLandmark" value={favorite.nearestLandmark} onChange={updateFavoriteField} /><Field label="رقم الهاتف" name="phoneNumber" type="tel" value={favorite.phoneNumber} onChange={updateFavoriteField} placeholder="07xxxxxxxxx" /><button type="submit" className="primary">حفظ الخيار</button></form></section>}
        </div>
        {message && <p className="success-message account-status">{message}</p>}
        {error && <p className="error account-status">{error}</p>}
      </main>
    </>
  );
}

function StoreNav({ settings }) {
  const { count } = useCart();
  const { user, profile } = useAuth();
  const storeName = settings.storeName || 'نسق';

  return (
    <header className="nav">
      <Link to="/" className="brand store-wordmark">
        <span>{storeName}</span>
        <small>{settings.tagline || 'اختيارات تصنع يومك'}</small>
      </Link>
      <nav>
        {!user && <Link to="/login">تسجيل الدخول</Link>}
        {user && <Link to="/account">الحساب</Link>}
        {profile?.role === 'admin' && <Link to="/admin">لوحة الإدارة</Link>}
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
  const [currentPage, setCurrentPage] = useState(1);
  const productsPerPage = 8;

  useEffect(() => {
    recordView('home').catch(() => {});
    listProducts()
      .then((data) => setProducts(Array.isArray(data) ? data : []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, []);

  const safeProducts = Array.isArray(products) ? products : [];
  const categoryNames = [...new Set(safeProducts.map((product) => product.category || 'عام'))];
  const categories = ['الكل', ...categoryNames];
  const categoryCards = categoryNames.map((name) => ({
    name,
    product: safeProducts.find((product) => (product.category || 'عام') === name),
  }));
  const featuredProducts = safeProducts.filter((product) => product.featured || Number(product.discountPercentage || 0) > 0).slice(0, 6);
  const promoProduct = featuredProducts[0] || safeProducts[0];
  const visibleProducts = safeProducts.filter((product) => {
    const matchesCategory = category === 'الكل' || product.category === category;
    const query = search.trim().toLowerCase();
    const matchesQuery = !query || product.name.toLowerCase().includes(query) || String(product.productCode || '').toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });
  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / productsPerPage));
  const sortedProducts = [...visibleProducts].sort((left, right) => (
    Number(right.featured) - Number(left.featured)
    || Number(right.isNew) - Number(left.isNew)
    || (Number(right.discountPercentage || 0) > 0 ? 1 : 0) - (Number(left.discountPercentage || 0) > 0 ? 1 : 0)
    || Number(right.id) - Number(left.id)
  ));
  const pagedProducts = sortedProducts.slice((currentPage - 1) * productsPerPage, currentPage * productsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, category]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  return (
    <>
      <StoreNav settings={settings} />
      <main>
        {settings.maintenanceMode && <div className="maintenance-banner">المتجر في وضع الصيانة: يمكنك تصفح المنتجات، والطلبات متوقفة مؤقتاً.</div>}
        <section className="hero store-hero">
          <div className="hero-copy">
            <p className="eyebrow">اختيارات اليوم</p>
            <h1>{settings.heroTitle}</h1>
            {settings.heroDescription && <p>{settings.heroDescription}</p>}
            <a href="#catalog" className="primary hero-cta">{settings.heroButtonText || 'تسوق الآن'}</a>
          </div>
          {promoProduct && <Link to={`/product/${promoProduct.id}`} className="hero-product-preview"><ProductImage src={promoProduct.imageUrl} alt={promoProduct.name} /><span>{promoProduct.name}</span></Link>}
        </section>

        <section id="catalog" className="catalog">
          {!!categoryCards.length && <div className="category-strip-section"><div className="section-head compact-head"><div><p className="eyebrow">تسوق حسب الفئة</p><h2>اختار ما يناسبك</h2></div></div><div className="category-strip"><button type="button" className={`category-tile ${category === 'الكل' ? 'active' : ''}`} onClick={() => setCategory('الكل')}><span className="category-tile-image category-all">كل</span><strong>الكل</strong></button>{categoryCards.map(({ name, product }) => <button type="button" className={`category-tile ${category === name ? 'active' : ''}`} key={name} onClick={() => setCategory(name)}><span className="category-tile-image"><ProductImage src={product?.imageUrl} alt={name} /></span><strong>{name}</strong></button>)}</div></div>}
          {!!featuredProducts.length && <section className="featured-shelf"><div className="section-head compact-head"><div><p className="eyebrow">مختارات نسق</p><h2>الأكثر طلباً</h2></div><button type="button" className="text-action" onClick={() => { setCategory('الكل'); setSearch(''); }}>عرض الكل</button></div><div className="featured-row">{featuredProducts.map((product) => <ProductCard key={product.id} product={product} maintenanceMode={settings.maintenanceMode} compact />)}</div></section>}
          <div className="section-head">
            <div>
              <p className="eyebrow">المنتجات</p>
            </div>
            <div className="filters">
              <input aria-label="بحث" placeholder="ابحث عن اسم المنتج أو الكود..." value={search} onChange={(event) => setSearch(event.target.value)} />
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
            <>
              <div className="product-grid">
                {pagedProducts.map((product) => <ProductCard key={product.id} product={product} maintenanceMode={settings.maintenanceMode} />)}
              </div>
              {totalPages > 1 && <div className="product-pagination">
                <button type="button" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => page - 1)}>السابق</button>
                <span>{totalPages} / {currentPage}</span>
                <button type="button" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => page + 1)}>التالي</button>
              </div>}
            </>
          )}
        </section>
      </main>
      <StoreFooter settings={settings} />
    </>
  );
}

function StoreFooter({ settings }) {
  const links = [
    ['instagramUrl', 'إنستغرام'],
    ['tiktokUrl', 'تيك توك'],
    ['facebookUrl', 'فيسبوك'],
    ['whatsappUrl', 'واتساب'],
  ].filter(([key]) => settings[key]);

  return (
    <footer className="store-footer">
      {settings.aboutText && <section className="about-footer">
        <h2>{settings.aboutTitle || 'من نحن؟'}</h2>
        <p>{settings.aboutText}</p>
      </section>}
      {links.length > 0 && <>
        <h2>حساباتنا</h2>
        <nav className="social-links" aria-label="روابط المتجر">
          {links.map(([key, label]) => <a href={settings[key]} target="_blank" rel="noreferrer" key={key}>{label}</a>)}
        </nav>
      </>}
      <p>تم التطوير بواسطة ZARKON TEAM</p>
    </footer>
  );
}

function ProductCard({ product, maintenanceMode = false, compact = false }) {
  const hasDiscount = Number(product.discountPercentage || 0) > 0;
  const unitPrice = Number(product.discountedPrice ?? product.price ?? 0);

  return (
    <article className={`product ${compact ? 'product-compact' : ''}`} key={product.id}>
      <Link to={`/product/${product.id}`} className="product-image">
        <ProductImage src={product.imageUrl} alt={product.name} />
        <div className="product-badges">
          {product.featured && <span className="product-badge featured-badge">مميز</span>}
          {product.isNew && <span className="product-badge new-badge">جديد</span>}
          {hasDiscount && <span className="product-badge offer-badge">توفير</span>}
        </div>
            {!product.inStock && <span className="sold">{maintenanceMode ? 'المتجر في وضع الصيانة' : 'طلب مسبق'}</span>}
      </Link>
      <div className="product-info">
        <span>{product.category}</span>
        {product.productCode && <small className="product-code">كود: {product.productCode}</small>}
        <Link to={`/product/${product.id}`} className="product-name"><h3>{product.name}</h3></Link>
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
  const [selectedVariants, setSelectedVariants] = useState({});
  const [similarProducts, setSimilarProducts] = useState([]);

  useEffect(() => {
    recordView('product').catch(() => {});

    setLoading(true);
    setError('');
    getProduct(id)
      .then((data) => {
        if (!data) throw new Error('تعذر تحميل المنتج');
        setProduct(data);
        setSelectedImage(data.productImages?.[0] || data.imageUrl || '');
        setSelectedVariants({});
        setLoading(false);
        listProducts()
          .then((products) => setSimilarProducts(products.filter((item) => item.id !== data.id && item.category === data.category).slice(0, 4)))
          .catch(() => setSimilarProducts([]));
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
  const variantsComplete = (product.variants || []).every((variant) => selectedVariants[variant.name]);

  return (
    <>
      <StoreNav settings={settings} />
      <main className="detail-page">
        <div className="product-detail-layout">
          <div className="detail-image-wrap">
            <ProductImage src={selectedImage} alt={product.name} />
            <div className="detail-thumbnails">
              {(Array.isArray(product.productImages) && product.productImages.length ? product.productImages : [product.imageUrl]).filter(Boolean).map((image, index) => (
                <button type="button" className={selectedImage === image ? 'selected' : ''} key={`${image}-${index}`} onClick={() => setSelectedImage(image)}>
                  <ProductImage src={image} alt={`${product.name} ${index + 1}`} />
                </button>
              ))}
            </div>
          </div>
          <div className="detail-content">
            <div className="detail-kicker"><span className="category-badge">{product.category}</span>{product.productCode && <span className="product-code">كود: {product.productCode}</span>}{hasDiscount && <span className="detail-discount">-{Math.round(Number(product.discountPercentage))}%</span>}</div>
            <h1>{product.name}</h1>
            <div className="price-stack">
              {hasDiscount ? <><span className="old-price">{money(product.price)}</span><strong>{money(finalPrice)}</strong></> : <strong>{money(product.price)}</strong>}
            </div>
            <div className={`status-pill ${settings.maintenanceMode ? 'maintenance' : (product.inStock ? 'available' : 'unavailable')}`}>
              {settings.maintenanceMode ? 'المتجر في وضع الصيانة' : (product.inStock ? `متوفر في المخزون: ${product.stockQuantity} قطعة` : 'طلب مسبق')}
            </div>
            <p className="detail-description">{product.description}</p>
            {Array.isArray(product.variants) && product.variants.length > 0 && <div className="detail-variants">{product.variants.map((variant) => <label className="field-label" key={variant.name}>{variant.name}<select value={selectedVariants[variant.name] || ''} onChange={(event) => setSelectedVariants((current) => ({ ...current, [variant.name]: event.target.value }))} required><option value="">اختر {variant.name}</option>{variant.values.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}</div>}
            <div className="detail-promises">
              <div><span>🚚</span><strong>توصيل لكل المحافظات</strong><small>ننسق معك قبل التجهيز</small></div>
              <div><span>💵</span><strong>الدفع عند الاستلام</strong><small>ادفع عند وصول طلبك</small></div>
            </div>
            <div className="quantity-row">
              <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button>
              <span>{quantity}</span>
              <button type="button" onClick={() => setQuantity((value) => value + 1)}>+</button>
            </div>
            <AddToCartButton product={{ ...product, selectedVariants }} quantity={quantity} disabled={!product.inStock || settings.maintenanceMode || !variantsComplete} className="primary block" label="أضف للسلة" disabledLabel={settings.maintenanceMode ? 'المتجر في وضع الصيانة' : (!variantsComplete ? 'اختر الخيارات أولاً' : 'غير متوفر')} />
            <Link to="/" className="back-link">العودة إلى المتجر</Link>
          </div>
        </div>
        {similarProducts.length > 0 && <section className="similar-products">
          <div className="similar-heading"><div><p className="eyebrow">قد يعجبك أيضاً</p><h2>منتجات مشابهة</h2></div><Link to="/" className="back-link">عرض الكل</Link></div>
          <div className="product-grid">{similarProducts.map((item) => <ProductCard key={item.id} product={item} maintenanceMode={settings.maintenanceMode} />)}</div>
        </section>}
      </main>
    </>
  );
}

function Field({ label, name, type = 'text', inputMode, value, onChange, placeholder, required = true, allowReveal = false, onKeyDown }) {
  const [revealed, setRevealed] = useState(false);
  const inputType = allowReveal && revealed ? 'text' : type;
  const changeHandler = typeof onChange === 'function' ? onChange : undefined;
  const keyDownHandler = typeof onKeyDown === 'function' ? onKeyDown : undefined;
  return (
    <label className="field-label">
      {label}
      <span className="input-with-action">
        <input name={name} type={inputType} inputMode={inputMode} value={value} onChange={changeHandler} onKeyDown={keyDownHandler} placeholder={placeholder} required={required} />
        {allowReveal && <button type="button" className="reveal-password" onClick={() => setRevealed((current) => !current)} aria-label={revealed ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>{revealed ? 'إخفاء' : 'إظهار'}</button>}
      </span>
    </label>
  );
}

function Checkout() {
  const settings = useSiteSettings();
  const { cart, subtotal, updateItem, clearCart } = useCart();
  const { user } = useAuth();
  const [form, setForm] = useState({ customerName: '', province: '', address: '', nearestLandmark: '', phoneNumber: '', discountCode: '' });
  const [discount, setDiscount] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const navigate = useNavigate();
  const needsPassword = Boolean(user && user.user_metadata?.password_set !== true);

  useEffect(() => {
    const favoriteId = new URLSearchParams(window.location.search).get('favorite');
    const favorites = Array.isArray(user?.user_metadata?.saved_addresses) ? user.user_metadata.saved_addresses : [];
    const selected = favorites.find((item) => String(item.id) === favoriteId);
    if (!selected) return;
    setForm((current) => ({ ...current, ...selected, discountCode: current.discountCode }));
  }, [user]);

  const delivery = form.province && form.province !== 'بغداد' ? 5000 : 3000;
  const discountAmount = discount ? (discount.type === 'percentage' ? subtotal * Number(discount.value || 0) / 100 : Math.min(Number(discount.value || 0), subtotal)) : 0;
  const total = subtotal - discountAmount + delivery;

  const handleChange = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  const applyDiscount = async () => {
    if (!form.discountCode.trim()) return;
    const data = await validateDiscount(form.discountCode.trim());
    setDiscount(data || null);
    if (!data) {
      setError('كود الخصم غير صالح أو غير فعال');
      return;
    }
    if (user) {
      saveCoupon(user.id, data.id).catch(() => {});
    }
  };

  const submitOrder = async (event) => {
    event.preventDefault();
    setError('');
    if (!user) return setError('لا يمكنك إكمال الطلب إلا بعد تسجيل الدخول');
    if (needsPassword) return setError('قبل إرسال الطلب، اذهب إلى الحساب وعيّن كلمة مرور أولاً.');
    if (settings.maintenanceMode) return setError('الطلبات متوقفة مؤقتاً بسبب الصيانة');

    if (!/^07\d{9}$/.test(form.phoneNumber)) return setError('يرجى إدخال رقم هاتف عراقي صحيح');
    if (!form.customerName || !form.province || !form.address || !form.nearestLandmark) return setError('يرجى إكمال جميع الحقول المطلوبة');
    if (!cart.length) return setError('السلة فارغة');

    const payload = {
      items: (Array.isArray(cart) ? cart : []).map((item) => ({ productId: item.id, name: item.name, price: Number(item.price || 0), quantity: Number(item.quantity || 0), selectedVariants: item.selectedVariants || {} })),
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

    try {
      const orderId = await createOrder(payload, user.id);
      clearCart();
      setDone(orderId);
    } catch (reason) {
      setError(reason.message || 'تعذر إرسال الطلب');
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
          <Link to="/" className="back-link">الرجوع إلى المتجر</Link>
        </div>

        {!cart.length ? (
          <div className="empty">السلة فارغة حالياً. <Link to="/">تصفح المنتجات</Link></div>
        ) : (
          <div className="checkout-layout">
            <form className="order-form" onSubmit={submitOrder}>
              {Array.isArray(user?.user_metadata?.saved_addresses) && user.user_metadata.saved_addresses.length > 0 && <label className="field-label">استخدم خياراً محفوظاً<select value="" onChange={(event) => {
                const selected = user.user_metadata.saved_addresses.find((item) => String(item.id) === event.target.value);
                if (selected) setForm((current) => ({ ...current, ...selected, discountCode: current.discountCode }));
              }}><option value="">اختر خياراً محفوظاً</option>{user.user_metadata.saved_addresses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
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
              {error && <p className="error">{error}{!user && <>. <Link to="/login">تسجيل الدخول</Link></>}{needsPassword && <><br /><Link to="/account">الذهاب إلى الحساب وتعيين كلمة المرور</Link></>}</p>}
              <button type="submit" className="primary full" disabled={settings.maintenanceMode}>{settings.maintenanceMode ? 'الطلبات متوقفة للصيانة' : 'تأكيد وإرسال الطلب'}</button>
            </form>

            <aside className="receipt">
              <h2>ملخص الطلب</h2>
              {(Array.isArray(cart) ? cart : []).map((item) => (
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
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return undefined;
    getAccountOrders(user.id)
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
    return undefined;
  }, [user]);

  const statusLabels = { new: 'جديد', processing: 'قيد التجهيز', delivered: 'تم التوصيل', cancelled: 'ملغي' };
  return (
    <>
      <StoreNav settings={useSiteSettings()} />
      <main className="account-orders">
        <p className="eyebrow">حسابي</p>
        <h1>طلباتي</h1>
        <Link to="/" className="back-link">الرجوع إلى المتجر</Link>
        {loading ? <div className="empty">جاري تحميل الطلبات...</div> : !orders.length ? <div className="empty">لا توجد طلبات</div> : (
          <div className="account-order-list">
            {(Array.isArray(orders) ? orders : []).map((order) => <article className={`account-order status-${order.status}`} key={order.id}>
              <div className="account-order-heading"><div><strong>طلب #{order.accountOrderNumber || order.id}</strong><small>{new Date(order.createdAt).toLocaleString('ar-IQ')}</small></div><span className="account-order-status">{statusLabels[order.status] || order.status}</span></div>
              <div className="account-order-items">{(Array.isArray(order.items) ? order.items : []).map((item) => <div key={`${order.id}-${item.productId}`}><span>{item.name} × {item.quantity}{selectedVariantText(item.selectedVariants) && <small>{selectedVariantText(item.selectedVariants)}</small>}</span><strong>{money(Number(item.price || 0) * Number(item.quantity || 0))}</strong></div>)}</div>
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

  const signInWithGoogle = async () => {
    setError('');
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: authRedirectUrl() },
      });
      if (authError) setError(authErrorMessage(authError, 'تعذر تسجيل الدخول بجوجل. حاول مرة أخرى.'));
    } catch {
      setError('تعذر تسجيل الدخول بجوجل حالياً. حاول مرة أخرى.');
    }
  };

  const sendMagicLink = async () => {
    const email = identifier.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setError('أدخل بريداً إلكترونياً صحيحاً لإرسال رابط الدخول');
      return false;
    }
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: authRedirectUrl(),
        },
      });
      if (authError) {
        setError(authErrorMessage(authError, 'تعذر إرسال رابط الدخول. حاول مرة أخرى.'));
        return false;
      }
      setMessage('تم إرسال رابط الدخول إلى بريدك الإلكتروني، يرجى الضغط عليه لإكمال التسجيل.');
      return true;
    } catch {
      setError('تعذر إرسال رابط الدخول حالياً. حاول مرة أخرى.');
      return false;
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (user) {
      navigate(profile?.role === 'admin' ? '/admin' : '/');
      return;
    }
    const value = identifier.trim();
    const phone = /^07\d{9}$/.test(value) ? `+964${value.slice(1)}` : value;
    const isPhone = /^\+9647\d{9}$/.test(phone);
    if (mode === 'register' && !isPhone) {
      await sendMagicLink();
      return;
    }
    const credentials = isPhone ? { phone, password } : { email: value.toLowerCase(), password };
    let result;
    try {
      result = mode === 'login'
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp(credentials);
    } catch {
      setError('تعذر الاتصال بخدمة تسجيل الدخول. حاول مرة أخرى.');
      return;
    }
    if (result.error) {
      setError(authErrorMessage(result.error, 'تعذر إتمام العملية. حاول مرة أخرى.'));
      return;
    }
    if (mode === 'login' || (mode === 'register' && isPhone)) {
      supabase.auth.updateUser({ data: { password_set: true } }).catch(() => {});
    }
    if (mode === 'register') {
      setMessage('تم إنشاء الحساب. يمكنك تسجيل الدخول الآن.');
      setMode('login');
      setPassword('');
      return;
    }
    navigate('/');
  };

  const { user, profile, loading } = useAuth();
  const isPhoneRegistration = /^(07\d{9}|\+9647\d{9})$/.test(identifier.trim());
  if (!loading && user) {
    return <Navigate to={profile?.role === 'admin' ? '/admin' : '/'} replace />;
  }

  return (
    <main className="login-page">
      <Link to="/" className="brand">نسق</Link>
      <form className="login-card" onSubmit={submit}>
        <div className="auth-mode-switch" role="tablist" aria-label="تبديل نوع الحساب">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); setMessage(''); }}>تسجيل الدخول</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); setMessage(''); }}>إنشاء حساب</button>
        </div>
        <h1>{mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}</h1>
        <Field label="البريد الإلكتروني أو رقم الهاتف" name="identifier" type="text" inputMode="email" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
        {(mode === 'login' || isPhoneRegistration) && <Field label="كلمة المرور" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => setCapsLock(event.getModifierState('CapsLock'))} allowReveal />}
        {capsLock && <p className="caps-lock-message">الأحرف الكبيرة مفعلة</p>}
        {error && <p className="error">{error}</p>}
        {message && <p className="success-message">{message}</p>}
        <button type="submit" className="primary full">{mode === 'login' ? 'تسجيل الدخول' : 'إرسال رابط الدخول'}</button>
        {mode === 'login' && error && <button type="button" className="back" onClick={sendMagicLink}>إرسال رابط دخول جديد إلى البريد</button>}
        {mode === 'login' && <div className="google-login-section">
          <span>أو</span>
          <button type="button" className="google-button" onClick={signInWithGoogle}>تسجيل الدخول باستخدام Google</button>
        </div>}
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
  const { user, profile, loading } = useAuth();
  const [logoutError, setLogoutError] = useState('');

  if (loading) return <div className="empty">جاري التحقق من الحساب...</div>;
  if (!user || profile?.role !== 'admin') {
    return <Login />;
  }

  const titleMap = {
    overview: 'نظرة عامة',
    products: 'المنتجات',
    orders: 'الطلبات',
    discounts: 'أكواد الخصم',
    analytics: 'الإحصائيات',
    settings: 'إعدادات المتجر',
    admins: 'المشرفون',
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
        <Link className={page === 'admins' ? 'active' : ''} to="/admin/admins">المشرفون</Link>
        <button type="button" className="logout" onClick={async () => { if (await signOut(setLogoutError)) navigate('/'); }}>تسجيل الخروج</button>
        {logoutError && <p className="error">{logoutError}</p>}
      </aside>

      <section className="admin-content">
        <div className="admin-top">
          <div>
            <p className="eyebrow"></p>
            <h1>{titleMap[page] || 'لوحة الإدارة'}</h1>
          </div>
          <Link to="/" className="view-store">عرض المتجر ↗</Link>
        </div>

        {page === 'products' ? <ProductsAdmin /> : page === 'orders' ? <OrdersAdmin /> : page === 'discounts' ? <DiscountsAdmin /> : page === 'analytics' ? <AnalyticsAdmin /> : page === 'settings' ? <SiteSettingsAdmin /> : page === 'admins' ? <AdminsAdmin /> : <Overview />}
      </section>
    </div>
  );
}

function Overview() {
  const [stats, setStats] = useState({ totalViews: 0, currentRevenue: 0, growth: 0, totalProfit: 0, totalLosses: 0, homeViews: 0, productViews: 0, orderStats: {} });

  useEffect(() => {
    Promise.all([
      analytics(),
      listOrders(),
      unreadOrderCount(),
    ])
      .then(([analyticsData, orders, unreadCount]) => {
        setStats({ ...analyticsData, orderCount: Array.isArray(orders) ? orders.length : 0, unreadCount });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="dashboard-overview">
      <div className="stats">
        <div><span>مبيعات هذا الشهر</span><strong>{money(stats.currentRevenue)}</strong></div>
        <div><span>الطلبات الكلية</span><strong>{stats.orderStats?.total || 0}</strong></div>
        <div><span>طلبات مكتملة</span><strong>{stats.orderStats?.delivered || 0}</strong></div>
        <div><span>الزيارات</span><strong>{stats.totalViews || 0}</strong></div>
        <div className="highlight"><span>صافي الأرباح</span><strong>{money(stats.totalProfit)}</strong></div>
      </div>
    </div>
  );
}

function ProductsAdmin() {
  const emptyForm = { name: '', productCode: '', description: '', price: '', costPrice: '', discountPercentage: '', category: '', imageUrl: '', productImages: [], variants: [], variantsText: '', stockQuantity: 10, inStock: true, featured: false, isNew: false };
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [primaryImageFile, setPrimaryImageFile] = useState(null);
  const [additionalImageFiles, setAdditionalImageFiles] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await adminProducts();
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
    setPrimaryImageFile(null);
    setAdditionalImageFiles([]);
    setEditingId(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');
    const save = editingId ? updateProduct : createProduct;
    await save({ ...form, variants: parseVariantLines(form.variantsText), productImages: Array.isArray(form.productImages) ? form.productImages : [] }, primaryImageFile, additionalImageFiles);

    resetForm();
    setMessage(editingId ? 'تم تحديث المنتج' : 'تمت إضافة المنتج');
    await load();
  };

  const handleDelete = async (id) => {
    try {
      await deleteProduct(id);
    } catch {
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
      productCode: product.productCode || '',
      description: product.description,
      price: product.price,
      costPrice: product.costPrice ?? 0,
      discountPercentage: product.discountPercentage ?? 0,
      category: product.category,
      imageUrl: product.imageUrl || '',
      productImages: product.productImages || [],
      variants: product.variants || [],
      variantsText: variantsToText(product.variants),
      stockQuantity: product.stockQuantity ?? 0,
      inStock: product.inStock,
      featured: Boolean(product.featured),
      isNew: Boolean(product.isNew),
    });
    setPrimaryImageFile(null);
    setAdditionalImageFiles([]);
  };

  return (
    <>
      <form className="admin-form" onSubmit={submit}>
        <h2>{editingId ? 'تعديل المنتج' : 'إضافة منتج'}</h2>
        <input placeholder="اسم المنتج" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input placeholder="كود المنتج (مثلاً: PRD-001)" value={form.productCode} onChange={(event) => setForm({ ...form, productCode: event.target.value })} />
        <input placeholder="سعر البيع" type="number" required value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
        <input placeholder="سعر الشراء" type="number" value={form.costPrice} onChange={(event) => setForm({ ...form, costPrice: event.target.value })} />
        <label className="field-label">نسبة الخصم %<input aria-label="نسبة الخصم" placeholder="0 بدون خصم" type="number" min="0" max="100" value={form.discountPercentage} onChange={(event) => setForm({ ...form, discountPercentage: event.target.value })} /></label>
        <input placeholder="التصنيف" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
        <textarea className="variants-input" placeholder={'المتغيرات، سطر لكل خيار: مثال\nاللون: أبيض، أسود\nالمقاس: S، M، L'} value={form.variantsText} onChange={(event) => setForm({ ...form, variantsText: event.target.value })} />
        <label className="field-label">الكمية في المخزون<input type="number" min="0" value={form.stockQuantity} onChange={(event) => setForm({ ...form, stockQuantity: event.target.value })} /></label>
        <label className="check-label"><input type="checkbox" checked={form.featured} onChange={(event) => setForm({ ...form, featured: event.target.checked })} />منتج مميّز ويظهر أولاً</label>
        <label className="check-label"><input type="checkbox" checked={form.isNew} onChange={(event) => setForm({ ...form, isNew: event.target.checked })} />منتج جديد</label>
        <label className="field-label">الصورة الرئيسية<input type="file" accept="image/*" onChange={(event) => setPrimaryImageFile(event.target.files?.[0] || null)} /></label>
        <label className="field-label">صور إضافية<input type="file" accept="image/*" multiple onChange={(event) => setAdditionalImageFiles(Array.from(event.target.files || []))} /></label>
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
        {(Array.isArray(items) ? items : []).map((product) => (
          <div className="table-row product-row" key={product.id}>
            <ProductImage src={product.imageUrl} alt={product.name} />
            <strong>{product.name}</strong>
            <span>{product.productCode ? `كود: ${product.productCode}` : 'بدون كود'}</span>
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

  const load = () => adminProducts().then((data) => setItems(Array.isArray(data) ? data : []));

  useEffect(() => { load(); }, []);

  const updateDiscount = (productId, value) => {
    setItems((current) => (Array.isArray(current) ? current : []).map((product) => product.id === productId ? { ...product, discountPercentage: Number(value || 0) } : product));
  };

  const saveProduct = async (product) => {
    await updateProduct(product.id, product);
    load();
  };

  return (
    <div className="admin-table">
      <div className="table-title">
        <h2>خصومات المنتجات</h2>
        <span>{items.length} منتج</span>
      </div>
      {(Array.isArray(items) ? items : []).map((product) => {
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

  const load = () => listOrders().then((data) => setOrders(Array.isArray(data) ? data : []));

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  const changeOrderStatus = async (id, status) => {
    await updateOrder(id, { status, isRead: true });
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

      {(Array.isArray(visibleOrders) ? visibleOrders : []).map((order) => (
        <article className={`order-card status-${order.status} ${order.isRead ? '' : 'unread-order'}`} key={order.id}>
          <div className="order-card-head">
            <div>
              <span className="order-id">طلب #{order.id}</span>
              <small>{new Date(order.createdAt).toLocaleString('ar-IQ')}</small>
              {!order.isRead && <b className="unread-badge">طلب غير مقروء</b>}
            </div>
            <select value={order.status} onChange={(event) => changeOrderStatus(order.id, event.target.value)}>
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
            {(Array.isArray(order.items) ? order.items : []).map((item) => <span key={`${order.id}-${item.productId}`}>{item.name} × {item.quantity}{selectedVariantText(item.selectedVariants) && ` (${selectedVariantText(item.selectedVariants)})`}</span>)}
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

  const load = () => listDiscounts().then((data) => setItems(Array.isArray(data) ? data : []));

  useEffect(() => { load(); }, []);

  const save = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await createDiscount(form);
    } catch (reason) {
      setError(reason.message || 'تعذر إضافة الكود');
      return;
    }
    setForm({ code: '', type: 'percentage', value: 10 });
    setMessage('تمت إضافة كود الخصم');
    load();
  };

  const toggle = async (discount) => {
    await updateDiscount(discount.id, { ...discount, active: !discount.active });
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
        {(Array.isArray(items) ? items : []).map((discount) => (
          <div className="table-row" key={discount.id}>
            <strong>{discount.code}</strong>
            <span>{discount.type === 'percentage' ? 'نسبة مئوية' : 'مبلغ ثابت'}</span>
            <span>{discount.value}{discount.type === 'percentage' ? '%' : ' د.ع'}</span>
            <span className={discount.active ? 'active-status' : 'inactive-status'}>{discount.active ? 'فعال' : 'متوقف'}</span>
            <div className="inline-actions">
              <button type="button" onClick={() => toggle(discount)}>{discount.active ? 'إيقاف' : 'تفعيل'}</button>
              <button type="button" className="danger" onClick={() => deleteDiscount(discount.id).then(load)}>حذف</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function AnalyticsAdmin() {
  const [stats, setStats] = useState({ totalViews: 0, homeViews: 0, productViews: 0, currentRevenue: 0, lastRevenue: 0, growth: 0, totalProfit: 0, totalLosses: 0, orderStats: {} });
  const [accountsTotal, setAccountsTotal] = useState(0);

  useEffect(() => {
    Promise.all([
      analytics(),
      accountCount(),
    ])
      .then(([analyticsData, accounts]) => {
        setStats(analyticsData || {});
        setAccountsTotal(typeof accounts === 'number' ? accounts : 0);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="stats analytics-grid">
      <div><span>إجمالي زيارات الموقع</span><strong>{stats.homeViews || 0}</strong></div>
      <div><span>زيارات المنتجات</span><strong>{stats.productViews || 0}</strong></div>
      <div><span>إيرادات هذا الشهر</span><strong>{money(stats.currentRevenue)}</strong></div>
      <div><span>نسبة النمو</span><strong>{stats.growth || 0}%</strong></div>
      <div><span>الأرباح</span><strong>{money(stats.totalProfit)}</strong></div>
      <div><span>الحسابات المسجلة</span><strong>{accountsTotal}</strong></div>
    </div>
  );
}

function AdminsAdmin() {
  const [data, setData] = useState({ admins: [], invites: [] });
  const [identifier, setIdentifier] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = () => listAdmins()
    .then((result) => ({
      admins: Array.isArray(result?.admins) ? result.admins : [],
      invites: Array.isArray(result?.invites) ? result.invites : [],
    }))
    .then(setData)
    .catch(() => setData({ admins: [], invites: [] }));
  useEffect(() => { load(); }, []);

  const addAdmin = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      const result = await inviteAdmin(identifier);
      setIdentifier('');
      setMessage(result?.role === 'admin' ? 'تم تحويل الحساب إلى مشرف' : 'تم حفظ الدعوة، سيصبح مشرفاً عند إنشاء الحساب');
    } catch (reason) {
      setError(reason.message || 'تعذر إضافة المشرف');
      return;
    }
    load();
  };

  const handleRemoveAdmin = async (value) => {
    await removeAdmin(value);
    load();
  };

  return (
    <div className="admin-managers">
      <div className="admin-table">
        <div className="table-title manager-title"><h2>المشرفون</h2><button type="button" className="manager-add-button" onClick={() => { setShowAddForm((value) => !value); setMessage(''); setError(''); }}>+</button></div>
        {(Array.isArray(data.admins) ? data.admins : []).map((admin) => <div className="table-row manager-row" key={admin.id}><strong>{admin.identifier}</strong>{admin.isOwner ? <span className="owner-label">مالك</span> : <><span>مشرف</span><button type="button" className="danger" onClick={() => handleRemoveAdmin(admin.identifier)}>إزالة</button></>}</div>)}
        {!data.admins.length && <p className="empty">لا يوجد مشرفون</p>}
      </div>

      {showAddForm && <form className="admin-form compact manager-add-form" onSubmit={addAdmin}>
        <input type="email" inputMode="email" placeholder="البريد الإلكتروني" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required />
        <button type="submit" className="primary">إضافة</button>
        {message && <p className="success-message">{message}</p>}
        {error && <p className="error">{error}</p>}
      </form>}

      {!!(Array.isArray(data.invites) && data.invites.length) && <div className="admin-table"><div className="table-title"><h2>الدعوات المعلقة</h2></div>{(Array.isArray(data.invites) ? data.invites : []).map((invite) => <div className="table-row manager-row" key={invite.identifier}><strong>{invite.identifier}</strong><span>بانتظار التسجيل</span><button type="button" className="danger" onClick={() => handleRemoveAdmin(invite.identifier)}>إلغاء</button></div>)}</div>}
    </div>
  );
}

function SiteSettingsAdmin() {
  const [settings, setSettings] = useState(defaultSettings);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusError, setStatusError] = useState('');
  const lastSavedSettings = useRef('');

  const loadSettings = () => {
    getSiteSettings()
      .then((data) => {
        const nextSettings = { ...defaultSettings, ...data };
        lastSavedSettings.current = JSON.stringify(nextSettings);
        setSettings(nextSettings);
      })
      .catch(() => {
        lastSavedSettings.current = JSON.stringify(defaultSettings);
        setSettings(defaultSettings);
      });
  };

  const saveSettings = async (nextSettings, automatic = false) => {
    setStatusMessage('');
    setStatusError('');
    try {
      const data = await saveSiteSettings(nextSettings);
      const savedSettings = { ...defaultSettings, ...data };
      lastSavedSettings.current = JSON.stringify(savedSettings);
      setSettings(savedSettings);
      if (!automatic) setStatusMessage('تم حفظ إعدادات المتجر');
    } catch (reason) {
      setStatusError(reason.message || 'تعذر حفظ إعدادات المتجر');
      return;
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    const serializedSettings = JSON.stringify(settings);
    if (!lastSavedSettings.current || serializedSettings === lastSavedSettings.current) return undefined;
    const timer = setTimeout(() => saveSettings(settings, true), 700);
    return () => clearTimeout(timer);
  }, [settings]);

  const save = (event) => {
    event.preventDefault();
    saveSettings(settings);
  };

  const resetStore = async () => {
    const confirmed = window.confirm('هل أنت متأكد؟ سيؤدي هذا إلى حذف المنتجات والطلبات والإحصائيات والخصومات وكل بيانات المتجر، مع الاحتفاظ بحسابات المديرين.');
    if (!confirmed) return;

    setStatusMessage('');
    setStatusError('');

    try {
      await resetStoreData();
    } catch (reason) {
      setStatusError(reason.message || 'تعذر إعادة ضبط المتجر');
      return;
    }

    setStatusMessage('تمت إعادة ضبط المتجر');
    loadSettings();
  };

  return (
    <form className="admin-form settings-form" onSubmit={save}>
      <h2>إعدادات المتجر</h2>
      <input placeholder="اسم المتجر" value={settings.storeName} onChange={(event) => setSettings({ ...settings, storeName: event.target.value })} />
      <input placeholder="الشعار / العنوان الفرعي" value={settings.tagline} onChange={(event) => setSettings({ ...settings, tagline: event.target.value })} />
      <input placeholder="عنوان الهيرو" value={settings.heroTitle} onChange={(event) => setSettings({ ...settings, heroTitle: event.target.value })} />
      <textarea placeholder="وصف الهيرو" value={settings.heroDescription} onChange={(event) => setSettings({ ...settings, heroDescription: event.target.value })} />
      <input placeholder="رابط إنستغرام" value={settings.instagramUrl} onChange={(event) => setSettings({ ...settings, instagramUrl: event.target.value })} />
      <input placeholder="رابط تيك توك" value={settings.tiktokUrl} onChange={(event) => setSettings({ ...settings, tiktokUrl: event.target.value })} />
      <input placeholder="رابط فيسبوك" value={settings.facebookUrl} onChange={(event) => setSettings({ ...settings, facebookUrl: event.target.value })} />
      <input placeholder="رابط واتساب" value={settings.whatsappUrl} onChange={(event) => setSettings({ ...settings, whatsappUrl: event.target.value })} />
      <input placeholder="عنوان قسم من نحن" value={settings.aboutTitle} onChange={(event) => setSettings({ ...settings, aboutTitle: event.target.value })} />
      <textarea placeholder="نص من نحن" value={settings.aboutText} onChange={(event) => setSettings({ ...settings, aboutText: event.target.value })} />
      <input placeholder="عنوان سياستنا" value={settings.policyTitle} onChange={(event) => setSettings({ ...settings, policyTitle: event.target.value })} />
      <textarea placeholder="نص سياستنا" value={settings.policyText} onChange={(event) => setSettings({ ...settings, policyText: event.target.value })} />
      <label className="maintenance-control"><input type="checkbox" checked={Boolean(settings.maintenanceMode)} onChange={(event) => setSettings({ ...settings, maintenanceMode: event.target.checked })} /><span><strong>وضع الصيانة</strong><small>السماح بتصفح المنتجات مع إيقاف إضافة المنتجات وإرسال الطلبات</small></span></label>
      <button type="submit" className="primary">حفظ الإعدادات</button>
      <button type="button" className="danger" onClick={resetStore}>إعادة ضبط المتجر</button>
      {statusMessage && <p className="success-message">{statusMessage}</p>}
      {statusError && <p className="error">{statusError}</p>}
    </form>
  );
}

export default App;
