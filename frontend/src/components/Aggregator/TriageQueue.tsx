import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { AlertCircle, CheckCircle, XCircle } from 'lucide-react';

export function TriageQueue() {
  const [queue, setQueue] = useState<any[]>([]);

  useEffect(() => {
    fetchQueue();
  }, []);

  const fetchQueue = () => {
    api.getTriageQueue().then(data => setQueue(data.queue)).catch(console.error);
  };

  const handleResolve = async (id: string, action: string) => {
    await api.resolveTriage(id, action);
    // Remove from UI optimistically or refetch
    setQueue(q => q.filter(item => item.id !== id));
  };

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
        <AlertCircle className="w-5 h-5 text-amber-500" />
        Global Triage Queue
      </h2>
      
      {queue.length === 0 ? (
        <p className="text-sm text-slate-500">No items pending review.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
            <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
              <tr>
                <th className="px-4 py-3 rounded-tl-lg">Merchant</th>
                <th className="px-4 py-3">Confidence</th>
                <th className="px-4 py-3">Issue</th>
                <th className="px-4 py-3 rounded-tr-lg">Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.map(item => (
                <tr key={item.id} className="bg-white dark:bg-slate-800 border-b dark:border-slate-700">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{item.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.confidence < 0.8 ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                      {(item.confidence * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-4 py-3">{item.issue}</td>
                  <td className="px-4 py-3 flex gap-2">
                    <button 
                      onClick={() => handleResolve(item.id, 'approve')}
                      className="p-1 text-green-600 hover:bg-green-50 rounded" title="Approve"
                    >
                      <CheckCircle className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={() => handleResolve(item.id, 'reject')}
                      className="p-1 text-red-600 hover:bg-red-50 rounded" title="Reject"
                    >
                      <XCircle className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
