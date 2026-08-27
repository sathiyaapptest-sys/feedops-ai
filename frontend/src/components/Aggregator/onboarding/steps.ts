// Single source of truth for the 7-step journey's order, routes, and labels
// -- shared between OnboardingJourney.tsx (the tracker) and StepNav.tsx (the
// per-step Back/Previous/Next controls) so the two can't drift apart.

export const STEP_ORDER = [
  'setup',
  'feeds_sandbox',
  'conversion_sandbox',
  'sandbox_to_prod_review',
  'feeds_production',
  'conversion_production',
  'launch_review',
] as const;

export type StepKey = (typeof STEP_ORDER)[number];

export const STEP_ROUTES: Record<StepKey, string> = {
  setup: '/aggregator/onboarding/setup',
  feeds_sandbox: '/aggregator/onboarding/feeds-sandbox',
  conversion_sandbox: '/aggregator/onboarding/conversion-sandbox',
  sandbox_to_prod_review: '/aggregator/onboarding/sandbox-review',
  feeds_production: '/aggregator/onboarding/feeds-production',
  conversion_production: '/aggregator/onboarding/conversion-production',
  launch_review: '/aggregator/onboarding/launch-review',
};

export const STEP_LABELS: Record<StepKey, string> = {
  setup: 'Setup',
  feeds_sandbox: 'Feeds ready in Sandbox',
  conversion_sandbox: 'Conversion Tracking in Sandbox',
  sandbox_to_prod_review: 'Sandbox to Production Review',
  feeds_production: 'Feeds ready in Production',
  conversion_production: 'Conversion Tracking in Production',
  launch_review: 'Launch Review',
};
