import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { auth } from '../../../lib/firebase';
import { ClipboardCheck, CheckCircle2, AlertTriangle, Circle, Loader2 } from 'lucide-react';

type StepStatus = 'complete' | 'needs_attention' | 'pending';

interface Step {
  key: string;
  label: string;
  status: StepStatus;
  detail: string;
}

interface ReviewStepConfig {
  field: 'sandbox_to_prod_review_status' | 'launch_review_status';
  title: string;
  prerequisites: string[];
  blurb: string;
}

const REVIEW_STEP_CONFIG: Record<string, ReviewStepConfig> = {
  sandbox_to_prod_review: {
    field: 'sandbox_to_prod_review_status',
    title: 'Sandbox to Production Review',
    prerequisites: ['feeds_sandbox', 'conversion_sandbox'],
    blurb:
      'Once the checklist below is clear, request this review from Google\'s own Partner Portal -> Onboarding Plan page. Google evaluates a subset of your submitted entities. When they respond, record the real outcome here.',
  },
  launch_review: {
    field: 'launch_review_status',
    title: 'Launch Review',
    prerequisites: ['sandbox_to_prod_review', 'feeds_production', 'conversion_production'],
    blurb:
      'Google also checks Contact Information and Brand configuration (logo, domain, merchant sign-up/opt-out URLs) in Partner Portal before launch -- neither is tracked in this app yet, so verify those there directly. Production Review can take up to 7 business days.',
  },
};

interface ReviewStepProps {
  stepKey: 'sandbox_to_prod_review' | 'launch_review';
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'complete') return <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />;
  if (status === 'needs_attention') return <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />;
  return <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600 flex-shrink-0" />;
}

export function ReviewStep({ stepKey }: ReviewStepProps) {
  const config = REVIEW_STEP_CONFIG[stepKey];
  const [orgId, setOrgId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await api.getOnboardingJourney();
    if (res.status === 'error') {
      setError(res.message || 'Could not load onboarding journey.');
      return;
    }
    setError(null);
    setSteps((res.steps as Step[]) || []);
  };

  useEffect(() => {
    auth.authStateReady().then(() => {
      const user = auth.currentUser;
      if (user) setOrgId(user.uid);
    });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  const handleAttest = async (value: 'approved' | 'rejected') => {
    if (!orgId) return;
    setSaving(true);
    try {
      await api.updateOrganizationConfig(orgId, { [config.field]: value });
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const thisStep = steps?.find((s) => s.key === stepKey);
  const prereqSteps = config.prerequisites.map((key) => steps?.find((s) => s.key === key)).filter(Boolean) as Step[];
  // Require thisStep to actually be loaded before ever showing the attest
  // buttons -- `undefined !== 'pending'` is true, so without this guard a
  // failed/incomplete fetch (e.g. an auth-not-ready-yet 401 on first render)
  // would silently render "ready to record Approve/Reject" against no data.
  const canRequest = !!thisStep && thisStep.status !== 'pending';

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
        <ClipboardCheck className="w-6 h-6 text-blue-500" />
        {config.title}
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">{config.blurb}</p>

      <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-6">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
            {error}
          </div>
        )}

        {!steps ? (
          <div className="h-32 animate-pulse bg-slate-100 dark:bg-slate-700 rounded-lg" />
        ) : (
          <>
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Checklist</h2>
              {prereqSteps.map((s) => (
                <div key={s.key} className="flex items-center gap-2 text-sm">
                  <StatusIcon status={s.status} />
                  <span className="text-slate-700 dark:text-slate-300">{s.label}</span>
                  <span className="text-xs text-slate-400">-- {s.detail}</span>
                </div>
              ))}
            </div>

            {thisStep?.status === 'complete' ? (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Approved.
              </div>
            ) : !canRequest ? (
              <div className="p-3 bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-300 rounded-lg text-sm">
                {thisStep?.detail || 'Complete the checklist above first.'}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 rounded-lg text-sm">
                  {thisStep?.detail}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAttest('approved')}
                    disabled={saving}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2"
                    title="Records that Google approved this review -- doesn't contact Google."
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Mark Approved
                  </button>
                  <button
                    onClick={() => handleAttest('rejected')}
                    disabled={saving}
                    className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:text-red-300 disabled:opacity-50 text-sm font-medium rounded-lg"
                    title="Records that Google rejected this review -- doesn't contact Google."
                  >
                    Mark Rejected
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
