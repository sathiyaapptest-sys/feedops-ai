import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { MapPin, Clock, Phone, Loader2, Utensils, Info, ShoppingBag, Plus, Minus, X, CheckCircle } from 'lucide-react';

interface StoreProfile {
  storeName: string;
  address: string;
  phone: string;
  serviceOptions: {
    delivery: boolean;
    takeaway: boolean;
    inStore: boolean;
  };
  timings: Array<{
    day: string;
    isOpen: boolean;
    openTime: string;
    closeTime: string;
  }>;
}

interface MenuItem {
  name: string;
  price: string;
  category: string;
  description: string;
}

interface CartItem extends MenuItem {
  quantity: number;
}

export function StoreView() {
  const { storeId } = useParams<{ storeId: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [store, setStore] = useState<StoreProfile | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  
  // Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [orderConfirmed, setOrderConfirmed] = useState(false);

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.name === item.name);
      if (existing) {
        return prev.map(i => i.name === item.name ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const removeFromCart = (itemName: string) => {
    setCart(prev => {
      const existing = prev.find(i => i.name === itemName);
      if (existing && existing.quantity > 1) {
        return prev.map(i => i.name === itemName ? { ...i, quantity: i.quantity - 1 } : i);
      }
      return prev.filter(i => i.name !== itemName);
    });
  };

  const cartTotal = cart.reduce((total, item) => total + (Number(item.price) * item.quantity), 0);
  const cartItemCount = cart.reduce((count, item) => count + item.quantity, 0);

  const handleCheckout = () => {
    // Native Mock Payment Flow
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setOrderConfirmed(true);
      setCart([]); // Clear cart
    }, 2000); // 2 second mock delay
  };

  useEffect(() => {
    async function fetchStoreData() {
      if (!storeId) return;
      setLoading(true);
      setError(null);
      
      try {
        // Fetch Store Profile
        const storeRef = doc(db, 'stores', storeId);
        const storeSnap = await getDoc(storeRef);
        
        if (!storeSnap.exists()) {
          setError('Store not found.');
          setLoading(false);
          return;
        }
        
        setStore(storeSnap.data() as StoreProfile);

        // Fetch Menu
        const menuRef = doc(db, 'menus', storeId);
        const menuSnap = await getDoc(menuRef);
        
        if (menuSnap.exists()) {
          const menuData = menuSnap.data();
          if (menuData.items && Array.isArray(menuData.items)) {
            setMenu(menuData.items);
          }
        }
      } catch (err: any) {
        console.error(err);
        setError('Failed to load store data.');
      } finally {
        setLoading(false);
      }
    }

    fetchStoreData();
  }, [storeId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
        <Utensils className="w-16 h-16 text-slate-300 dark:text-slate-700 mb-4" />
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{error || 'Store Not Found'}</h1>
        <p className="text-slate-500 dark:text-slate-400 mb-6 text-center">The store you are looking for does not exist or has been removed.</p>
        <Link to="/" className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
          Return Home
        </Link>
      </div>
    );
  }

  // Get unique categories
  const categories = ['All', ...Array.from(new Set(menu.map(item => item.category || 'Uncategorized')))];

  // Filter menu items
  const filteredMenu = activeCategory === 'All' 
    ? menu 
    : menu.filter(item => (item.category || 'Uncategorized') === activeCategory);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 font-sans">
      {/* Hero Section */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-16">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div className="space-y-4">
              <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                {store.storeName || 'Store Profile'}
              </h1>
              
              <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-300">
                {store.address && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-slate-400" />
                    <span>{store.address}</span>
                  </div>
                )}
                {store.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-4 h-4 text-slate-400" />
                    <span>{store.phone}</span>
                  </div>
                )}
              </div>

              {/* Service Options Tags */}
              {store.serviceOptions && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {store.serviceOptions.delivery && (
                    <span className="px-3 py-1 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-full text-xs font-semibold border border-blue-200 dark:border-blue-800">
                      Delivery Available
                    </span>
                  )}
                  {store.serviceOptions.takeaway && (
                    <span className="px-3 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 rounded-full text-xs font-semibold border border-emerald-200 dark:border-emerald-800">
                      Takeaway
                    </span>
                  )}
                  {store.serviceOptions.inStore && (
                    <span className="px-3 py-1 bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded-full text-xs font-semibold border border-purple-200 dark:border-purple-800">
                      Dine-in
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Timings Card (Simplified) */}
            {store.timings && store.timings.length > 0 && (
               <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 min-w-[250px]">
                 <div className="flex items-center gap-2 mb-3 text-slate-900 dark:text-white font-medium">
                   <Clock className="w-5 h-5 text-amber-500" />
                   Opening Hours
                 </div>
                 <div className="space-y-1.5 text-sm">
                   {/* Just showing today for brevity in the hero, or all days if preferred. Showing all compressed */}
                   {store.timings.map(t => {
                     const isToday = new Date().toLocaleDateString('en-US', { weekday: 'long' }) === t.day;
                     return (
                       <div key={t.day} className={`flex justify-between ${isToday ? 'font-bold text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400'}`}>
                         <span>{t.day.substring(0, 3)}</span>
                         <span>{t.isOpen ? `${t.openTime} - ${t.closeTime}` : 'Closed'}</span>
                       </div>
                     )
                   })}
                 </div>
               </div>
            )}
          </div>
        </div>
      </div>

      {/* Menu Section */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">Menu</h2>
        
        {menu.length === 0 ? (
          <div className="p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <Info className="w-12 h-12 text-slate-400 mx-auto mb-3" />
            <p className="text-slate-500 dark:text-slate-400">This store hasn't published their menu yet.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Category Filter */}
            <div className="flex overflow-x-auto pb-2 gap-2 scrollbar-hide">
              {categories.map(category => (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    activeCategory === category 
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-md' 
                      : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>

            {/* Menu Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredMenu.map((item, index) => (
                <div key={index} className="group bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all hover:border-blue-200 dark:hover:border-blue-800/50 flex flex-col h-full">
                  <div className="flex justify-between items-start mb-2 gap-4">
                    <h3 className="font-bold text-slate-900 dark:text-white leading-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {item.name}
                    </h3>
                    <span className="font-semibold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-lg text-sm shrink-0">
                      ${Number(item.price).toFixed(2)}
                    </span>
                  </div>
                  
                  {item.description && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 flex-grow line-clamp-3">
                      {item.description}
                    </p>
                  )}
                  
                  <div className="mt-auto pt-4 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      {item.category || 'Uncategorized'}
                    </span>
                    
                    {cart.find(c => c.name === item.name) ? (
                      <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-700 rounded-full px-2 py-1">
                        <button onClick={() => removeFromCart(item.name)} className="w-6 h-6 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-red-600 transition-colors">
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-sm font-bold text-slate-900 dark:text-white min-w-[1ch] text-center">
                          {cart.find(c => c.name === item.name)?.quantity}
                        </span>
                        <button onClick={() => addToCart(item)} className="w-6 h-6 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-blue-600 transition-colors">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => addToCart(item)} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-600 dark:bg-slate-700 dark:hover:bg-blue-900/40 dark:text-slate-300 dark:hover:text-blue-400 flex items-center justify-center transition-colors">
                        <Plus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Floating Cart Summary Button */}
      {cartItemCount > 0 && !isCheckoutModalOpen && !orderConfirmed && (
        <div className="fixed bottom-6 left-0 right-0 z-40 flex justify-center px-4 animate-in slide-in-from-bottom-10 fade-in duration-300">
          <button 
            onClick={() => setIsCheckoutModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white shadow-xl shadow-blue-900/20 rounded-full px-6 py-3 flex items-center gap-4 w-full max-w-sm transition-transform active:scale-95"
          >
            <div className="bg-white/20 rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm shrink-0">
              {cartItemCount}
            </div>
            <span className="font-semibold flex-1 text-left">View Cart</span>
            <span className="font-bold">${cartTotal.toFixed(2)}</span>
          </button>
        </div>
      )}

      {/* Checkout Modal */}
      {isCheckoutModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-0">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !isProcessing && setIsCheckoutModalOpen(false)}></div>
          
          <div className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col relative z-10 shadow-2xl animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                <ShoppingBag className="w-5 h-5" />
                Your Order
              </h3>
              <button 
                onClick={() => !isProcessing && setIsCheckoutModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                disabled={isProcessing}
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 flex-1">
              <div className="space-y-4">
                {cart.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-start">
                    <div>
                      <div className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                        <span>{item.name}</span>
                        <span className="text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">x{item.quantity}</span>
                      </div>
                      <div className="text-sm text-slate-500">${Number(item.price).toFixed(2)} each</div>
                    </div>
                    <div className="font-semibold text-slate-900 dark:text-white">
                      ${(Number(item.price) * item.quantity).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                <div className="flex justify-between items-center mb-2 text-slate-500 dark:text-slate-400">
                  <span>Subtotal</span>
                  <span>${cartTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center mb-2 text-slate-500 dark:text-slate-400">
                  <span>Taxes (Estimated)</span>
                  <span>${(cartTotal * 0.08).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center font-bold text-lg text-slate-900 dark:text-white mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <span>Total</span>
                  <span>${(cartTotal * 1.08).toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 rounded-b-2xl shrink-0">
              <button 
                onClick={handleCheckout}
                disabled={isProcessing}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-80"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing Payment...
                  </>
                ) : (
                  `Pay ${(cartTotal * 1.08).toFixed(2)}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order Confirmed Modal */}
      {orderConfirmed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setOrderConfirmed(false)}></div>
          <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl w-full max-w-sm relative z-10 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="w-8 h-8" />
            </div>
            <h3 className="font-bold text-2xl text-slate-900 dark:text-white mb-2">Order Confirmed!</h3>
            <p className="text-slate-500 dark:text-slate-400 mb-6">Your order has been received by {store?.storeName} and is being prepared.</p>
            <button 
              onClick={() => setOrderConfirmed(false)}
              className="w-full py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-900 dark:text-white rounded-xl font-medium transition-colors"
            >
              Back to Menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
