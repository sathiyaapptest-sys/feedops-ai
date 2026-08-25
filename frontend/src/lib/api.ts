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
  resolveTriage: async (id: string, action: string) => {
    const res = await fetch(`${API_BASE_URL}/api/triage/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    return res.json();
  },
  triggerPipeline: async () => {
    const res = await fetch(`${API_BASE_URL}/api/feeds/trigger-pipeline`, {
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
  /** Records a human's self-reported result of manually checking Partner
   * Portal -> Ingestion -> History for one batch. Auth-protected. */
  verifyBatch: async (
    batchId: string,
    status: 'confirmed_clean' | 'flagged_errors',
    notes?: string
  ): Promise<{ status: string; batch_id?: string; verification_status?: string; message?: string }> => {
    const token = await getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/batches/${encodeURIComponent(batchId)}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ status, notes }),
    });
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
  uploadSpreadsheet: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
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
