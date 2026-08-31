import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  STEP_ORDER, STEP_ROUTES, STEP_LABELS, StepKey,
  MENU_STEP_ORDER, MENU_STEP_ROUTES, MENU_STEP_LABELS, MenuStepKey,
} from './steps';

type StepNavProps =
  | { track?: 'redirect'; stepKey: StepKey; children: React.ReactNode }
  | { track: 'menu'; stepKey: MenuStepKey; children: React.ReactNode };

// Wraps a step page with a "Back to Dashboard" link and Previous/Next step
// buttons, so moving through a journey doesn't require returning to the
// tracker between every step. `track` selects which of the two independent
// journeys (Redirect's 7 steps, or Menu Feeds' 5) to walk -- omit it (or
// pass 'redirect') for the original 7 routes, which is why every existing
// call site needed zero changes when Menu Feeds was added.
export function StepNav(props: StepNavProps) {
  const { children } = props;
  const isMenu = props.track === 'menu';
  const order = isMenu ? MENU_STEP_ORDER : STEP_ORDER;
  const routes: Record<string, string> = isMenu ? MENU_STEP_ROUTES : STEP_ROUTES;
  const labels: Record<string, string> = isMenu ? MENU_STEP_LABELS : STEP_LABELS;

  const idx = (order as readonly string[]).indexOf(props.stepKey);
  const prevKey = idx > 0 ? order[idx - 1] : null;
  const nextKey = idx < order.length - 1 ? order[idx + 1] : null;

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 pb-3 bg-slate-50 dark:bg-slate-900 flex items-center justify-between flex-wrap gap-3">
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
              to={routes[prevKey]}
              className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <ChevronLeft className="w-4 h-4" />
              {labels[prevKey]}
            </Link>
          )}
          {nextKey && (
            <Link
              to={routes[nextKey]}
              className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              {labels[nextKey]}
              <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}
