import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { AlertTriangle, ArrowRight, Rocket } from 'lucide-react';
import { FeedStatus } from '../FeedStatus';
import { FeedHealth } from '../FeedHealth';
import { EntityMatchAssist } from '../EntityMatchAssist';

interface FeedsStepProps {
  environment: 'sandbox' | 'production';
}

// Entity matching isn't environment-scoped (a merchant's Google Maps match is
// the same in sandbox or production) -- rendered once here, under Sandbox
// specifically, since that's the earlier of the two feed steps and where a
// bad match would get caught first per Google's real launch checklist
// ("majority of entity data matches Google Maps locations").
export function FeedsStep({ environment }: FeedsStepProps) {
  const [totalMerchants, setTotalMerchants] = useState<number | null>(null); // null = loading
  const [hasPushed, setHasPushed] = useState<boolean | null>(null); // null = loading

  useEffect(() => {
    api.getReadiness()
      .then((res) => setTotalMerchants(res?.metrics?.total ?? 0))
      .catch(() => setTotalMerchants(0));
    api.getBatches()
      .then((res) => setHasPushed((res.batches || []).some((b: any) => b.environment === environment)))
      .catch(() => setHasPushed(false));
  }, [environment]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
        Feeds ready in {environment === 'sandbox' ? 'Sandbox' : 'Production'}
      </h1>

      {totalMerchants === 0 && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 rounded-xl border border-amber-200 dark:border-amber-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">No merchant data on file yet</p>
            <p className="text-sm mt-0.5">
              A feed is compiled from your merchant roster -- upload your restaurant data first, or "Upload Now"
              below will correctly refuse to push (it will not substitute demo data).
            </p>
            <Link
              to="/aggregator/merchants"
              className="inline-flex items-center gap-1 mt-2 text-sm font-medium hover:underline"
            >
              Go to Merchants to upload data <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}

      {totalMerchants !== null && totalMerchants > 0 && hasPushed === false && (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 rounded-xl border border-blue-200 dark:border-blue-800 flex items-start gap-3">
          <Rocket className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">You have {totalMerchants} merchant(s) ready -- nothing's been pushed to {environment} yet</p>
            <p className="text-sm mt-0.5">
              Click "Upload Now" in Feed Health below to compile and push your first feed. After that, check
              Partner Portal &rarr; Ingestion &rarr; History and come back to Feed Status above to mark each
              file Accepted or Rejected -- that's what builds progress toward launch.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FeedStatus environment={environment} />
        <FeedHealth environment={environment} />
        {environment === 'sandbox' && <EntityMatchAssist />}
      </div>
    </div>
  );
}
