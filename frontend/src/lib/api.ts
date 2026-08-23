const API_BASE_URL = 'http://localhost:8000';

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
  }
};
