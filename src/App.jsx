import { useEffect, useRef, useState, createContext, useContext } from 'react';
import { Routes, Route, Link, useNavigate, useLocation, Navigate, useParams } from 'react-router-dom';
import { supabase } from './lib/supabaseClient';
import {
  accountCount, adminProducts, analytics, createDiscount, createOrder, createProduct, deleteDiscount, deleteProduct,
  defaultSettings, getAccountOrders, getCart, getProduct, getSiteSettings, inviteAdmin, listAdmins, listDiscounts,
  listOrders, listProducts, moveProductsToCategory, recordView, removeAdmin, resetStore as resetStoreData, saveCart, saveCoupon,
  saveSiteSettings, updateDiscount, unreadOrderCount, updateOrder, updateProduct, uploadCategoryImage, validateDiscount,
} from './lib/supabaseData';

const mediaUrl = (value) => {
  const source = String(value || '').trim();
  if (!source || source.startsWith('blob:')) return '';
  return source;
};
const provinces = ['بغداد','البصرة','نينوى','أربيل','النجف','كربلاء','كركوك','السليمانية','دهوك','الأنبار','بابل','ذي قار','ديالى','الديوانية','ميسان','المثنى','صلاح الدين','واسط'];
const money = (value) => `${new Intl.NumberFormat('ar-IQ').format(Number(value || 0))} د.ع`;
const productDiscountValue = (product) => Number(product?.discountValue ?? product?.discountPercentage ?? 0);
const hasProductDiscount = (product) => productDiscountValue(product) > 0;
const getProductDiscountedPrice = (product) => {
  const price = Number(product?.price || 0);
  const value = Math.max(0, productDiscountValue(product));
  return Number((product?.discountType === 'amount' ? Math.max(0, price - value) : price * (1 - Math.min(value, 100) / 100)).toFixed(2));
};
const productDiscountLabel = (product) => product?.discountType === 'amount'
  ? `-${money(productDiscountValue(product))}`
  : `-${Math.round(productDiscountValue(product))}%`;
const productAvailabilityMode = (product) => product?.availabilityMode
  || (Number(product?.stockQuantity ?? 0) <= 0 ? 'unavailable' : (product?.inStock ? 'ready' : 'preorder'));
const variantChoiceLabel = (choice) => String(typeof choice === 'object' ? choice?.label ?? choice?.value ?? '' : choice ?? '').trim();
const variantChoicePrice = (choice) => Number(typeof choice === 'object' ? choice?.price || 0 : 0);
const productVariantPresets = [
  { name: 'اللون', values: ['أسود', 'أبيض', 'بني'] },
  { name: 'الوزن', values: ['250 غرام', '500 غرام', '1 كيلوغرام'] },
  { name: 'الحجم', values: ['صغير', 'وسط', 'كبير'] },
];
const selectedChoices = (variant, selection) => {
  const values = Array.isArray(selection) ? selection : (selection ? [selection] : []);
  return values.map((value) => (variant.values || []).find((choice) => variantChoiceLabel(choice) === value)).filter(Boolean);
};
const getProductOptionPrice = (product, selectedVariants) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const replacementVariant = variants.find((variant) => variant.priceMode === 'replace' && selectedVariants[variant.name]);
  const replacementChoice = replacementVariant && selectedChoices(replacementVariant, selectedVariants[replacementVariant.name])[0];
  const basePrice = replacementChoice ? variantChoicePrice(replacementChoice) : Number(product?.price || 0);
  const discountValue = Math.max(0, productDiscountValue(product));
  const discountedBase = product?.discountType === 'amount'
    ? Math.max(0, basePrice - discountValue)
    : basePrice * (1 - Math.min(discountValue, 100) / 100);
  const extras = variants
    .filter((variant) => variant.priceMode !== 'replace')
    .flatMap((variant) => selectedChoices(variant, selectedVariants[variant.name]))
    .reduce((total, choice) => total + variantChoicePrice(choice), 0);
  return Number((discountedBase + extras).toFixed(2));
};
const selectedVariantText = (variants) => Object.entries(variants || {}).map(([name, value]) => `${name}: ${value}`).join('، ');
const variantKey = (variants) => JSON.stringify(variants || {});
const cartItemKey = (item) => `${item.id}-${variantKey(item.selectedVariants)}`;
const getStoreCategories = (configuredCategories, products) => {
  const productNames = [...new Set(products.map((product) => String(product.category || '').trim()).filter(Boolean))];
  const source = Array.isArray(configuredCategories) ? configuredCategories : productNames.map((name) => ({ name }));
  const categories = [];
  const seenNames = new Set();
  source.forEach((category) => {
    const name = String(category?.name || '').trim();
    const normalizedName = name.toLocaleLowerCase();
    if (!name || seenNames.has(normalizedName)) return;
    categories.push({ id: String(category?.id || `category-${name}`), name, imageUrl: mediaUrl(category?.imageUrl) });
    seenNames.add(normalizedName);
  });
  productNames.forEach((name) => {
    const normalizedName = name.toLocaleLowerCase();
    if (seenNames.has(normalizedName)) return;
    categories.push({ id: `category-${name}`, name, imageUrl: '' });
    seenNames.add(normalizedName);
  });
  return categories;
};
const authRedirectUrl = () => typeof window !== 'undefined'
  ? window.location.origin
  : import.meta.env.VITE_PUBLIC_APP_URL || '';
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
const supabaseErrorMessage = (error, fallback) => {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  if (code === 'PGRST116' || message.includes('cannot coerce the result to a single json object')) {
    return 'لم يرجع Supabase سجل الإعدادات بعد الحفظ. قد تمنع صلاحية RLS التعديل، أو قد يكون سجل الإعدادات غير موجود.';
  }
  if (code === '42501' || message.includes('row-level security') || message.includes('permission denied')) {
    return 'ما عندك صلاحية لتنفيذ العملية. تحقق من دور الحساب وسياسات RLS في Supabase.';
  }
  if (code === '23505') return 'هذه البيانات موجودة مسبقاً.';
  if (code === '23503') return 'تعذر الحفظ لوجود بيانات مرتبطة بهذا السجل.';
  return fallback;
};

const AuthContext = createContext(null);

