import { Outlet, useNavigate, NavLink } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { LogOut, LayoutDashboard, Layers } from 'lucide-react';

// Nav is deliberately just these two: Dashboard is the 7-step Google
// Ordering Redirect journey (Setup through Launch Review) -- every step's
// page is reached by clicking into it from there, not from a flat top-level
// list. Merchants is roster + entity-matching ops, which isn't part of that
// journey at all.
const NAV_ITEMS = [
  { to: '/aggregator/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/aggregator/merchants', label: 'Merchants', icon: Layers },
];

export default function AggregatorLayout() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">FeedOps Aggregator</h2>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-700">
          <button 
            onClick={handleLogout}
            className="flex items-center space-x-3 px-3 py-2 w-full text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
          >
            <LogOut className="w-5 h-5" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
