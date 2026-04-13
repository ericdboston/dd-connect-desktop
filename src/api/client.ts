import axios, { AxiosError } from 'axios';

// Portal base URL. Overridable via a build-time env so a dev can point
// at a staging host without patching code. In release builds we pin to
// production and rely on Electron auto-updates to roll out changes.
export const API_BASE =
  import.meta.env.VITE_API_BASE ?? 'https://portal.decisivedatatech.com';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Normalize axios errors into a single { message } shape the UI can
// render without having to re-derive "is this a timeout vs 4xx vs 5xx"
// at every call site.
export function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<{ error?: string; detail?: string }>;
    if (ax.code === 'ECONNABORTED') return 'Request timed out.';
    if (ax.code === 'ERR_NETWORK') return 'Cannot reach server. Check your connection.';
    const body = ax.response?.data;
    if (body?.error) return body.error;
    if (body?.detail) return body.detail;
    if (ax.response?.status === 401) return 'Invalid credentials.';
    if (ax.response?.status === 403) return 'Access denied.';
    if (ax.response?.status && ax.response.status >= 500) {
      return `Server error (${ax.response.status}).`;
    }
    return ax.message || 'Unknown error.';
  }
  return err instanceof Error ? err.message : 'Unknown error.';
}
