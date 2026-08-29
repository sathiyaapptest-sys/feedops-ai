import { auth } from './firebase';

// Local dev: frontend (vite, :5173) and backend (:8000) run as separate
// servers, so calls need an absolute URL. Production: the Dockerfile builds
// this frontend and serves it from the SAME Cloud Run service as the API
// (see app.py's SPAStaticFiles mount), so a relative path is correct and
// necessary -- a hardcoded localhost URL here silently fails every API call
// in production (a real bug this app shipped with: "Failed to fetch" on
// every request, confirmed live before this fix).
const API_BASE_URL = import.meta.env.DEV ? 'http://localhost:8000' : '';

async function getIdToken(): Promise<string | null> {
  // auth.currentUser is synchronously null immediately after a page load or
  // hard navigation, until Firebase finishes restoring the persisted session
  // (usually well under a second, but real -- confirmed live: an auth-
  // protected call fired from a component's mount-time effect went out with
  // no Authorization header and came back 401 before this fix). authStateReady()
  // resolves once that initial restore completes either way (signed in or not).
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

/** Parses a `text/event-stream` response body into individual JSON events.
 * Browser EventSource can't POST, so /api/merchants/onboard is consumed via
 * fetch + a manual SSE line parser instead. */
async function* streamSSE(response: Response): AsyncGenerator<any> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(6));
      } catch {
        // malformed/partial chunk -- skip rather than crash the stream
      }
    }
  }
}

