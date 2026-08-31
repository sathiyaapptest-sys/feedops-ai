import { Outlet, useNavigate, NavLink } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { LogOut, LayoutDashboard, Layers, HelpCircle, Activity } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/aggregator/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/aggregator/merchants', label: 'Merchants', icon: Layers },
  { to: '/aggregator/activity', label: 'Activity Logs', icon: Activity },
  { to: '/aggregator/ask', label: 'Ask FeedOps', icon: HelpCircle },
];


export default function AggregatorLayout() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  return (
    <div className="h-screen bg-slate-50 dark:bg-slate-900 flex overflow-hidden">
      {/* Sidebar -- fixed height, no scroll of its own; only <main> below scrolls */}
      <aside className="w-64 flex-shrink-0 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col">
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

      {/* Main Content -- the only scrollable region. Padding lives on the
          inner div, not <main> itself: a position:sticky descendant (see
          StepNav.tsx) sticks relative to its nearest scrolling ancestor's
          OWN padding box, so padding directly on <main> forces a permanent
          gap at the scrolled-to-top position that isn't part of the sticky
          element's own (opaque) box -- confirmed live, whatever scrolls
          into that gap show through underneath the sticky bar instead of
          being covered by it. Padding one level in avoids that entirely. */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