const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let profileRequestId = 0;
    const loadProfile = async (user) => {
      const requestId = ++profileRequestId;
      if (!user) {
        setProfile(null);
        setProfileError('');
        if (requestId === profileRequestId) setLoading(false);
        return;
      }
      try {
        setProfileError('');
        const { data: currentProfile, error: profileError } = await supabase.from('profiles').select('id, identifier, role, "isOwner", "displayName", "pictureUrl"').eq('id', user.id).maybeSingle();
        if (profileError) throw profileError;

        if (requestId === profileRequestId) setProfile(currentProfile || null);
      } catch (error) {
        if (requestId === profileRequestId) {
          setProfile(null);
          setProfileError([supabaseErrorMessage(error, 'تعذر قراءة ملف الحساب من Supabase'), error?.code && `(رمز الخطأ: ${error.code})`].filter(Boolean).join(' '));
        }
      } finally {
        if (requestId === profileRequestId) setLoading(false);
      }
    };

    supabase.auth.getSession()
      .then(async ({ data: { session: currentSession }, error }) => {
        if (error) throw error;
        setSession(currentSession);
        if (currentSession?.user) setLoading(true);
        await loadProfile(currentSession?.user || null);
      })
      .catch((error) => {
        profileRequestId += 1;
        setSession(null);
        setProfile(null);
        setProfileError([supabaseErrorMessage(error, 'تعذر استعادة جلسة Supabase'), error?.code && `(رمز الخطأ: ${error.code})`].filter(Boolean).join(' '));
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      window.dispatchEvent(new Event('account-session-changed'));
      if (!nextSession || event === 'SIGNED_OUT') {
        loadProfile(null);
        return;
      }
      setLoading(true);
      loadProfile(nextSession.user);
    });
    return () => subscription.unsubscribe();
  }, []);

  const value = { session, user: session?.user || null, profile, profileError, loading };
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
    const sellingPrice = Number(product.selectedPrice ?? product.discountedPrice ?? product.price ?? 0);
    const productKey = variantKey(product.selectedVariants);
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id && variantKey(item.selectedVariants) === productKey);
      if (existing) {
        return (Array.isArray(current) ? current : []).map((item) => item.id === product.id && variantKey(item.selectedVariants) === productKey ? { ...item, quantity: item.quantity + quantity, price: sellingPrice } : item);
      }
      return [...current, { ...product, id: Number(product.id), quantity, price: sellingPrice }];
    });
  };

  const updateItem = (id, quantity, selectedVariants = {}) => {
    const productKey = variantKey(selectedVariants);
    setCart((current) => quantity < 1
      ? (Array.isArray(current) ? current : []).filter((item) => item.id !== id || variantKey(item.selectedVariants) !== productKey)
      : (Array.isArray(current) ? current : []).map((item) => item.id === id && variantKey(item.selectedVariants) === productKey ? { ...item, quantity } : item));
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
  const [settings, setSettings] = useState(defaultSettings);

  useEffect(() => {
    getSiteSettings()
      .then((data) => {
        const nextSettings = { ...defaultSettings, ...(data || {}) };
        setSettings(nextSettings);
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
        <BottomNav />
      </CartProvider>
    </AuthProvider>
  );
}

function AppContent() {
  const location = useLocation();

  return (
    <div key={location.pathname} className="route-transition">
      <Routes>
        <Route path="/" element={<Store />} />
        <Route path="/product/:id" element={<ProductDetailPage />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/account/profile" element={<AccountPage />} />
        <Route path="/account/password" element={<AccountPage />} />
        <Route path="/account/favorites" element={<AccountPage />} />
        <Route path="/account/products" element={<AccountPage />} />
        <Route path="/account/policy" element={<AccountPage />} />
        <Route path="/my-orders" element={<MyOrders />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin/*" element={<Admin />} />
        <Route path="*" element={<Store />} />
      </Routes>
    </div>
  );
}

function BottomNav() {
  const { count } = useCart();
  const { user, profile } = useAuth();
  const location = useLocation();
  const items = [
    { label: 'الرئيسية', to: '/', icon: 'home', active: location.pathname === '/' },
    ...(profile?.role === 'admin' ? [{ label: 'لوحة الإدارة', to: '/admin', icon: 'grid', active: location.pathname.startsWith('/admin') }] : []),
    { label: 'سلة التسوق', to: '/checkout', icon: 'cart', active: location.pathname === '/checkout', count },
    { label: 'طلباتي السابقة', to: user ? '/my-orders' : '/login', icon: 'receipt', active: location.pathname === '/my-orders' },
    { label: 'الحساب', to: user ? '/account' : '/login', icon: 'account', active: location.pathname.startsWith('/account') || location.pathname === '/login' },
  ];

  const icons = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    cart: <><path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 1.9-1.4L22 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
    account: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  };

  return (
    <nav className="bottom-nav" aria-label="التنقل الرئيسي">
      <div className="bottom-nav-inner">
        {items.map((item) => (
          <Link key={item.label} to={item.to} className={`bottom-nav-item ${item.active ? 'active' : ''}`} aria-current={item.active ? 'page' : undefined} aria-label={item.count > 0 ? `${item.label} (${item.count})` : item.label}>
            <span className="bottom-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icons[item.icon]}</svg>
              {item.count > 0 && <span className="bottom-nav-count">{item.count}</span>}
            </span>
            <span className="bottom-nav-label">{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

function AccountPage() {
  const { user, profile } = useAuth();
  const settings = useSiteSettings();
  const location = useLocation();
  const navigate = useNavigate();
  const metadata = user?.user_metadata || {};
  const [name, setName] = useState(metadata.full_name || metadata.name || profile?.displayName || '');
  const [favoriteName, setFavoriteName] = useState('');
  const [favorite, setFavorite] = useState({ customerName: name, province: '', address: '', nearestLandmark: '', phoneNumber: '' });
  const [favorites, setFavorites] = useState(Array.isArray(metadata.saved_addresses) ? metadata.saved_addresses : []);
  const [savedProducts, setSavedProducts] = useState(Array.isArray(metadata.saved_products) ? metadata.saved_products : []);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [passwordSet, setPasswordSet] = useState(metadata.password_set === true);

  if (!user) return <Navigate to="/login" replace />;

  const displayName = name || profile?.displayName || '';
  const activePanel = location.pathname === '/account'
    ? 'menu'
    : location.pathname.endsWith('/password')
      ? 'password'
      : location.pathname.endsWith('/favorites')
        ? 'favorites'
        : location.pathname.endsWith('/products')
          ? 'products'
        : location.pathname.endsWith('/policy')
          ? 'policy'
          : 'account';
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

  const deleteSavedProduct = async (productId) => {
    const nextProducts = savedProducts.filter((item) => String(item.id) !== String(productId));
    const { error: authError } = await supabase.auth.updateUser({ data: { saved_products: nextProducts } });
    if (authError) return setError('تعذر حذف المنتج من المفضلة. حاول مرة أخرى.');
    setSavedProducts(nextProducts);
  };

  return (
    <>
      <StoreNav settings={settings} />
      <main className={`account-page ${activePanel === 'menu' ? 'account-menu-view' : 'account-detail-view'}`}>
        <div className="account-page-head"><p className="eyebrow">حسابك</p><h1>{activePanel === 'menu' ? (displayName ? `أهلاً، ${displayName}` : 'أهلاً بك') : activePanel === 'account' ? 'بيانات الحساب' : activePanel === 'password' ? (passwordSet ? 'تغيير كلمة المرور' : 'عيّن كلمة المرور') : activePanel === 'favorites' ? 'خيارات الطلب المفضلة' : activePanel === 'products' ? 'المنتجات المفضلة' : settings.policyTitle}</h1>{activePanel === 'menu' && <p>{user.email}</p>}</div>
        {activePanel !== 'menu' && <Link to="/account" className="account-back"><span aria-hidden="true">›</span> العودة إلى الحساب</Link>}
        <section className="account-menu" aria-label="قائمة الحساب">
          <h2>الإعدادات</h2>
          <Link to="/account/profile" className={`account-menu-row ${activePanel === 'account' ? 'active' : ''}`}><span className="account-menu-icon">◉</span><strong>بيانات الحساب</strong><span className="account-menu-arrow">‹</span></Link>
          <Link to="/account/password" className={`account-menu-row ${activePanel === 'password' ? 'active' : ''}`}><span className="account-menu-icon">⌑</span><strong>{passwordSet ? 'تغيير كلمة المرور' : 'عيّن كلمة المرور'}</strong><span className="account-menu-arrow">‹</span></Link>
          <Link to="/my-orders" className="account-menu-row"><span className="account-menu-icon">★</span><strong>طلباتي السابقة</strong><span className="account-menu-arrow">‹</span></Link>
          <Link to="/account/favorites" className={`account-menu-row ${activePanel === 'favorites' ? 'active' : ''}`}><span className="account-menu-icon">⌖</span><strong>خيارات الطلب المفضلة</strong><span className="account-menu-arrow">‹</span></Link>
          <Link to="/account/products" className={`account-menu-row ${activePanel === 'products' ? 'active' : ''}`}><span className="account-menu-icon">♥</span><strong>المنتجات المفضلة</strong><span className="account-menu-arrow">‹</span></Link>
          <Link to="/account/policy" className={`account-menu-row ${activePanel === 'policy' ? 'active' : ''}`}><span className="account-menu-icon">▣</span><strong>{settings.policyTitle}</strong><span className="account-menu-arrow">‹</span></Link>
          <button type="button" className="account-menu-row account-logout-row" onClick={() => signOut(setError)}><span className="account-menu-icon">↪</span><strong>تسجيل الخروج</strong><span className="account-menu-arrow">‹</span></button>
        </section>
        <div className="account-sections">
          {activePanel === 'account' && <form className="account-panel" onSubmit={saveAccountName}><h2>بيانات الحساب</h2><Field label="اسمك" name="accountName" value={name} onChange={(event) => setName(event.target.value)} /><button type="submit" className="primary">حفظ الاسم</button></form>}
          {activePanel === 'password' && <form className="account-panel" onSubmit={savePassword}><h2>{passwordSet ? 'تغيير كلمة المرور' : 'تنبيه: عيّن كلمة مرور'}</h2>{!passwordSet && <p className="account-warning">حسابك يعمل حالياً عبر رابط البريد. عيّن كلمة مرور حتى تسجل الدخول بها لاحقاً.</p>}<Field label="كلمة المرور الجديدة" name="accountPassword" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><Field label="تأكيد كلمة المرور" name="accountPasswordConfirm" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /><button type="submit" className="primary">{passwordSet ? 'تغيير كلمة المرور' : 'تعيين كلمة المرور'}</button></form>}
          {activePanel === 'policy' && <section className="account-panel account-policy"><h2>{settings.policyTitle}</h2><p>{settings.policyText}</p></section>}
          {activePanel === 'favorites' && <section className="account-panel account-favorites"><h2>خيارات الطلب المفضلة</h2>{favorites.map((item) => <div className="favorite-row" key={item.id}><button type="button" className="favorite-use" onClick={() => navigate(`/checkout?favorite=${item.id}`)}>{item.label}</button><button type="button" className="danger favorite-delete" onClick={() => deleteFavorite(item.id)}>حذف</button></div>)}{!favorites.length && <p className="account-muted">احفظ عنواناً ورقماً لتعبئتهما بسرعة عند الطلب.</p>}<form className="favorite-form" onSubmit={saveFavorite}><Field label="اسم الخيار" name="favoriteName" value={favoriteName} onChange={(event) => setFavoriteName(event.target.value)} placeholder="مثلاً: البيت" /><Field label="الاسم" name="customerName" value={favorite.customerName} onChange={updateFavoriteField} /><label className="field-label">المحافظة<select name="province" value={favorite.province} onChange={updateFavoriteField} required><option value="">اختر المحافظة</option>{provinces.map((province) => <option key={province} value={province}>{province}</option>)}</select></label><Field label="العنوان" name="address" value={favorite.address} onChange={updateFavoriteField} /><Field label="أقرب نقطة دالة" name="nearestLandmark" value={favorite.nearestLandmark} onChange={updateFavoriteField} /><Field label="رقم الهاتف" name="phoneNumber" type="tel" value={favorite.phoneNumber} onChange={updateFavoriteField} placeholder="07xxxxxxxxx" /><button type="submit" className="primary">حفظ الخيار</button></form></section>}
          {activePanel === 'products' && <section className="account-panel account-favorites"><h2>المنتجات المفضلة</h2>{savedProducts.map((item) => <div className="saved-product-row" key={item.id}><Link to={`/product/${item.id}`} className="saved-product-link"><ProductImage src={item.imageUrl} alt={item.name} /><span><strong>{item.name}</strong><small>{money(item.price)}</small></span></Link><button type="button" className="danger favorite-delete" onClick={() => deleteSavedProduct(item.id)}>حذف</button></div>)}{!savedProducts.length && <p className="account-muted">المنتجات التي تحفظها بالقلب ستظهر هنا.</p>}</section>}
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
  const storeName = settings.storeName || 'المتجر';

  return (
    <header className="nav">
      <Link to="/" className="brand store-wordmark">
        <span>{storeName}</span>
        {settings.tagline && <small>{settings.tagline}</small>}
      </Link>
      <nav>
        {!user && <Link to="/login">تسجيل الدخول</Link>}
        {user && <Link to="/account">الحساب</Link>}
        {profile?.role === 'admin' && <Link to="/admin">لوحة الإدارة</Link>}
        {user && <Link to="/my-orders">طلباتي السابقة</Link>}
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
  const storeCategories = getStoreCategories(settings.storeCategories, safeProducts);
  const categoryNames = storeCategories.map((item) => item.name);
  const categories = ['الكل', ...categoryNames];
  const categoryCards = storeCategories.map((item) => ({
    ...item,
    product: safeProducts.find((product) => product.category === item.name),
  }));
  const featuredProducts = Array.isArray(settings.featuredProductIds)
    ? settings.featuredProductIds.map((productId) => safeProducts.find((product) => String(product.id) === String(productId))).filter(Boolean)
    : safeProducts.filter(hasProductDiscount).slice(0, 6);
  const visibleProducts = Array.isArray(safeProducts)
    ? safeProducts.filter((product) => {
        const matchesCategory = category === 'الكل' || product.category === category;
        const query = search.trim().toLowerCase();
        const matchesQuery = !query || product.name.toLowerCase().includes(query);
        return matchesCategory && matchesQuery;
      })
    : [];
  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / productsPerPage));
  const sortedProducts = Array.isArray(visibleProducts)
    ? [...visibleProducts].sort((left, right) => (
        Number(right.isNew) - Number(left.isNew)
        || Number(hasProductDiscount(right)) - Number(hasProductDiscount(left))
        || Number(right.id) - Number(left.id)
      ))
    : [];
  const pagedProducts = Array.isArray(sortedProducts)
    ? sortedProducts.slice((currentPage - 1) * productsPerPage, currentPage * productsPerPage)
    : [];

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
        <section id="catalog" className="catalog">
          {!!featuredProducts.length && <section className="featured-shelf"><div className="section-head compact-head"><div><h2>{settings.featuredSectionTitle || defaultSettings.featuredSectionTitle}</h2></div></div><div className="featured-row">{featuredProducts.map((product) => <ProductCard key={product.id} product={product} maintenanceMode={settings.maintenanceMode} compact />)}</div></section>}
          {!!categoryCards.length && <div className="category-strip-section"><div className="section-head compact-head"><div><p className="eyebrow">تسوق حسب الفئة</p></div></div><div className="category-strip"><button type="button" className={`category-tile ${category === 'الكل' ? 'active' : ''}`} onClick={() => setCategory('الكل')}><span className="category-tile-image category-all">الكل</span><strong>الكل</strong></button>{categoryCards.map(({ id, name, imageUrl, product }) => <button type="button" className={`category-tile ${category === name ? 'active' : ''}`} key={id} onClick={() => setCategory(name)}><span className="category-tile-image"><ProductImage src={imageUrl || product?.imageUrl} alt={name} /></span><strong>{name}</strong></button>)}</div></div>}
          <div className="section-head">
            <div>
              <p className="eyebrow">المنتجات</p>
            </div>
            <div className="filters">
              <input aria-label="بحث" placeholder="بحث" value={search} onChange={(event) => setSearch(event.target.value)} />
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
  const hasDiscount = hasProductDiscount(product);
  const unitPrice = Number(product.discountedPrice ?? product.price ?? 0);

  return (
    <article className={`product ${compact ? 'product-compact' : ''}`} key={product.id}>
      <Link to={`/product/${product.id}`} className="product-image">
        <ProductImage src={product.imageUrl} alt={product.name} />
        <div className="product-badges">
          {product.isNew && <span className="product-badge new-badge">جديد</span>}
          {hasDiscount && <span dir="auto" className="product-badge offer-badge">{productDiscountLabel(product)}</span>}
        </div>
        {productAvailabilityMode(product) === 'preorder' && <span className="sold">طلب مسبق</span>}
        {productAvailabilityMode(product) === 'unavailable' && <span className="sold">غير متوفر</span>}
      </Link>
      <div className="product-info">
        <span>{product.category || 'بدون فئة'}</span>
        <Link to={`/product/${product.id}`} className="product-name"><h3>{product.name}</h3></Link>
        <div className="product-bottom">
          <div className="price-wrap">
            {hasDiscount ? <><span className="old-price">{money(product.price)}</span><strong>{money(unitPrice)}</strong></> : <strong>{money(product.price)}</strong>}
          </div>
          <AddToCartButton product={product} quantity={1} className="mini-button" disabled={maintenanceMode || productAvailabilityMode(product) === 'unavailable'} label="أضف للسلة" disabledLabel={maintenanceMode ? 'المتجر في وضع الصيانة' : 'غير متوفر'} />
        </div>
      </div>
    </article>
  );
}

function ProductDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const settings = useSiteSettings();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState('');
  const [selectedVariants, setSelectedVariants] = useState({});
  const [similarProducts, setSimilarProducts] = useState([]);
  const [isProductSaved, setIsProductSaved] = useState(false);
  const [productActionMessage, setProductActionMessage] = useState('');

  useEffect(() => {
    recordView('product', id).catch(() => {});

    setLoading(true);
    setError('');
    getProduct(id)
      .then((data) => {
        if (!data) throw new Error('تعذر تحميل المنتج');
        setProduct(data);
        setSelectedImage(data?.productImages?.[0] ?? data?.imageUrl ?? '');
        setSelectedVariants(Object.fromEntries((data.variants || []).map((variant) => {
          const firstChoice = variantChoiceLabel(variant.values[0]);
          return [variant.name, firstChoice];
        })));
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

  const hasDiscount = hasProductDiscount(product);
  const finalPrice = getProductOptionPrice(product, selectedVariants);
  const productImages = Array.isArray(product?.productImages) ? product.productImages : [];
  const thumbnailImages = (productImages.length ? productImages : [product?.imageUrl]).filter(Boolean);
  const variantsComplete = (product.variants || []).every((variant) => {
    if (!variant.required) return true;
    return Boolean(selectedVariants[variant.name]);
  });
  const isProductFavorite = isProductSaved || (Array.isArray(user?.user_metadata?.saved_products) && user.user_metadata.saved_products.some((item) => String(item.id) === String(product.id)));

  const chooseVariantOption = (variant, label) => {
    setSelectedVariants((current) => ({ ...current, [variant.name]: label }));
  };

  const toggleProductFavorite = async () => {
    if (!user) {
      navigate('/login', { state: { returnTo: `/product/${product.id}` } });
      return;
    }
    setProductActionMessage('');
    const currentProducts = Array.isArray(user.user_metadata?.saved_products) ? user.user_metadata.saved_products : [];
    const alreadySaved = currentProducts.some((item) => String(item.id) === String(product.id));
    const nextProducts = alreadySaved
      ? currentProducts.filter((item) => String(item.id) !== String(product.id))
      : [...currentProducts, { id: product.id, name: product.name, imageUrl: product.imageUrl, price: finalPrice }];
    const { error: authError } = await supabase.auth.updateUser({ data: { saved_products: nextProducts } });
    if (authError) {
      setProductActionMessage('تعذر تحديث المفضلة. حاول مرة أخرى.');
      return;
    }
    setIsProductSaved(!alreadySaved);
  };

  const shareProduct = async () => {
    const url = window.location.href;
    setProductActionMessage('');
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, url });
      } else {
        await navigator.clipboard.writeText(url);
        setProductActionMessage('تم نسخ رابط المنتج');
      }
    } catch (reason) {
      if (reason.name !== 'AbortError') setProductActionMessage('تعذرت مشاركة الرابط');
    }
  };

  const goBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/');
  };

  return (
    <>
      <StoreNav settings={settings} />
      <main className="detail-page">
        <div className="product-detail-layout">
          <div className="detail-image-wrap">
            <div className="detail-main-image">
              <ProductImage src={selectedImage} alt={product.name} />
              <div className="product-detail-actions">
                <button type="button" className="product-image-action back-product" onClick={goBack} aria-label="رجوع خطوة للوراء" title="رجوع خطوة للوراء"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
                <div className="product-detail-action-group">
                  <button type="button" className={`product-image-action favorite-product ${isProductFavorite ? 'active' : ''}`} onClick={toggleProductFavorite} aria-label={isProductFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'} title={isProductFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}><svg viewBox="0 0 24 24" fill={isProductFavorite ? 'currentColor' : 'none'} aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1 7.8 7.8 7.8-7.8 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></svg></button>
                  <button type="button" className="product-image-action share-product" onClick={shareProduct} aria-label="مشاركة رابط المنتج" title="مشاركة رابط المنتج"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5" /></svg></button>
                </div>
              </div>
            </div>
            <div className="detail-thumbnails">
              {(thumbnailImages ?? []).map((image, index) => (
                <button type="button" className={selectedImage === image ? 'selected' : ''} key={`${image}-${index}`} onClick={() => setSelectedImage(image)}>
                  <ProductImage src={image} alt={`${product.name} ${index + 1}`} />
                </button>
              ))}
            </div>
          </div>
          <div className="detail-content">
            {productActionMessage && <span className="product-action-message" role="status">{productActionMessage}</span>}
            <div className="detail-topbar">
              <div className="detail-kicker">
                <span className="category-badge">{product.category}</span>
                {hasDiscount && <span dir="auto" className="detail-discount">{productDiscountLabel(product)}</span>}
              </div>
              {(settings.maintenanceMode || productAvailabilityMode(product) !== 'ready') && (
                <div className={`status-pill ${settings.maintenanceMode ? 'maintenance' : (productAvailabilityMode(product) === 'unavailable' ? 'unavailable' : 'available')}`}>
                  {settings.maintenanceMode ? 'المتجر في وضع الصيانة' : (productAvailabilityMode(product) === 'unavailable' ? 'غير متوفر' : 'طلب مسبق')}
                </div>
              )}
            </div>
            <h1>{product.name}</h1>
            <div className="detail-meta-row">
            </div>
            <div className="price-stack">
              <strong>{money(finalPrice)}</strong>
              {hasDiscount && <span className="old-price detail-old-price">{money(product.price)}</span>}
            </div>
            <p className="detail-description">{product.description}</p>
            {Array.isArray(product.variants) && product.variants.map((variant) => {
              const selected = Array.isArray(selectedVariants[variant.name]) ? selectedVariants[variant.name] : [selectedVariants[variant.name]].filter(Boolean);
              const isReplacement = variant.priceMode === 'replace';
              return (
                <section className={`detail-option-card ${isReplacement ? 'detail-weight-card' : ''}`} key={variant.name}>
                  <header className="detail-option-heading">
                    <div><h2>{variant.name}</h2><p>اختر خيارًا واحدًا</p></div>
                    <span className={`detail-option-status ${selected.length ? 'selected' : ''}`} aria-label={selected.length ? 'تم الاختيار' : 'لم يتم الاختيار'}>{selected.length ? '✓' : ''}</span>
                  </header>
                  <div className={isReplacement ? 'detail-weight-options' : 'detail-option-list'}>
                    {variant.values.map((choice) => {
                      const label = variantChoiceLabel(choice);
                      const choicePrice = variantChoicePrice(choice);
                      const isSelected = selected.includes(label);
                      return isReplacement ? (
                        <button type="button" key={label} className={`detail-weight-choice ${isSelected ? 'selected' : ''}`} aria-pressed={isSelected} onClick={() => chooseVariantOption(variant, label)}>
                          <strong>{label}</strong>{choicePrice > 0 && <span>{money(choicePrice)}</span>}
                        </button>
                      ) : (
                        <label className={`detail-option-row ${isSelected ? 'selected' : ''}`} key={label}>
                          <input type="radio" name={`option-${product.id}-${variant.name}`} checked={isSelected} onChange={() => chooseVariantOption(variant, label)} />
                          <span className="detail-option-label">{label}</span>
                          {choicePrice > 0 && <strong dir="auto">{variant.priceMode === 'replace' ? money(choicePrice) : `+${money(choicePrice)}`}</strong>}
                        </label>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            <div className="detail-purchase-row">
              <div className="quantity-row">
                <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button>
                <span>{quantity}</span>
                <button type="button" onClick={() => setQuantity((value) => value + 1)}>+</button>
              </div>
              <div className="detail-purchase-summary"><small>{product.name}</small><strong>{money(finalPrice)}</strong></div>
              <AddToCartButton product={{ ...product, selectedVariants, selectedPrice: finalPrice }} quantity={quantity} disabled={settings.maintenanceMode || productAvailabilityMode(product) === 'unavailable' || !variantsComplete} className="primary block" label="أضف إلى السلة" disabledLabel={settings.maintenanceMode ? 'الطلبات متوقفة للصيانة' : (!variantsComplete ? 'اختر الخيارات أولاً' : 'غير متوفر')} />
            </div>
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
      const message = String(reason?.message || '');
      setError(reason?.code === 'PGRST202' || message.includes('create_order_with_stock')
        ? 'مخطط قاعدة البيانات غير مكتمل. شغّل supabase_schema_fix.sql في Supabase ثم أعد المحاولة.'
        : (message || 'تعذر إرسال الطلب'));
    }
  };

  if (done) {
    return (
      <>
        <StoreNav settings={settings} />
        <main className="confirmation">
          <div className="check">✓</div>
          <p className="eyebrow">تم استلام طلبك</p>
          <h1>شكراً لطلبك</h1>
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
              <h2>تفاصيل الطلب</h2>
              {(Array.isArray(cart) ? cart : []).map((item) => (
                <div className="receipt-item" key={cartItemKey(item)}>
                  <ProductImage src={item.imageUrl} alt={item.name} />
                  <div>
                    <strong>{item.name}</strong>
                    <small>{money(item.price)} × {item.quantity}</small>
                    <div className="qty">
                      <button type="button" onClick={() => updateItem(item.id, item.quantity - 1, item.selectedVariants)}>−</button>
                      <span>{item.quantity}</span>
                      <button type="button" onClick={() => updateItem(item.id, item.quantity + 1, item.selectedVariants)}>+</button>
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
              <div className="account-order-totals">
                <div><span>المجموع</span><strong>{money(order.subtotal)}</strong></div>
                <div><span>الخصم {order.discountValue ? `(${order.discountType === 'percentage' ? `${order.discountValue}%` : money(order.discountValue)})` : ''}</span><strong>- {money(order.discountAmount)}</strong></div>
                <div><span>التوصيل</span><strong>{money(order.deliveryFee)}</strong></div>
                <div className="account-order-final"><span>الإجمالي</span><strong>{money(order.finalTotal)}</strong></div>
              </div>
            </article>)}
          </div>
        )}
      </main>
    </>
  );
}

function Login() {
  const storeSettings = useSiteSettings();
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [capsLock, setCapsLock] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = typeof location.state?.returnTo === 'string' && location.state.returnTo.startsWith('/')
    ? location.state.returnTo
    : (location.pathname.startsWith('/admin') ? location.pathname : '/');

  const sendMagicLink = async () => {
    setError('');
    setMessage('');
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
      navigate(profile?.role === 'admin' ? '/admin' : returnTo);
      return;
    }
    const value = identifier.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('أدخل بريداً إلكترونياً صحيحاً');
      return;
    }
    if (mode === 'register' && !fullName.trim()) {
      setError('أدخل الاسم الكامل');
      return;
    }
    if (mode === 'register' && password.length < 6) {
      setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    const credentials = { email: value.toLowerCase(), password };
    let result;
    try {
      result = mode === 'login'
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp({
          email: value.toLowerCase(),
          password,
          options: {
            data: { full_name: fullName.trim(), displayName: fullName.trim() },
            emailRedirectTo: authRedirectUrl(),
          },
        });
    } catch {
      setError('تعذر الاتصال بخدمة تسجيل الدخول. حاول مرة أخرى.');
      return;
    }
    if (result.error) {
      setError(authErrorMessage(result.error, 'تعذر إتمام العملية. حاول مرة أخرى.'));
      return;
    }
    if (mode === 'login') {
      supabase.auth.updateUser({ data: { password_set: true } }).catch(() => {});
    }
    if (mode === 'register') {
      setMessage('تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيده.');
      setMode('login');
      setPassword('');
      return;
    }
    navigate(returnTo);
  };

  const { user, profile, loading } = useAuth();
  if (!loading && user) {
    return <Navigate to={profile?.role === 'admin' ? '/admin' : returnTo} replace />;
  }

  return (
    <>
      <StoreNav settings={storeSettings} />
      <main className={`login-page ${mode === 'register' ? 'register-page' : ''}`}>
      <form className="login-card" onSubmit={submit}>
        <h1>{mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}</h1>
        {mode === 'register' && <Field label="الاسم الكامل" name="fullName" value={fullName} onChange={(event) => setFullName(event.target.value)} />}
        <Field label="البريد الإلكتروني" name="identifier" type="email" inputMode="email" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
        <Field label="كلمة المرور" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => setCapsLock(event.getModifierState('CapsLock'))} allowReveal={mode === 'login'} />
        {capsLock && <p className="caps-lock-message">الأحرف الكبيرة مفعلة</p>}
        {error && <p className="error">{error}</p>}
        {message && <p className="success-message">{message}</p>}
        <button type="submit" className="primary full">{mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}</button>
        {mode === 'login' && error && <button type="button" className="back" onClick={sendMagicLink}>إرسال رابط دخول جديد إلى البريد</button>}
        {mode === 'register' ? (
          <>
            <p className="auth-switch-copy">لديك حساب؟ <button type="button" onClick={() => { setMode('login'); setError(''); setMessage(''); }}>تسجيل الدخول</button></p>
            <Link to="/" className="auth-guest-link">أو تابع كزائر</Link>
          </>
        ) : (
          <>
            <p className="auth-switch-copy">ليس لديك حساب؟ <button type="button" onClick={() => { setMode('register'); setError(''); setMessage(''); }}>إنشاء حساب</button></p>
            <Link to="/" className="back">العودة للمتجر</Link>
          </>
        )}
      </form>
      </main>
    </>
  );
}

function Admin() {
  const location = useLocation();
  const requestedPage = location.pathname.split('/')[2] || 'overview';
  const page = requestedPage === 'product-discounts' ? 'products' : requestedPage === 'analytics' ? 'overview' : requestedPage;
  const navigate = useNavigate();
  const { user, profile, profileError, loading } = useAuth();
  const [logoutError, setLogoutError] = useState('');

  if (loading) return <div className="empty">جاري التحقق من الحساب...</div>;
  if (!user) return <Login />;
  if (profileError || profile?.role !== 'admin') return (
    <main className="empty" role="alert">
      <h1>تعذر فتح لوحة المشرف</h1>
      <p>{profileError || (profile ? `دور حسابك في profiles هو «${profile.role}» وليس admin.` : 'لم يتم العثور على ملف لهذا الحساب في جدول profiles.')}</p>
      <p>تحقق من صلاحية الحساب وسياسات RLS وtrigger إنشاء المستخدم في Supabase.</p>
      <Link to="/" className="back-link">العودة للمتجر</Link>
    </main>
  );

  const titleMap = {
    overview: 'نظرة عامة',
    products: 'المنتجات',
    orders: 'الطلبات',
    discounts: 'أكواد الخصم',
    settings: 'إعدادات المتجر',
    admins: 'المشرفون',
  };

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <Link to="/" className="brand">المتجر<small>لوحة التحكم</small></Link>
        <Link className={page === 'overview' ? 'active' : ''} to="/admin">نظرة عامة</Link>
        <Link className={page === 'products' ? 'active' : ''} to="/admin/products">المنتجات</Link>
        <Link className={page === 'orders' ? 'active' : ''} to="/admin/orders">الطلبات</Link>
        <Link className={page === 'discounts' ? 'active' : ''} to="/admin/discounts">أكواد الخصم</Link>
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

        {page === 'products' ? <ProductsAdmin /> : page === 'orders' ? <OrdersAdmin /> : page === 'discounts' ? <DiscountsAdmin /> : page === 'settings' ? <SiteSettingsAdmin /> : page === 'admins' ? <AdminsAdmin /> : <Overview />}
      </section>
    </div>
  );
}

function Overview() {
  const [stats, setStats] = useState({ currentRevenue: 0, growth: 0, totalProfit: 0, homeViews: 0, orderStats: {}, bestSeller: null });
  const [accountsTotal, setAccountsTotal] = useState(0);
  const [catalogStats, setCatalogStats] = useState({ products: 0, categories: 0 });
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState(null);

  useEffect(() => {
    Promise.allSettled([
      analytics(),
      accountCount(),
      adminProducts(),
      getSiteSettings(),
    ])
      .then(([analyticsResult, accountsResult, productsResult, settingsResult]) => {
        if (analyticsResult.status === 'fulfilled') setStats(analyticsResult.value || {});
        if (accountsResult.status === 'fulfilled') setAccountsTotal(accountsResult.value || 0);
        if (productsResult.status === 'fulfilled') {
          const products = Array.isArray(productsResult.value) ? productsResult.value : [];
          setCatalogProducts(products);
          setSelectedProductId((current) => products.some((product) => String(product.id) === String(current)) ? current : (products[0]?.id ?? null));
          const categories = settingsResult.status === 'fulfilled'
            ? getStoreCategories(settingsResult.value?.storeCategories, products).length
            : new Set(products.map((product) => String(product.category || '').trim().toLocaleLowerCase()).filter(Boolean)).size;
          setCatalogStats({ products: products.length, categories });
        }
      });
  }, []);

  const selectedProduct = catalogProducts.find((product) => String(product.id) === String(selectedProductId));
  const selectedProductStats = stats.productStats?.[String(selectedProductId)] || {};

  return (
    <div className="dashboard-overview">
      <div className="stats">
        <div><span>مبيعات هذا الشهر</span><strong>{money(stats.currentRevenue)}</strong></div>
        <div><span>الطلبات الكلية</span><strong>{stats.orderStats?.total || 0}</strong></div>
        <div><span>طلبات مكتملة</span><strong>{stats.orderStats?.delivered || 0}</strong></div>
        <div><span>عدد المنتجات</span><strong>{catalogStats.products}</strong></div>
        <div><span>التصنيفات</span><strong>{catalogStats.categories}</strong></div>
        <div className="best-seller"><span>المنتج الأكثر مبيعًا</span><strong>{stats.bestSeller?.name || 'لا توجد مبيعات'}</strong>{stats.bestSeller?.quantity > 0 && <small>{stats.bestSeller.quantity} قطعة مباعة</small>}</div>
        <div><span>زيارات الموقع</span><strong>{stats.homeViews || 0}</strong></div>
        <div><span>نسبة النمو</span><strong>{stats.growth || 0}%</strong></div>
        <div className="highlight"><span>صافي أرباح هذا الشهر</span><strong>{money(stats.totalProfit)}</strong></div>
        <div><span>الحسابات المسجلة</span><strong>{accountsTotal}</strong></div>
      </div>
      <section className="product-analytics" aria-labelledby="product-analytics-title">
        <header className="product-analytics-heading">
          <div><p className="eyebrow">أداء الكتالوج</p><h2 id="product-analytics-title">المنتجات شنو هي؟</h2></div>
          <span>{catalogProducts.length} منتج</span>
        </header>
        {catalogProducts.length ? <div className="product-analytics-layout">
          <div className="product-analytics-list" aria-label="قائمة المنتجات">
            {catalogProducts.map((product) => <button type="button" key={product.id} className={`product-analytics-item ${String(selectedProductId) === String(product.id) ? 'selected' : ''}`} aria-pressed={String(selectedProductId) === String(product.id)} onClick={() => setSelectedProductId(product.id)}>
              <ProductImage src={product.imageUrl} alt="" />
              <span><strong>{product.name}</strong><small>{product.category || 'غير مصنف'}</small></span>
            </button>)}
          </div>
          {selectedProduct && <div className="product-analytics-detail">
            <h3>{selectedProduct.name}</h3>
            <div className="product-analytics-metrics">
              <div><span>عدد النقرات</span><strong>{selectedProductStats.clicks || 0}</strong></div>
              <div><span>الكمية المباعة</span><strong>{selectedProductStats.quantity || 0}</strong></div>
              <div><span>إجمالي المبيعات</span><strong>{money(selectedProductStats.revenue || 0)}</strong></div>
              <div><span>صافي الربح</span><strong>{money(selectedProductStats.netProfit || 0)}</strong></div>
            </div>
          </div>}
        </div> : <p className="product-analytics-empty">لا توجد منتجات لعرض إحصاءاتها.</p>}
      </section>
    </div>
  );
}

function ProductsAdmin() {
  const emptyForm = { name: '', description: '', price: '', costPrice: '', discountType: 'percentage', discountValue: '', discountPercentage: '', category: '', imageUrl: '', productImages: [], variants: [], stockQuantity: 10, availabilityMode: 'ready', inStock: true, isNew: false };
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [primaryImageFile, setPrimaryImageFile] = useState(null);
  const [additionalImageFiles, setAdditionalImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState({ primary: '', additional: [] });
  const primaryImageInputRef = useRef(null);
  const additionalImageInputRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    const primary = primaryImageFile ? URL.createObjectURL(primaryImageFile) : '';
    const additional = additionalImageFiles.map((file) => URL.createObjectURL(file));
    setImagePreviews({ primary, additional });
    return () => [primary, ...additional].filter(Boolean).forEach((url) => URL.revokeObjectURL(url));
  }, [primaryImageFile, additionalImageFiles]);

  const resetForm = () => {
    setForm(emptyForm);
    setPrimaryImageFile(null);
    setAdditionalImageFiles([]);
    if (primaryImageInputRef.current) primaryImageInputRef.current.value = '';
    if (additionalImageInputRef.current) additionalImageInputRef.current.value = '';
    setEditingId(null);
  };

  const removeSavedImage = (image) => {
    setForm((current) => ({
      ...current,
      imageUrl: current.imageUrl === image ? '' : current.imageUrl,
      productImages: current.productImages.filter((savedImage) => savedImage !== image),
    }));
  };

  const removePrimaryImage = () => {
    if (primaryImageFile) {
      setPrimaryImageFile(null);
      if (primaryImageInputRef.current) primaryImageInputRef.current.value = '';
      return;
    }
    const savedPrimaryImage = form.imageUrl || form.productImages[0] || '';
    if (savedPrimaryImage) removeSavedImage(savedPrimaryImage);
  };

  const removeAdditionalImageFile = (index) => {
    const remainingFiles = additionalImageFiles.filter((_, fileIndex) => fileIndex !== index);
    setAdditionalImageFiles(remainingFiles);
    if (additionalImageInputRef.current && typeof DataTransfer !== 'undefined') {
      const transfer = new DataTransfer();
      remainingFiles.forEach((file) => transfer.items.add(file));
      additionalImageInputRef.current.files = transfer.files;
    }
  };

  const updateVariant = (index, field, value) => {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, variantIndex) => variantIndex === index ? { ...variant, [field]: value } : variant),
    }));
  };

  const addVariant = (preset) => {
    const options = (preset?.values || []).map((label) => ({ label, price: '', hasPrice: false }));
    setForm((current) => ({ ...current, variants: [...current.variants, { name: preset?.name || '', options, selectionMode: 'single', priceMode: 'add', required: true, maxSelections: 1 }] }));
  };

  const updateVariantOption = (variantIndex, optionIndex, field, value) => {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, index) => index === variantIndex
        ? { ...variant, options: (variant.options || []).map((option, itemIndex) => itemIndex === optionIndex ? { ...option, [field]: value } : option) }
        : variant),
    }));
  };

  const addVariantOption = (variantIndex) => {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, index) => index === variantIndex
        ? { ...variant, options: [...(variant.options || []), { label: '', price: '', hasPrice: false }] }
        : variant),
    }));
  };

  const removeVariantOption = (variantIndex, optionIndex) => {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, index) => index === variantIndex
        ? { ...variant, options: (variant.options || []).filter((_, itemIndex) => itemIndex !== optionIndex) }
        : variant),
    }));
  };

  const removeVariant = (index) => {
    setForm((current) => ({ ...current, variants: current.variants.filter((_, variantIndex) => variantIndex !== index) }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');
    setSaving(true);
    
    const wasEditing = editingId !== null;
    const variants = form.variants.map((variant) => ({
      name: String(variant.name || '').trim(),
      selectionMode: 'single',
      priceMode: variant.priceMode === 'replace' ? 'replace' : 'add',
      required: variant.required !== false,
      maxSelections: 1,
      values: (Array.isArray(variant.options) ? variant.options : []).map((option) => ({
        label: String(option.label || '').trim(),
        price: option.hasPrice ? Number(option.price) || 0 : 0,
      })).filter((choice) => choice.label),
    })).filter((variant) => variant.name && variant.values.length);
    const availabilityMode = Number(form.stockQuantity) <= 0 && form.availabilityMode === 'ready' ? 'unavailable' : form.availabilityMode;

    try {
      const payload = {
        ...form,
        id: editingId,
        variants,
        productImages: Array.isArray(form.productImages) ? form.productImages : [],
        availabilityMode,
        inStock: availabilityMode === 'ready' && Number(form.stockQuantity) > 0,
        discountType: form.discountType === 'amount' ? 'amount' : 'percentage',
        discountValue: Number(form.discountValue ?? form.discountPercentage ?? 0),
        discountPercentage: form.discountType === 'amount' ? 0 : Number(form.discountValue ?? form.discountPercentage ?? 0),
        featured: false,
      };

      if (editingId) {
        await updateProduct(payload, undefined, primaryImageFile, additionalImageFiles);
      } else {
        await createProduct(payload, primaryImageFile, additionalImageFiles);
      }

      resetForm();
      setMessage(wasEditing ? 'تم تحديث المنتج' : 'تمت إضافة المنتج');
      await load();
    } catch (reason) {
      setError(reason.message || (wasEditing ? 'تعذر تحديث المنتج' : 'تعذرت إضافة المنتج'));
    } finally {
      setSaving(false);
    }
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
    if (!product) {
      setError('تعذر تحميل بيانات المنتج للتعديل');
      return;
    }
    setEditingId(product.id);
    setForm({
      name: product.name,
      productCode: product.productCode || '',
      description: product.description || '',
      price: product.price,
      costPrice: product.costPrice ?? 0,
      discountType: product.discountType || 'percentage',
      discountValue: product.discountValue ?? product.discountPercentage ?? 0,
      discountPercentage: product.discountPercentage ?? 0,
      category: product.category,
      imageUrl: product.imageUrl || '',
      productImages: Array.isArray(product?.productImages) ? product.productImages : [],
      variants: (Array.isArray(product.variants) ? product.variants : []).map((variant) => ({
        name: String(variant.name || ''),
        selectionMode: 'single',
        priceMode: variant.priceMode === 'replace' ? 'replace' : 'add',
        required: variant.required !== false,
        maxSelections: 1,
        options: Array.isArray(variant.values) ? variant.values.map((choice) => {
          const price = variantChoicePrice(choice);
          return { label: variantChoiceLabel(choice), price: price ? String(price) : '', hasPrice: price > 0 };
        }) : [],
      })),
      stockQuantity: product.stockQuantity ?? 0,
      availabilityMode: productAvailabilityMode(product),
      inStock: productAvailabilityMode(product) === 'ready',
      isNew: Boolean(product.isNew),
    });
    setPrimaryImageFile(null);
    setAdditionalImageFiles([]);
    if (primaryImageInputRef.current) primaryImageInputRef.current.value = '';
    if (additionalImageInputRef.current) additionalImageInputRef.current.value = '';
  };

  return (
    <>
      <form className="admin-form product-editor" onSubmit={submit}>
        <header className="product-editor-heading"><div><p className="eyebrow">كتالوج المتجر</p><h2>{editingId ? 'تعديل المنتج' : 'إضافة منتج'}</h2></div>{editingId && <button type="button" className="secondary-button" onClick={resetForm}>إلغاء التعديل</button>}</header>

        <section className="product-editor-section" aria-labelledby="product-info-title">
          <div className="product-editor-section-heading"><h3 id="product-info-title">معلومات المنتج</h3></div>
          <div className="product-editor-fields">
            <label>اسم المنتج<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>التصنيف<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
            <label className="product-editor-wide">الوصف<textarea required={!editingId} value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <div className="product-variants product-editor-wide">
              <div className="product-variants-heading"><strong>خيارات المنتج</strong><button type="button" className="add-variant-button" onClick={() => addVariant()}>+ مجموعة فارغة</button></div>
              <div className="product-variant-presets">
                <span>أمثلة جاهزة:</span>
                {productVariantPresets.map((preset) => <button type="button" key={preset.name} onClick={() => addVariant(preset)}>{preset.name}</button>)}
              </div>
              {form.variants.map((variant, index) => <div className="product-variant-row" key={`variant-${index}`}>
                <label>اسم المجموعة<input value={variant.name} onChange={(event) => updateVariant(index, 'name', event.target.value)} /></label>
                <div className="product-variant-selection">
                  <span>اختيار واحد فقط</span>
                  <label className="check-label"><input type="checkbox" checked={variant.required} onChange={(event) => updateVariant(index, 'required', event.target.checked)} />مطلوب</label>
                </div>
                <div className="product-option-list">
                  {(variant.options || []).map((option, optionIndex) => <div className={`product-option-row ${option.hasPrice ? 'has-price' : ''}`} key={`option-${index}-${optionIndex}`}>
                    <input aria-label={`قيمة الخيار ${optionIndex + 1}`} value={option.label} onChange={(event) => updateVariantOption(index, optionIndex, 'label', event.target.value)} />
                    <label className="check-label"><input type="checkbox" checked={Boolean(option.hasPrice)} onChange={(event) => updateVariantOption(index, optionIndex, 'hasPrice', event.target.checked)} />له سعر</label>
                    {option.hasPrice && <input type="number" min="0" aria-label={`سعر الخيار ${optionIndex + 1}`} value={option.price} onChange={(event) => updateVariantOption(index, optionIndex, 'price', event.target.value)} />}
                    <button type="button" className="danger option-remove" aria-label={`حذف قيمة الخيار ${optionIndex + 1}`} onClick={() => removeVariantOption(index, optionIndex)}>حذف</button>
                  </div>)}
                  <button type="button" className="add-option-button" onClick={() => addVariantOption(index)}>+ إضافة قيمة</button>
                </div>
                <details className="product-variant-advanced">
                  <summary>طريقة احتساب السعر</summary>
                  <label>السعر<select value={variant.priceMode} onChange={(event) => updateVariant(index, 'priceMode', event.target.value)}><option value="add">إضافة على سعر المنتج</option><option value="replace">السعر الكامل للخيار</option></select></label>
                </details>
                <button type="button" className="remove-variant-button" aria-label={`حذف المجموعة ${variant.name || index + 1}`} onClick={() => removeVariant(index)}>حذف المجموعة</button>
              </div>)}
              {!form.variants.length && <p className="product-variants-empty">اختَر مثالاً جاهزاً أو أضف مجموعة فارغة.</p>}
            </div>
          </div>
        </section>

        <section className="product-editor-section" aria-labelledby="product-price-title">
          <div className="product-editor-section-heading"><h3 id="product-price-title">السعر والمخزون</h3></div>
          <div className="product-editor-fields">
            <label>سعر البيع<input type="number" min="0" required value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
            <label>سعر الشراء<input type="number" min="0" value={form.costPrice} onChange={(event) => setForm({ ...form, costPrice: event.target.value })} /></label>
            <label>نوع الخصم<select value={form.discountType} onChange={(event) => setForm({ ...form, discountType: event.target.value })}><option value="percentage">نسبة مئوية</option><option value="amount">مبلغ ثابت</option></select></label>
            <label>{form.discountType === 'amount' ? 'مبلغ الخصم بالدينار' : 'نسبة الخصم %'}<input type="number" min="0" max={form.discountType === 'amount' ? form.price || undefined : 100} step={form.discountType === 'amount' ? 1 : 0.01} value={form.discountValue} onChange={(event) => setForm({ ...form, discountValue: event.target.value, discountPercentage: form.discountType === 'amount' ? 0 : event.target.value })} /></label>
            <label>الكمية في المخزون<input type="number" min="0" value={form.stockQuantity} onChange={(event) => setForm((current) => {
              const stockQuantity = event.target.value;
              const nextAvailabilityMode = Number(stockQuantity) <= 0
                ? (current.availabilityMode === 'preorder' ? 'preorder' : 'unavailable')
                : (current.availabilityMode === 'unavailable' ? 'ready' : current.availabilityMode);
              return { ...current, stockQuantity, availabilityMode: nextAvailabilityMode, inStock: nextAvailabilityMode === 'ready' };
            })} /></label>
            <div className="product-editor-checks">
              <label className="check-label"><input type="radio" name="product-stock-mode" checked={form.availabilityMode === 'ready'} onChange={() => setForm({ ...form, availabilityMode: 'ready', inStock: true })} />جاهز</label>
              <label className="check-label"><input type="radio" name="product-stock-mode" checked={form.availabilityMode === 'preorder'} onChange={() => setForm({ ...form, availabilityMode: 'preorder', inStock: false })} />طلب مسبق</label>
              <label className="check-label"><input type="radio" name="product-stock-mode" checked={form.availabilityMode === 'unavailable'} onChange={() => setForm({ ...form, availabilityMode: 'unavailable', inStock: false })} />غير متوفر</label>
              <label className="check-label"><input type="checkbox" checked={form.isNew} onChange={(event) => setForm({ ...form, isNew: event.target.checked })} />منتج جديد</label>
            </div>
          </div>
        </section>

        <section className="product-editor-section" aria-labelledby="product-images-title">
          <div className="product-editor-section-heading"><h3 id="product-images-title">صور المنتج</h3></div>
          <div className="product-editor-fields">
            <label className="product-file-field">الصورة الرئيسية<input ref={primaryImageInputRef} type="file" accept="image/*" onChange={(event) => setPrimaryImageFile(event.target.files?.[0] || null)} /></label>
            <label className="product-file-field">صور إضافية<input ref={additionalImageInputRef} type="file" accept="image/*" multiple onChange={(event) => setAdditionalImageFiles(Array.from(event.target.files || []))} /></label>
            <div className="product-image-previews" aria-live="polite">
              {(imagePreviews.primary || form.imageUrl || form.productImages[0]) ? <figure className="product-image-preview"><img src={imagePreviews.primary || form.imageUrl || form.productImages[0]} alt="معاينة الصورة الرئيسية" /><button type="button" className="product-image-remove" aria-label="حذف الصورة الرئيسية" title="حذف الصورة الرئيسية" onClick={removePrimaryImage}>×</button><figcaption>الصورة الرئيسية</figcaption></figure> : <p className="product-image-preview-empty">لم يتم اختيار صورة رئيسية</p>}
              {form.productImages.filter((image) => image && (image !== (form.imageUrl || form.productImages[0]) || imagePreviews.primary)).map((image, index) => <figure className="product-image-preview" key={`saved-image-${image}`}><img src={image} alt={`صورة المنتج ${index + 2}`} /><button type="button" className="product-image-remove" aria-label={`حذف الصورة المحفوظة ${index + 1}`} title="حذف الصورة" onClick={() => removeSavedImage(image)}>×</button><figcaption>صورة محفوظة</figcaption></figure>)}
              {imagePreviews.additional.map((image, index) => <figure className="product-image-preview" key={`new-image-${index}`}><img src={image} alt={`معاينة الصورة الإضافية ${index + 1}`} /><button type="button" className="product-image-remove" aria-label={`حذف الصورة الإضافية ${index + 1}`} title="حذف الصورة" onClick={() => removeAdditionalImageFile(index)}>×</button><figcaption>صورة إضافية</figcaption></figure>)}
            </div>
          </div>
        </section>

        <footer className="product-editor-actions"><button type="submit" className="primary" disabled={saving}>{saving ? 'جاري الحفظ...' : (editingId ? 'حفظ التعديلات' : 'حفظ المنتج')}</button>{message && <p className="success-message">{message}</p>}{error && <p className="error">{error}</p>}</footer>
      </form>

      <div className="admin-table product-inventory">
        <div className="table-title">
          <h2>كل المنتجات</h2>
          <span>{items.length} منتجات</span>
        </div>
        <div className="product-inventory-list">
          {(Array.isArray(items) ? items : []).map((product) => (
            <article className="product-inventory-card" key={product.id}>
              <ProductImage src={product.imageUrl} alt={product.name} />
              <div className="product-inventory-details">
                <div className="product-main">
                  <strong>{product.name}</strong>
                  <small>{product.category || 'غير مصنَّف'}</small>
                </div>
                <div className="product-inventory-meta">
                  <strong>{money(product.price)}</strong>
                  <span>{productAvailabilityMode(product) === 'ready' ? `${product.stockQuantity} قطعة` : (productAvailabilityMode(product) === 'preorder' ? 'طلب مسبق' : 'غير متوفر')}</span>
                  <span className={productAvailabilityMode(product) === 'ready' ? 'status-ok' : 'status-warn'}>{productAvailabilityMode(product) === 'ready' ? 'جاهز' : (productAvailabilityMode(product) === 'preorder' ? 'طلب مسبق' : 'غير متوفر')}</span>
                </div>
              </div>
              <div className="inline-actions">
                <button type="button" onClick={() => startEdit(product)}>تعديل</button>
                <button type="button" className="danger" onClick={() => handleDelete(product.id)}>حذف</button>
              </div>
            </article>
          ))}
          {!items.length && <p className="product-inventory-empty">لا توجد منتجات بعد.</p>}
        </div>
      </div>
    </>
  );
}

function ProductDiscountAdmin() {
  const [items, setItems] = useState([]);

  const load = () => adminProducts().then((data) => setItems(Array.isArray(data) ? data : []));

  useEffect(() => { load(); }, []);

  const updateDiscount = (productId, field, value) => {
    setItems((current) => (Array.isArray(current) ? current : []).map((product) => {
      if (product.id !== productId) return product;
      const nextProduct = { ...product, [field]: field === 'discountType' ? value : Number(value || 0) };
      nextProduct.discountPercentage = nextProduct.discountType === 'amount' ? 0 : productDiscountValue(nextProduct);
      nextProduct.discountedPrice = getProductDiscountedPrice(nextProduct);
      return nextProduct;
    }));
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
        const finalPrice = getProductDiscountedPrice(product);
        return (
          <div className="table-row discount-row" key={product.id}>
            <strong>{product.name}</strong>
            <span>{money(product.price)}</span>
            <span>{money(finalPrice)}</span>
            <select aria-label={`نوع الخصم لمنتج ${product.name}`} value={product.discountType || 'percentage'} onChange={(event) => updateDiscount(product.id, 'discountType', event.target.value)}><option value="percentage">نسبة</option><option value="amount">مبلغ ثابت</option></select>
            <input aria-label={`قيمة الخصم لمنتج ${product.name}`} type="number" min="0" max={product.discountType === 'amount' ? product.price : 100} step={product.discountType === 'amount' ? 1 : 0.01} value={product.discountValue ?? product.discountPercentage ?? 0} onChange={(event) => updateDiscount(product.id, 'discountValue', event.target.value)} />
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingOrderId, setUpdatingOrderId] = useState(null);

  const load = async () => {
    try {
      const data = await listOrders();
      setOrders(Array.isArray(data) ? data : []);
      setError('');
    } catch {
      setError('تعذر تحميل قائمة الطلبات. تحقق من الاتصال ثم حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  const changeOrderStatus = async (id, status) => {
    setError('');
    setUpdatingOrderId(id);
    try {
      await updateOrder(id, { status, isRead: true });
      setOrders((current) => current.map((order) => order.id === id ? { ...order, status, isRead: true } : order));
    } catch {
      setError('تعذر تحديث حالة الطلب. حاول مرة أخرى.');
    } finally {
      setUpdatingOrderId(null);
    }
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
      {error && <p className="error order-error" role="alert">{error}</p>}

      {loading ? <div className="empty">جاري تحميل الطلبات...</div> : (Array.isArray(visibleOrders) ? visibleOrders : []).map((order) => (
        <article className={`order-card status-${order.status} ${order.isRead ? '' : 'unread-order'}`} key={order.id}>
          <div className="order-card-head">
            <div>
              <span className="order-id">طلب #{order.id}</span>
              <small>{new Date(order.createdAt).toLocaleString('ar-IQ')}</small>
              {!order.isRead && <b className="unread-badge">طلب غير مقروء</b>}
            </div>
            <select value={order.status} disabled={updatingOrderId === order.id} onChange={(event) => changeOrderStatus(order.id, event.target.value)}>
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
            <p><b>المجموع الفرعي</b>{money(order.subtotal)}</p>
            <p><b>كود الخصم</b>{order.discountCode || 'لا يوجد'}</p>
            <p><b>الخصم</b>{money(order.discountAmount)}</p>
            <p><b>التوصيل</b>{money(order.deliveryFee)}</p>
            <p><b>الإجمالي النهائي</b><strong>{money(order.finalTotal)}</strong></p>
          </div>

          <div className="ordered-items">
            {(Array.isArray(order.items) ? order.items : []).map((item) => <span key={`${order.id}-${item.productId}`}>{item.name} × {item.quantity}{selectedVariantText(item.selectedVariants) && ` (${selectedVariantText(item.selectedVariants)})`}</span>)}
          </div>
        </article>
      ))}

      {!loading && !error && !visibleOrders.length && <div className="empty">لا توجد طلبات حالياً</div>}
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

function AdminsAdmin() {
  const { profile } = useAuth();
  const canRemoveAdmins = profile?.isOwner === true;
  const [data, setData] = useState({ admins: [], invites: [] });
  const [loadError, setLoadError] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = () => listAdmins()
    .then((result) => ({
      admins: Array.isArray(result?.admins) ? result.admins : [],
      invites: Array.isArray(result?.invites) ? result.invites : [],
    }))
    .then((result) => { setLoadError(''); setData(result); })
    .catch((reason) => { setLoadError(supabaseErrorMessage(reason, 'تعذر تحميل المشرفين من Supabase')); setData({ admins: [], invites: [] }); });
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
    if (!canRemoveAdmins) return;
    try {
      await removeAdmin(value);
      load();
    } catch (reason) {
      setError(supabaseErrorMessage(reason, 'تعذر إزالة المشرف'));
    }
  };

  return (
    <div className="admin-managers">
      <div className="admin-table">
        <div className="table-title manager-title"><h2>المشرفون</h2><button type="button" className="manager-add-button" onClick={() => { setShowAddForm((value) => !value); setMessage(''); setError(''); }}>+</button></div>
        {loadError && <p className="error" role="alert">خطأ Supabase: {loadError}</p>}
        {(Array.isArray(data.admins) ? data.admins : []).map((admin) => <div className="table-row manager-row" key={admin.id}><strong>{admin.identifier}</strong>{admin.isOwner ? <span className="owner-label">مالك</span> : <><span>مشرف</span>{canRemoveAdmins && <button type="button" className="danger" onClick={() => handleRemoveAdmin(admin.identifier)}>إزالة</button>}</>}</div>)}
        {!data.admins.length && <p className="empty">لا يوجد مشرفون</p>}
      </div>

      {showAddForm && <form className="admin-form compact manager-add-form" onSubmit={addAdmin}>
        <input type="email" inputMode="email" placeholder="البريد الإلكتروني" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required />
        <button type="submit" className="primary">إضافة</button>
        {message && <p className="success-message">{message}</p>}
        {error && <p className="error">{error}</p>}
      </form>}

      {!!(Array.isArray(data.invites) && data.invites.length) && <div className="admin-table"><div className="table-title"><h2>الدعوات المعلقة</h2></div>{(Array.isArray(data.invites) ? data.invites : []).map((invite) => <div className="table-row manager-row" key={invite.identifier}><strong>{invite.identifier}</strong><span>بانتظار التسجيل</span>{canRemoveAdmins && <button type="button" className="danger" onClick={() => handleRemoveAdmin(invite.identifier)}>إلغاء</button>}</div>)}</div>}
    </div>
  );
}

function SiteSettingsAdmin() {
  const [settings, setSettings] = useState(defaultSettings);
  const [products, setProducts] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryNameDrafts, setCategoryNameDrafts] = useState({});
  const [uploadingCategoryId, setUploadingCategoryId] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [statusError, setStatusError] = useState('');
  const lastSavedSettings = useRef('');
  const categoryItems = getStoreCategories(settings.storeCategories, products);

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
      setStatusError(supabaseErrorMessage(reason, 'تعذر حفظ إعدادات المتجر'));
      return;
    }
  };

  useEffect(() => {
    loadSettings();
    listProducts().then((data) => setProducts(Array.isArray(data) ? data : [])).catch(() => setProducts([]));
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

  const toggleFeaturedProduct = (productId) => {
    const selectedIds = Array.isArray(settings.featuredProductIds) ? settings.featuredProductIds.map(String) : [];
    const normalizedId = String(productId);
    const nextIds = selectedIds.includes(normalizedId)
      ? selectedIds.filter((id) => id !== normalizedId)
      : [...selectedIds, normalizedId];
    setSettings({ ...settings, featuredProductIds: nextIds });
  };

  const addStoreCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return;
    if (categoryItems.some((category) => category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setStatusError('هذه الفئة موجودة مسبقًا');
      return;
    }
    setSettings((current) => ({ ...current, storeCategories: [...categoryItems, { id: crypto.randomUUID(), name, imageUrl: '' }] }));
    setNewCategoryName('');
    setStatusError('');
    setStatusMessage('تمت إضافة الفئة');
  };

  const saveStoreCategoryName = async (category) => {
    const name = String(categoryNameDrafts[category.id] ?? category.name).trim();
    if (!name) {
      setStatusError('اكتب اسم الفئة');
      return;
    }
    if (categoryItems.some((item) => item.id !== category.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setStatusError('هذه الفئة موجودة مسبقًا');
      return;
    }
    if (name === category.name) return;

    setStatusMessage('');
    setStatusError('');
    try {
      await moveProductsToCategory(category.name, name);
      setProducts((current) => current.map((product) => product.category === category.name ? { ...product, category: name } : product));
      setSettings((current) => ({ ...current, storeCategories: categoryItems.map((item) => item.id === category.id ? { ...item, name } : item) }));
      setCategoryNameDrafts((current) => ({ ...current, [category.id]: name }));
      setStatusMessage('تم تحديث اسم الفئة');
    } catch (reason) {
      setStatusError(reason.message || 'تعذر تحديث اسم الفئة');
    }
  };

  const deleteStoreCategory = async (category) => {
    const categoryProducts = products.filter((product) => product.category === category.name);
    const remainingCategories = categoryItems.filter((item) => item.id !== category.id);
    const targetCategory = remainingCategories.find((item) => item.name === 'عام')?.name || remainingCategories[0]?.name || '';
    const message = categoryProducts.length
      ? `سيتم حذف فئة «${category.name}» ونقل ${categoryProducts.length} من منتجاتها إلى «${targetCategory || 'بدون فئة'}». هل تريد المتابعة؟`
      : `هل تريد حذف فئة «${category.name}»؟`;
    if (!window.confirm(message)) return;

    setStatusMessage('');
    setStatusError('');
    try {
      if (categoryProducts.length) await moveProductsToCategory(category.name, targetCategory);
      setProducts((current) => current.map((product) => product.category === category.name ? { ...product, category: targetCategory } : product));
      setSettings((current) => ({ ...current, storeCategories: categoryItems.filter((item) => item.id !== category.id) }));
      setStatusMessage('تم حذف الفئة');
    } catch (reason) {
      setStatusError(reason.message || 'تعذر حذف الفئة');
    }
  };

  const changeStoreCategoryImage = async (category, file) => {
    if (!file) return;
    setUploadingCategoryId(category.id);
    setStatusMessage('');
    setStatusError('');
    try {
      const imageUrl = await uploadCategoryImage(file);
      setSettings((current) => ({ ...current, storeCategories: categoryItems.map((item) => item.id === category.id ? { ...item, imageUrl } : item) }));
      setStatusMessage('تم تحديث صورة الفئة');
    } catch (reason) {
      setStatusError(reason.message || 'تعذر رفع صورة الفئة');
    } finally {
      setUploadingCategoryId('');
    }
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
      <header className="settings-heading"><div><p className="eyebrow">إدارة المتجر</p><h2>إعدادات المتجر</h2></div></header>

      <section className="settings-section" aria-labelledby="settings-appearance-title">
        <div className="settings-section-heading"><span>01</span><div><h3 id="settings-appearance-title">واجهة المتجر</h3></div></div>
        <div className="settings-fields">
          <label>اسم المتجر<input placeholder="اسم المتجر" value={settings.storeName} onChange={(event) => setSettings({ ...settings, storeName: event.target.value })} /></label>
          <label>الشعار النصي<input placeholder="عبارة قصيرة تحت اسم المتجر" value={settings.tagline} onChange={(event) => setSettings({ ...settings, tagline: event.target.value })} /></label>
          <label>عنوان الواجهة<input placeholder="عنوان الواجهة الرئيسية" value={settings.heroTitle} onChange={(event) => setSettings({ ...settings, heroTitle: event.target.value })} /></label>
          <label>وصف الواجهة<textarea placeholder="اكتب وصفًا مختصرًا للمتجر" value={settings.heroDescription} onChange={(event) => setSettings({ ...settings, heroDescription: event.target.value })} /></label>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-featured-title">
        <div className="settings-section-heading"><span>02</span><div><h3 id="settings-featured-title">المنتجات المختارة</h3></div></div>
        <div className="settings-fields">
          <label className="featured-section-title-input">عنوان القسم<input placeholder="عنوان المنتجات المختارة" value={settings.featuredSectionTitle || ''} onChange={(event) => setSettings({ ...settings, featuredSectionTitle: event.target.value })} /></label>
          <div className="featured-product-settings">
            <div><strong>المنتجات المعروضة</strong><p>تلقائيًا يعرض المنتجات المميزة أو المخفّضة. يمكنك تحديد المنتجات يدويًا.</p></div>
            <button type="button" className="featured-product-auto" onClick={() => setSettings({ ...settings, featuredProductIds: null })}>استخدام الاختيار التلقائي</button>
            {products.length ? <div className="featured-product-options">{products.map((product) => {
              const selectedIds = Array.isArray(settings.featuredProductIds) ? settings.featuredProductIds.map(String) : [];
              return <label className="featured-product-option" key={product.id}><input type="checkbox" checked={selectedIds.includes(String(product.id))} onChange={() => toggleFeaturedProduct(product.id)} /><ProductImage src={product.imageUrl} alt="" /><span>{product.name}</span></label>;
            })}</div> : <p className="account-muted">لا توجد منتجات متاحة للاختيار.</p>}
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-categories-title">
        <div className="settings-section-heading"><span>03</span><div><h3 id="settings-categories-title">فئات المتجر</h3><p>عند حذف فئة، تنتقل منتجاتها إلى فئة باقية أو تصبح بلا فئة.</p></div></div>
        <div className="settings-category-manager">
          <div className="settings-category-add">
            <label>اسم الفئة الجديدة<input placeholder="مثال: حقائب" value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} /></label>
            <button type="button" className="secondary-button" onClick={addStoreCategory}>+ إضافة فئة</button>
          </div>
          <div className="settings-category-list">
            {categoryItems.map((category) => {
              const product = products.find((item) => item.category === category.name);
              return <div className="settings-category-row" key={category.id}>
                <div className="settings-category-preview"><ProductImage src={category.imageUrl || product?.imageUrl} alt={category.name} /></div>
                <label className="settings-category-name">اسم الفئة<input value={categoryNameDrafts[category.id] ?? category.name} onChange={(event) => setCategoryNameDrafts((current) => ({ ...current, [category.id]: event.target.value }))} /></label>
                <label className="settings-category-image">{uploadingCategoryId === category.id ? 'جاري رفع الصورة...' : 'تغيير الصورة'}<input type="file" accept="image/*" disabled={uploadingCategoryId === category.id} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; changeStoreCategoryImage(category, file); }} /></label>
                <div className="settings-category-actions"><button type="button" className="secondary-button" onClick={() => saveStoreCategoryName(category)}>حفظ الاسم</button><button type="button" className="danger" onClick={() => deleteStoreCategory(category)}>حذف</button></div>
              </div>;
            })}
            {!categoryItems.length && <p className="account-muted">لا توجد فئات بعد.</p>}
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-contact-title">
        <div className="settings-section-heading"><span>04</span><div><h3 id="settings-contact-title">التواصل الاجتماعي</h3></div></div>
        <div className="settings-fields">
          <label>إنستغرام<input placeholder="https://instagram.com/..." value={settings.instagramUrl} onChange={(event) => setSettings({ ...settings, instagramUrl: event.target.value })} /></label>
          <label>تيك توك<input placeholder="https://tiktok.com/@..." value={settings.tiktokUrl} onChange={(event) => setSettings({ ...settings, tiktokUrl: event.target.value })} /></label>
          <label>فيسبوك<input placeholder="https://facebook.com/..." value={settings.facebookUrl} onChange={(event) => setSettings({ ...settings, facebookUrl: event.target.value })} /></label>
          <label>واتساب<input placeholder="رابط محادثة واتساب" value={settings.whatsappUrl} onChange={(event) => setSettings({ ...settings, whatsappUrl: event.target.value })} /></label>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-content-title">
        <div className="settings-section-heading"><span>05</span><div><h3 id="settings-content-title">المحتوى والسياسات</h3></div></div>
        <div className="settings-fields">
          <label>عنوان «من نحن»<input placeholder="عنوان قسم من نحن" value={settings.aboutTitle} onChange={(event) => setSettings({ ...settings, aboutTitle: event.target.value })} /></label>
          <label>نص «من نحن»<textarea placeholder="اكتب نبذة عن المتجر" value={settings.aboutText} onChange={(event) => setSettings({ ...settings, aboutText: event.target.value })} /></label>
          <label>عنوان السياسة<input placeholder="عنوان صفحة السياسة" value={settings.policyTitle} onChange={(event) => setSettings({ ...settings, policyTitle: event.target.value })} /></label>
          <label>نص السياسة<textarea placeholder="اكتب سياسة المتجر" value={settings.policyText} onChange={(event) => setSettings({ ...settings, policyText: event.target.value })} /></label>
        </div>
      </section>

      <section className="settings-section settings-operations" aria-labelledby="settings-operations-title">
        <div className="settings-section-heading"><span>06</span><div><h3 id="settings-operations-title">حالة المتجر</h3><p>تحكم بتوفر الطلبات أو أعد ضبط بيانات المتجر.</p></div></div>
        <label className="maintenance-control"><input type="checkbox" checked={Boolean(settings.maintenanceMode)} onChange={(event) => setSettings({ ...settings, maintenanceMode: event.target.checked })} /><span><strong>وضع الصيانة</strong><small>يسمح بالتصفح ويوقف إضافة المنتجات وإرسال الطلبات.</small></span></label>
        <button type="button" className="danger" onClick={resetStore}>إعادة ضبط المتجر</button>
      </section>

      <div className="settings-actions"><button type="submit" className="primary">حفظ الإعدادات</button>
      {statusMessage && <p className="success-message">{statusMessage}</p>}
      {statusError && <p className="error">{statusError}</p>}
      </div>
    </form>
  );
}

export default App;