export const api = {
  getReadiness: async () => {
    const res = await fetch(`${API_BASE_URL}/api/feeds/readiness`);
    return res.json();
  },
  getTriageQueue: async () => {
    const res = await fetch(`${API_BASE_URL}/api/triage/queue`);
    return res.json();
  },
  /** Full merchant directory (every status), for the aggregator's Merchants page. */
  listMerchants: async (): Promise<{ merchants: any[]; error?: string }> => {
    const res = await fetch(`${API_BASE_URL}/api/merchants`);
    return res.json();
  },
  /** Soft-removes a merchant (sets status to excluded_closed) -- immediately
   * stops it from being fed, without a hard delete of its history. */
  removeMerchant: async (storeId: string): Promise<{ status: string; message?: string }> => {
    const res = await fetch(`${API_BASE_URL}/api/merchants/${encodeURIComponent(storeId)}/remove`, {
      method: 'POST',
    });
    return res.json();
  },
  /** Full read-only detail (profile + menu) for one merchant, for the
   * Merchants page's click-through detail modal. */
  getMerchantDetail: async (storeId: string): Promise<{ status: string; merchant?: any; menu?: any; message?: string }> => {
    const res = await fetch(`${API_BASE_URL}/api/merchants/${encodeURIComponent(storeId)}`);
    return res.json();
  },
  /** Reads one organization's record (config, portal status). Auth-protected. */
  getOrganization: async (orgId: string): Promise<{ status: string; org?: any; message?: string }> => {
    const token = await getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/organizations/${encodeURIComponent(orgId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.json();
  },
  /** Creates an organization record (used to lazily create the aggregator's own
   * org the first time they open API & Webhooks -- there's no separate org
   * creation wizard). Auth-protected. */
  createOrganization: async (payload: {
    org_id: string;
    org_type: 'merchant' | 'aggregator';
    name: string;
    contact_email: string;
    goal: string;
  }): Promise<{ status: string; org?: any; message?: string }> => {
    const token = await getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/organizations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    return res.json();
  },
  /** Saves an organization's Partner Portal config (SFTP usernames, conversion
   * partner ID, per-environment setup status). Auth-protected. */
  updateOrganizationConfig: async (
    orgId: string,
    config: {
      sftp_username_sandbox?: string;
      sftp_username_production?: string;
      conversion_partner_id?: string;
      portal_status_sandbox?: string;
      portal_status_production?: string;
      sandbox_to_prod_review_status?: string;
      launch_review_status?: string;
      menu_feeds_enabled?: boolean;
      generic_sftp_username_sandbox?: string;
      generic_sftp_username_production?: string;
      menu_sandbox_review_status?: string;
      menu_launch_review_status?: string;
    }
  ): Promise<{ status: string; config?: any; message?: string }> => {
    const token = await getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/organizations/${encodeURIComponent(orgId)}/config`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(config),
    });
    return res.json();
  },
  getBatchFeedContent: async (
    batchId: string
  ): Promise<{ status: string; feeds?: Record<string, any>; missing?: string[]; message?: string }> => {
    const res = await fetch(`${API_BASE_URL}/api/batches/${encodeURIComponent(batchId)}/feed-content`);
    return res.json();
  },
  getOnboardingJourney: async (): Promise<{
    status: string;
    steps?: Array<{
      key: string;
      label: string;
      status: 'complete' | 'needs_attention' | 'pending';
      detail: string;
      progress: { current: number; target: number } | null;
    }>;
    overall_progress?: { complete: number; total: number };
    message?: string;
  }> => {
    const token = await getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/onboarding/journey`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.json();
  },
  /** The separate, opt-in 5-step Menu Feeds journey -- always returned (with
   * `enabled: false` if not opted in) rather than a second fetch to check first. */
  getMenuOnboardingJourney: async (): Promise<{
    status: string;
    enabled?: boolean;
    steps?: Array<{
      key: string;
      label: string;
      status: 'complete' | 'needs_attention' | 'pending';
      detail: string;
      progress: { current: number; target: number } | null;
    }>;
    overall_progress?: { complete: number; total: number };
    message?: string;
  }> => {
    const token = await getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/onboarding/menu-journey`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.json();
  },
  triggerMenuFeedPipeline: async (environment: 'sandbox' | 'production' = 'sandbox') => {
    const res = await fetch(`${API_BASE_URL}/api/menu-feeds/trigger-pipeline?environment=${environment}`, {
      method: 'POST',
    });
    return res.json();
  },
  getMenuFeedBatches: async (environment?: 'sandbox' | 'production'): Promise<{ batches: any[]; error?: string }> => {
    const qs = environment ? `?environment=${environment}` : '';
    const res = await fetch(`${API_BASE_URL}/api/menu-feeds/batches${qs}`);
    return res.json();
  },
  /** address is optional -- pass it on an approve to overwrite a wrong
   * automatic match with the address the reviewer confirmed themselves
   * (via a free Google Maps text search, no Places API involved). */
  resolveTriage: async (id: string, action: string, address?: string) => {
    const res = await fetch(`${API_BASE_URL}/api/triage/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, address }),
    });
    return res.json();
  },
  triggerPipeline: async (environment: 'sandbox' | 'production' = 'sandbox') => {
    const res = await fetch(`${API_BASE_URL}/api/feeds/trigger-pipeline?environment=${environment}`, {
      method: 'POST',
    });
    return res.json();
  },
  /** Upload batch history -- one record per daily feed push, the closest thing
   * to Google's own Portal "Ingestion -> History" view we can show without an
   * API for it (there isn't one). */
  getBatches: async (): Promise<{ batches: any[] }> => {
    const res = await fetch(`${API_BASE_URL}/api/batches`);
    return res.json();
  },
  /** Records a human's self-reported acceptance status for ONE feed type
   * (entity/action/service) within a batch -- Partner Portal shows per-file
   * ingestion history, not one blended result for the whole batch. */
  verifyBatchFeed: async (
    batchId: string,
    feedType: 'entity' | 'action' | 'service' | 'menu',
    status: 'confirmed_clean' | 'flagged_errors'
  ): Promise<{ status: string; batch_id?: string; feed_type?: string; feed_status?: string; message?: string }> => {
    const token = await getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/batches/${encodeURIComponent(batchId)}/verify-feed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ feed_type: feedType, status }),
    });
    return res.json();
  },
  /** Runs the real synthetic conversion sweep (playbook section 7) on demand,
   * using the Conversion Partner ID saved in the caller's own org config
   * (API & Webhooks) if set. Auth-protected. */
  triggerConversionCheck: async (environment: string = 'sandbox') => {
    const token = await getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/conversion/check?environment=${encodeURIComponent(environment)}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.json();
  },
  /** Conversion-check history plus whether the playbook's "3 events / 7 days"
   * launch-eligibility rule is currently satisfied. */
  getConversionChecks: async (): Promise<{
    checks: any[];
    compliant: boolean;
    events_in_window: number;
    window_days?: number;
    min_events_required?: number;
    error?: string;
  }> => {
    const res = await fetch(`${API_BASE_URL}/api/conversion/checks`);
    return res.json();
  },
  /** Same shape as getConversionChecks, scoped to one environment -- for the
   * Sandbox/Production step pages, which need separate numbers, not the
   * globally-aggregated ones getConversionChecks returns. */
  getConversionChecksByEnvironment: async (
    environment: 'sandbox' | 'production'
  ): Promise<{
    checks: any[];
    compliant: boolean;
    events_in_window: number;
    window_days?: number;
    min_events_required?: number;
    error?: string;
  }> => {
    const res = await fetch(`${API_BASE_URL}/api/conversion/checks/by-environment?environment=${environment}`);
    return res.json();
  },
  uploadMenuImage: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE_URL}/api/upload/menu-image`, {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },
  uploadSpreadsheet: async (file: File, replaceExisting: boolean = false) => {
    const formData = new FormData();
    formData.append('file', file);
    if (replaceExisting) formData.append('replace_existing', 'true');
    const res = await fetch(`${API_BASE_URL}/api/upload/spreadsheet`, {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },
  /** Bulk menu upload -- a standalone spreadsheet of dish rows identified by a
   * merchant-name column, separate from the restaurant/merchant upload above.
   * Items are matched to the merchant record that upload creates/updates by
   * computing the identical store_id server-side, so the two files can be
   * uploaded in either order. */
  uploadMenuSpreadsheet: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE_URL}/api/upload/menu-spreadsheet`, {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },
  searchPlaces: async (query: string) => {
    const res = await fetch(`${API_BASE_URL}/api/places/search?query=${encodeURIComponent(query)}`);
    return res.json();
  },
  /** Reads a Partner Portal screenshot: always returns a plain-language
   * summary + next steps, and only for the Ingestion History screen type
   * also returns advisory per-feed accept/reject suggestions -- never a
   * silent status write. */
  analyzeFeedScreenshot: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE_URL}/api/upload/feed-screenshot`, {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },
  /** Suggests Google Maps URLs for entities Google's portal couldn't
   * auto-match, from a Partner Portal CSV export -- suggestions only, no
   * write-back to Google. */
  assistEntityMatch: async (file: File, orgId?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (orgId) formData.append('org_id', orgId);
    const res = await fetch(`${API_BASE_URL}/api/entity-match/assist`, {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },
  /** Streams the EntityMatcher stage only (Places resolution + agent review).
   * store_id is assigned server-side from the authenticated user's email, so
   * the client never needs to invent one. Requires a signed-in Firebase user --
   * /api/merchants/onboard is auth-protected; without a real session this will
   * fail with a 401, surfaced via onEvent's error rather than silently. */
  onboardMerchant: async (
    merchant: { name: string; address: string; telephone?: string; email?: string },
    onEvent: (event: any) => void
  ) => {
    const token = await getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/merchants/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(merchant),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Onboarding request failed (${res.status}): ${text || res.statusText}`);
    }
    for await (const event of streamSSE(res)) {
      onEvent(event);
    }
  },
  /** Streams the SchemaAuditor + ConversionSentry stage against the merchant's
   * full saved record, including the real compiled entity/action/service feed
   * JSON in the schema_compilation event's payload.feed_contents. */
  auditMerchant: async (onEvent: (event: any) => void) => {
    const token = await getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/merchants/audit`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Audit request failed (${res.status}): ${text || res.statusText}`);
    }
    for await (const event of streamSSE(res)) {
      onEvent(event);
    }
  },
  /** Returns the last persisted feed audit (compiled feed content + conversion
   * health) without re-running the agents, so revisiting the Services page
   * shows the last real result instead of a blank slate. */
  getMerchantAudit: async (): Promise<{
    status: string;
    compiled_feeds?: Record<string, any> | null;
    feed_audit_reasoning?: string | null;
    conversion_health?: Record<string, any> | null;
    feeds_compiled_at?: any;
    message?: string;
  }> => {
    const token = await getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/merchants/audit`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.json();
  },
  /** "Ask FeedOps" -- a question grounded in the real Actions Center playbook via RAG. */
  askSupport: async (question: string): Promise<{ answer: string; sources: { title: string; content: string }[] }> => {
    const res = await fetch(`${API_BASE_URL}/api/support/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    return res.json();
  },
  /** Reads the merchant's own record from the `merchants` collection -- the
   * system of record the daily feed push compiles from, distinct from the
   * `stores` collection MyStore.tsx also writes for its own display. */
  getMerchantProfile: async (): Promise<{ status: string; profile?: any; message?: string }> => {
    const token = await getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/merchants/profile`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.json();
  },
  /** Saves the merchant's profile (name/address/phone/hours/lead time/service
   * types) into `merchants`, so it actually reaches the entity/action/service
   * feeds instead of sitting only in `stores`. Auth-protected. */
  saveMerchantProfile: async (profile: {
    storeName: string;
    address: string;
    phone?: string;
    email?: string;
    actionUrl?: string;
    placeId?: string;
    serviceOptions?: { delivery: boolean; takeaway: boolean; inStore: boolean };
    timings?: Array<{ day: string; isOpen: boolean; openTime: string; closeTime: string }>;
    leadTimeMinutes?: number | null;
  }): Promise<{ status: string; store_id?: string; message?: string }> => {
    const token = await getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/merchants/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(profile),
    });
    return res.json();
  },
};
