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

// Menu Feeds -- a separate, opt-in 5-step track layered on top of the 7-step
// journey above (never merged with it; see compute_menu_journey on the
// backend). Its own order/route/label tables so StepNav's Previous/Next
// chain for Menu never touches the Redirect chain.
export const MENU_STEP_ORDER = [
  'menu_setup',
  'menu_sandbox_development',
  'menu_sandbox_review',
  'menu_production_development',
  'menu_launch_review',
] as const;

export type MenuStepKey = (typeof MENU_STEP_ORDER)[number];

export const MENU_STEP_ROUTES: Record<MenuStepKey, string> = {
  menu_setup: '/aggregator/onboarding/setup', // Setup is genuinely shared -- one Partner Portal account
  menu_sandbox_development: '/aggregator/onboarding/menu-sandbox-development',
  menu_sandbox_review: '/aggregator/onboarding/menu-sandbox-review',
  menu_production_development: '/aggregator/onboarding/menu-production-development',
  menu_launch_review: '/aggregator/onboarding/menu-launch-review',
};

export const MENU_STEP_LABELS: Record<MenuStepKey, string> = {
  menu_setup: 'Setup',
  menu_sandbox_development: 'Sandbox Development',
  menu_sandbox_review: 'Sandbox Review',
  menu_production_development: 'Production Development',
  menu_launch_review: 'Launch Review',
};
