import { Outlet, useNavigate, NavLink } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { LogOut, Store, Menu, Sparkles, HelpCircle } from 'lucide-react';

export default function MerchantLayout() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-900 flex">
      {/* Static Fixed Sidebar */}
      <aside className="w-64 h-screen shrink-0 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col z-20">
        <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm font-bold text-sm">
            FO
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white leading-tight">Merchant Portal</h2>
            <p className="text-[11px] text-slate-500">Google Actions Center</p>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
          <NavLink
            to="/merchant/store"
            className={({ isActive }) => `flex items-center space-x-3 px-3.5 py-2.5 rounded-xl transition-all text-sm ${isActive ? 'bg-blue-600 text-white font-semibold shadow-md shadow-blue-500/20' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 font-medium'}`}
          >
            <Store className="w-4 h-4" />
            <span>My Store Profile</span>
          </NavLink>
          <NavLink 
            to="/merchant/services" 
            className={({ isActive }) => `flex items-center space-x-3 px-3.5 py-2.5 rounded-xl transition-all text-sm ${isActive ? 'bg-blue-600 text-white font-semibold shadow-md shadow-blue-500/20' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 font-medium'}`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Services &amp; Feeds</span>
          </NavLink>
          <NavLink 
            to="/merchant/menu" 
            className={({ isActive }) => `flex items-center space-x-3 px-3.5 py-2 rounded-xl transition-all text-sm ${isActive ? 'bg-blue-600 text-white font-semibold shadow-md shadow-blue-500/20' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 font-medium'}`}
          >
            <Menu className="w-4 h-4 shrink-0" />
            <div className="flex flex-col leading-tight">
              <span>Menu &amp; Dishes</span>
              <span className="text-[10px] opacity-75 font-normal">
                (Optional)
              </span>
            </div>
          </NavLink>
          <NavLink
            to="/merchant/ask"
            className={({ isActive }) => `flex items-center space-x-3 px-3.5 py-2.5 rounded-xl transition-all text-sm ${isActive ? 'bg-blue-600 text-white font-semibold shadow-md shadow-blue-500/20' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 font-medium'}`}
          >
            <HelpCircle className="w-4 h-4" />
            <span>Ask FeedOps</span>
          </NavLink>
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-700">
          <button 
            onClick={handleLogout}
            className="flex items-center space-x-3 px-3.5 py-2.5 w-full text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors text-sm font-medium"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Right Side: Scrollable Details Area */}
      <main className="flex-1 h-screen overflow-y-auto bg-slate-50 dark:bg-slate-900">
        <Outlet />
      </main>
    </div>
  );
}
