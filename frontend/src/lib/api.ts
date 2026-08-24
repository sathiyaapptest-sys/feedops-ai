import { auth } from './firebase';

const API_BASE_URL = 'http://localhost:8000';

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
  searchPlaces: async (query: string) => {
    const res = await fetch(`${API_BASE_URL}/api/places/search?query=${encodeURIComponent(query)}`);
    return res.json();
  },
  /** Streams the real onboarding pipeline (EntityMatcher -> SchemaAuditor ->
   * ConversionSentry). Requires a signed-in Firebase user -- /api/merchants/onboard
   * is auth-protected; without a real session this will fail with a 401,
   * surfaced via onEvent's error rather than silently. */
  onboardMerchant: async (
    merchant: { store_id: string; name: string; address: string; telephone?: string; latitude?: number; longitude?: number },
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
  /** "Ask FeedOps" -- a question grounded in the real Actions Center playbook via RAG. */
  askSupport: async (question: string): Promise<{ answer: string; sources: { title: string; content: string }[] }> => {
    const res = await fetch(`${API_BASE_URL}/api/support/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    return res.json();
  },
};
