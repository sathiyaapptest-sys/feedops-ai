import { useState } from 'react';
import { Settings } from 'lucide-react';
import { AgentStreamViewer } from './AgentStreamViewer';

export function Services() {
  const [orderingRedirect, setOrderingRedirect] = useState(true);

  return (
    <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Left Column: Toggles */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-200 dark:border-slate-700">
          <Settings className="w-6 h-6 text-green-500" />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Service Settings</h1>
        </div>

        <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-6">
          <div className="space-y-4">
            <label className="flex items-start space-x-3 cursor-pointer p-4 border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <div className="flex items-center h-5">
                <input 
                  type="checkbox" 
                  checked={orderingRedirect} 
                  onChange={(e) => setOrderingRedirect(e.target.checked)} 
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 cursor-pointer" 
                />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-slate-900 dark:text-white">Google Ordering Redirect</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">Uses your Store Profile details to generate the Sandbox Action and Service feeds daily at 9am.</span>
              </div>
            </label>
          </div>

          <div className="pt-4 flex justify-end">
            <button className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors">
              Save Configuration
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Terminal */}
      <div className="lg:h-[calc(100vh-8rem)]">
        <AgentStreamViewer />
      </div>
    </div>
  );
}
