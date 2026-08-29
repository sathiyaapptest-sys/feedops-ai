import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Activity } from 'lucide-react';

interface ReadinessScorecardProps {
  // Bumped by a sibling action (e.g. a bulk restaurant upload) that changed
  // merchant data this component doesn't own -- refetches when it changes.
  refreshToken?: number;
}

export function ReadinessScorecard({ refreshToken }: ReadinessScorecardProps) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.getReadiness().then(setData).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  if (!data) return <div className="p-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 animate-pulse h-32"></div>;

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-500" />
          Launch Readiness Score
        </h2>
        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
          {data.status}
        </span>
      </div>
      
      <div className="flex items-end gap-4">
        <div className="text-4xl font-bold text-slate-900 dark:text-white">{data.score}%</div>
        <div className="text-sm text-slate-500 dark:text-slate-400 pb-1">
          {data.metrics.fully_operational} / {data.metrics.total} entities fully operational
        </div>
      </div>
      
      <div className="mt-4 w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2.5">
        <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${data.score}%` }}></div>
      </div>
    </div>
  );
}
