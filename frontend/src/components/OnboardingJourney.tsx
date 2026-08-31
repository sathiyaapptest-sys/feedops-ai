import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { auth } from '../lib/firebase';
import { Rocket, CheckCircle2, AlertTriangle, Circle, Loader2, ChevronRight, ChevronDown, ChevronUp, UtensilsCrossed, Image as ImageIcon } from 'lucide-react';
import { STEP_ROUTES, MENU_STEP_ROUTES } from './Aggregator/onboarding/steps';

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
// feeds_sandbox/feeds_production also live here: for an aggregator who
// already cleared Google's real 3-day requirement before this app's local
// push history existed (or has gaps in it from debugging), this overrides
// the locally-computed streak the same way a review step overrides nothing
// being computed at all.
const REVIEW_STEP_FIELD: Record<string, 'sandbox_to_prod_review_status' | 'launch_review_status' | 'feeds_sandbox_override_status' | 'feeds_production_override_status'> = {
  feeds_sandbox: 'feeds_sandbox_override_status',
  sandbox_to_prod_review: 'sandbox_to_prod_review_status',
  feeds_production: 'feeds_production_override_status',
  launch_review: 'launch_review_status',
};
const REVIEW_STEP_BUTTON_LABEL: Record<string, string> = {
  feeds_sandbox: 'Confirm Already Live in Sandbox',
  sandbox_to_prod_review: 'Request Sandbox-to-Production Review',
  feeds_production: 'Confirm Already Live in Production',
  launch_review: 'Request Launch Review',
};
const REVIEW_STEP_TITLE: Record<string, string> = {
  feeds_sandbox: 'Overrides the locally-computed 3-day streak -- only click this once you have real evidence (e.g. the Portal Screenshot suggestion below, or your own check of Partner Portal) that Google already shows this complete.',
  feeds_production: 'Overrides the locally-computed 3-day streak -- only click this once you have real evidence (e.g. the Portal Screenshot suggestion below, or your own check of Partner Portal) that Google already shows this complete.',
};
const DEFAULT_REVIEW_STEP_TITLE = 'Marks this as approved once Google confirms it in Partner Portal -- this button does not contact Google.';

interface PortalStepSuggestion {
  status: 'complete' | 'needs_attention';
  evidence: string;
}

