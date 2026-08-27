import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { auth } from '../lib/firebase';
import { Rocket, CheckCircle2, AlertTriangle, Circle, Loader2, ChevronRight } from 'lucide-react';
import { STEP_ROUTES } from './Aggregator/onboarding/steps';

type StepStatus = 'complete' | 'needs_attention' | 'pending';

interface Step {
  key: string;
  label: string;
  status: StepStatus;
  detail: string;
  progress: { current: number; target: number } | null;
}

// Self-attested review steps -- no Google API exists for either, matching
// this app's established "a human reports it" pattern (UploadBatchRepository.mark_verified).
const REVIEW_STEP_FIELD: Record<string, 'sandbox_to_prod_review_status' | 'launch_review_status'> = {
  sandbox_to_prod_review: 'sandbox_to_prod_review_status',
  launch_review: 'launch_review_status',
};
const REVIEW_STEP_BUTTON_LABEL: Record<string, string> = {
  sandbox_to_prod_review: 'Request Sandbox-to-Production Review',
  launch_review: 'Request Launch Review',
};

function ProgressSegments({ current, target }: { current: number; target: number }) {
  return (
    <div className="flex gap-1 mt-1.5 max-w-[120px]">
      {Array.from({ length: target }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full ${i < current ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-600'}`}
        />
      ))}
    </div>
  );
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'complete') return <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />;
  if (status === 'needs_attention') return <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />;
  return <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 flex-shrink-0" />;
}

export function OnboardingJourney() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [overall, setOverall] = useState<{ complete: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = async () => {
    const res = await api.getOnboardingJourney();
    if (res.status === 'error') {
      setError(res.message || 'Could not load onboarding journey.');
      return;
    }
    setError(null);
    setSteps(res.steps || []);
    setOverall(res.overall_progress || null);
  };

  useEffect(() => {
    auth.authStateReady().then(() => {
      const user = auth.currentUser;
      if (user) setOrgId(user.uid);
    });
    load();
  }, []);

  const handleAttest = async (stepKey: string) => {
    if (!orgId) return;
    const field = REVIEW_STEP_FIELD[stepKey];
    if (!field) return;
    setSavingKey(stepKey);
    try {
      await api.updateOrganizationConfig(orgId, { [field]: 'approved' });
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not save.');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Rocket className="w-5 h-5 text-blue-500" />
          Google Ordering Redirect Onboarding
        </h2>
        {overall && (
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            overall.complete === overall.total ? 'bg-green-100 text-green-700' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
          }`}>
            {overall.complete} / {overall.total} complete
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Google exposes no API to confirm where you actually stand in this journey -- these statuses are
        computed from your own feed and conversion history, plus what you've self-reported below.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {error}
        </div>
      )}

      {!steps ? (
        <div className="h-64 animate-pulse bg-slate-100 dark:bg-slate-700 rounded-lg" />
      ) : (
        <div className="space-y-2">
          {steps.map((step) => {
            const isReviewStep = step.key in REVIEW_STEP_FIELD;
            return (
              <div
                key={step.key}
                className="flex items-start justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm"
              >
                <Link
                  to={STEP_ROUTES[step.key as keyof typeof STEP_ROUTES] || '#'}
                  className="flex items-start gap-2 flex-1 min-w-0 hover:opacity-80"
                >
                  <StatusIcon status={step.status} />
                  <div className="min-w-0">
                    <span className="font-medium text-slate-900 dark:text-white flex items-center gap-1">
                      {step.label}
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{step.detail}</span>
                    {step.progress && <ProgressSegments current={step.progress.current} target={step.progress.target} />}
                  </div>
                </Link>

                {isReviewStep && step.status === 'needs_attention' && (
                  <button
                    onClick={() => handleAttest(step.key)}
                    disabled={savingKey === step.key}
                    className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg flex items-center gap-1.5 flex-shrink-0"
                    title="Marks this as approved once Google confirms it in Partner Portal -- this button does not contact Google."
                  >
                    {savingKey === step.key ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    {REVIEW_STEP_BUTTON_LABEL[step.key]}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
