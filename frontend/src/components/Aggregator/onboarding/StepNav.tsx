import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { STEP_ORDER, STEP_ROUTES, STEP_LABELS, StepKey } from './steps';

interface StepNavProps {
  stepKey: StepKey;
  children: React.ReactNode;
}

// Wraps a step page with a "Back to Dashboard" link and Previous/Next step
// buttons, so moving through the 7-step journey doesn't require returning to
// the tracker between every step.
export function StepNav({ stepKey, children }: StepNavProps) {
  const idx = STEP_ORDER.indexOf(stepKey);
  const prevKey = idx > 0 ? STEP_ORDER[idx - 1] : null;
  const nextKey = idx < STEP_ORDER.length - 1 ? STEP_ORDER[idx + 1] : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Link
          to="/aggregator/dashboard"
          className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>

        <div className="flex items-center gap-2">
          {prevKey && (
            <Link
              to={STEP_ROUTES[prevKey]}
              className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <ChevronLeft className="w-4 h-4" />
              {STEP_LABELS[prevKey]}
            </Link>
          )}
          {nextKey && (
            <Link
              to={STEP_ROUTES[nextKey]}
              className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              {STEP_LABELS[nextKey]}
              <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}
