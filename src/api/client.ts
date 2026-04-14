import axios, { AxiosError, AxiosInstance } from 'axios';

// Portal base URL. Overridable via a build-time env so a dev can point
// at a staging host without patching code. In release builds we pin to
// production and rely on Electron auto-updates to roll out changes.
export const API_BASE =
  import.meta.env.VITE_API_BASE ?? 'https://portal.decisivedatatech.com';

let _api: AxiosInstance | null = null;

function createApiInstance(): AxiosInstance {
  const instance = axios.create({
    baseURL: API_BASE,
    timeout: 15000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // 401 response interceptor — transparent JWT refresh + retry.
  //
  // Flow:
  //   1. Request returns 401 (expired access token).
  //   2. If we haven't already retried this exact request, and the
  //      URL isn't the refresh endpoint itself (which would loop),
  //      attempt a refresh using the persisted refresh token.
  //   3. On refresh success, update the auth store with the new access
  //      token and retry the original request with the new Bearer.
  //   4. On refresh failure (refresh token also expired or revoked),
  //      sign the user out so the login screen takes over cleanly.
  //
  // The auth store is imported lazily inside the handler to avoid a
  // module-cycle: client.ts ← auth store ← … ← client.ts.
  instance.interceptors.response.use(
    (res) => res,
    async (error: AxiosError) => {
      const config = error.config as
        | (typeof error.config & { _retry?: boolean })
        | undefined;
      const status = error.response?.status;

      if (!config || status !== 401) {
        return Promise.reject(error);
      }
      // Don't try to refresh the refresh endpoint itself.
      if (config.url && config.url.includes('/auth/refresh/')) {
        return Promise.reject(error);
      }
      // Don't retry twice for the same request.
      if (config._retry) {
        return Promise.reject(error);
      }
      config._retry = true;

      // Lazy imports to dodge circular dependency with the auth store
      // and the refresh helper.
      const [{ useAuth }, { refreshAccessToken }] = await Promise.all([
        import('../store/auth'),
        import('./auth'),
      ]);

      const auth = useAuth.getState();
      const refreshToken = auth.refresh;
      if (!refreshToken) {
        return Promise.reject(error);
      }

      try {
        const newAccess = await refreshAccessToken(refreshToken);
        await auth.updateAccess(newAccess);

        // Retry the original request with the new Bearer token.
        config.headers = config.headers ?? {};
        (config.headers as Record<string, string>).Authorization =
          `Bearer ${newAccess}`;
        return instance(config);
      } catch (refreshErr) {
        console.warn('[api] token refresh failed, signing out', refreshErr);
        await auth.signOut();
        return Promise.reject(error);
      }
    },
  );

  return instance;
}

/**
 * Get (and lazily create) the current axios instance.
 *
 * We use a getter-plus-module-level-cache instead of a plain `const`
 * because sign-out resets the instance via resetApiInstance() — that
 * drops any stale keepalive connections Chromium's HTTP pool was
 * holding from the previous session, which was causing the very next
 * /api/auth/ddconnect/ POST to die at the transport layer after a
 * sign-out → re-login cycle.
 */
export function getApi(): AxiosInstance {
  if (!_api) _api = createApiInstance();
  return _api;
}

/** Replace the current axios instance with a fresh one. */
export function resetApiInstance(): void {
  _api = createApiInstance();
}

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