// Menu Feeds' own review-step field/button maps -- separate track, never
// merged with the Redirect journey above.
const MENU_REVIEW_STEP_FIELD: Record<string, 'menu_sandbox_review_status' | 'menu_launch_review_status'> = {
  menu_sandbox_review: 'menu_sandbox_review_status',
  menu_launch_review: 'menu_launch_review_status',
};
const MENU_REVIEW_STEP_BUTTON_LABEL: Record<string, string> = {
  menu_sandbox_review: 'Request Menu Sandbox Review',
  menu_launch_review: 'Request Menu Launch Review',
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
  // Populated by uploading one screenshot of Partner Portal's own 7-step
  // Onboarding Plan screen -- it shows this app's exact same steps with a
  // green/red marker per row, so one upload can suggest a status for every
  // step at once instead of checking each one separately.
  const [portalSuggestions, setPortalSuggestions] = useState<Record<string, PortalStepSuggestion>>({});
  const [analyzingPortal, setAnalyzingPortal] = useState(false);
  const [portalAnalysisNote, setPortalAnalysisNote] = useState<string | null>(null);

  // Menu Feeds -- separate, opt-in track. `menuEnabled` gates whether the
  // second card renders at all; null while loading.
  const [menuEnabled, setMenuEnabled] = useState<boolean | null>(null);
  const [menuSteps, setMenuSteps] = useState<Step[] | null>(null);
  const [menuOverall, setMenuOverall] = useState<{ complete: number; total: number } | null>(null);
  const [menuSavingKey, setMenuSavingKey] = useState<string | null>(null);
  const [menuCollapsed, setMenuCollapsed] = useState(false);

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

  const loadMenu = async () => {
    const res = await api.getMenuOnboardingJourney();
    if (res.status === 'error') return; // silent -- this card just won't render, doesn't block the main journey
    setMenuEnabled(!!res.enabled);
    setMenuSteps(res.steps || []);
    setMenuOverall(res.overall_progress || null);
  };

  useEffect(() => {
    auth.authStateReady().then(() => {
      const user = auth.currentUser;
      if (user) setOrgId(user.uid);
    });
    load();
    loadMenu();
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

  const handlePortalScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setAnalyzingPortal(true);
    setPortalAnalysisNote(null);
    try {
      const res = await api.analyzeFeedScreenshot(file);
      if (res.status === 'error') {
        setPortalAnalysisNote(res.message || 'Could not read that screenshot.');
      } else if (res.data.screen_type !== 'onboarding_plan' || !res.data.onboarding_step_suggestions?.length) {
        setPortalAnalysisNote(
          "That doesn't look like Partner Portal's 7-step Onboarding Plan screen (or no step markers were readable) -- " +
          'upload a screenshot of that specific overview screen for per-step suggestions.'
        );
      } else {
        const next: Record<string, PortalStepSuggestion> = {};
        for (const s of res.data.onboarding_step_suggestions) {
          if (s.suggested_status === 'complete' || s.suggested_status === 'needs_attention') {
            next[s.step_key] = { status: s.suggested_status, evidence: s.evidence_quote };
          }
        }
        setPortalSuggestions(next);
        setPortalAnalysisNote(`Read ${Object.keys(next).length} step(s) from the screenshot -- see suggestions below.`);
      }
    } catch (err: any) {
      setPortalAnalysisNote(err.message || 'Could not read that screenshot.');
    } finally {
      setAnalyzingPortal(false);
      e.target.value = '';
    }
  };

  const handleMenuAttest = async (stepKey: string) => {
    if (!orgId) return;
    const field = MENU_REVIEW_STEP_FIELD[stepKey];
    if (!field) return;
    setMenuSavingKey(stepKey);
    try {
      await api.updateOrganizationConfig(orgId, { [field]: 'approved' });
      await loadMenu();
    } catch (err: any) {
      setError(err.message || 'Could not save.');
    } finally {
      setMenuSavingKey(null);
    }
  };

  return (
    <div className="space-y-6">
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Rocket className="w-5 h-5 text-blue-500" />
          Google Ordering Redirect Onboarding
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {overall && (
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              overall.complete === overall.total ? 'bg-green-100 text-green-700' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
            }`}>
              {overall.complete} / {overall.total} complete
            </span>
          )}
          <label
            className="cursor-pointer px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-xs ring-2 ring-blue-400/60 hover:ring-blue-400 transition-all flex items-center gap-1.5"
            title="Upload Partner Portal's 7-step Onboarding Plan screen -- reads each row's green/red marker and suggests a status per step below"
          >
            {analyzingPortal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
            <span>{analyzingPortal ? 'Reading...' : 'Upload Portal Screenshot'}</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={analyzingPortal}
              onChange={handlePortalScreenshotUpload}
            />
          </label>
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
        Google exposes no API to confirm where you actually stand in this journey -- these statuses are
        computed from your own feed and conversion history, plus what you've self-reported below. Sandbox
        pushes daily on its own schedule; production joins the same schedule automatically once Sandbox-to-Production
        Review is approved below -- no manual push needed.
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        For the most accurate suggestions, upload your <strong>latest</strong> screenshot of Partner Portal's
        Onboarding Plan screen -- an old one can show stale progress.
      </p>
      {portalAnalysisNote && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 rounded-lg text-xs">
          {portalAnalysisNote}
        </div>
      )}

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
            const suggestion = portalSuggestions[step.key];
            // pending -> needs_attention isn't a real disagreement (pending
            // just means "not reached yet locally") -- only flag it when the
            // screenshot's read genuinely conflicts with a settled local status.
            const suggestionDiffers = suggestion && !(step.status === 'pending' && suggestion.status === 'needs_attention') && suggestion.status !== step.status;
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

                <div className="flex flex-col items-end gap-1.5 flex-shrink-0 max-w-[220px]">
                  {isReviewStep && step.status === 'needs_attention' && (
                    <button
                      onClick={() => handleAttest(step.key)}
                      disabled={savingKey === step.key}
                      className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg flex items-center gap-1.5"
                      title={REVIEW_STEP_TITLE[step.key] || DEFAULT_REVIEW_STEP_TITLE}
                    >
                      {savingKey === step.key ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      {REVIEW_STEP_BUTTON_LABEL[step.key]}
                    </button>
                  )}
                  {suggestionDiffers && (
                    <div
                      className={`text-[11px] px-2 py-1 rounded-md text-right leading-snug ${
                        suggestion.status === 'complete'
                          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                          : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                      }`}
                      title={suggestion.evidence}
                    >
                      Portal screenshot shows: <strong>{suggestion.status === 'complete' ? 'Complete' : 'Needs attention'}</strong>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>

    {menuEnabled && menuSteps && (
      <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setMenuCollapsed((v) => !v)}
          className="w-full flex items-center justify-between mb-1 cursor-pointer text-left"
        >
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5 text-blue-500" />
            Google Menu Feeds Onboarding
          </h2>
          <div className="flex items-center gap-2">
            {menuOverall && (
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                menuOverall.complete === menuOverall.total ? 'bg-green-100 text-green-700' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}>
                {menuOverall.complete} / {menuOverall.total} complete
              </span>
            )}
            {menuCollapsed ? (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            )}
          </div>
        </button>
        {!menuCollapsed && (
        <>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          A separate, optional track (google.food_menu) -- enabled on Setup. Same rules as the journey above:
          Google exposes no API for this either, so these statuses come from your own menu feed history plus
          what you've self-reported.
        </p>

        <div className="space-y-2">
          {menuSteps.map((step) => {
            const isReviewStep = step.key in MENU_REVIEW_STEP_FIELD;
            return (
              <div
                key={step.key}
                className="flex items-start justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm"
              >
                <Link
                  to={MENU_STEP_ROUTES[step.key as keyof typeof MENU_STEP_ROUTES] || '#'}
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
                    onClick={() => handleMenuAttest(step.key)}
                    disabled={menuSavingKey === step.key}
                    className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg flex items-center gap-1.5 flex-shrink-0"
                    title="Marks this as approved once Google confirms it in Partner Portal -- this button does not contact Google."
                  >
                    {menuSavingKey === step.key ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    {MENU_REVIEW_STEP_BUTTON_LABEL[step.key]}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        </>
        )}
      </div>
    )}
    </div>
  );
}
