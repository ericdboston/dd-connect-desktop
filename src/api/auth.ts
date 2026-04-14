import axios from 'axios';
import { API_BASE, getApi } from './client';
import type { LoginResponse } from './types';

export async function ddconnectLogin(
  extension: string,
  sipPassword: string,
  domain?: string,
): Promise<LoginResponse> {
  const body: Record<string, string> = {
    extension,
    sip_password: sipPassword,
  };
  if (domain) body.domain = domain;
  const res = await getApi().post<LoginResponse>('/api/auth/ddconnect/', body);
  return res.data;
}

export interface MeResponse {
  id: number;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  role: string;
  services: string[];
  date_joined?: string;
  last_login?: string | null;
}

export async function getMe(accessToken: string): Promise<MeResponse> {
  const res = await getApi().get<MeResponse>('/api/auth/me/', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data;
}

/**
 * Refresh the access token using the stored refresh token.
 *
 * Uses a direct axios.post (NOT getApi()) so this request bypasses
 * the 401 interceptor in client.ts — otherwise a failed refresh
 * would recurse into itself trying to refresh the refresh.
 *
 * Returns the new access token string. Throws on failure (which the
 * interceptor catches to trigger sign-out).
 */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await axios.post<{ access: string }>(
    `${API_BASE}/api/auth/refresh/`,
    { refresh: refreshToken },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    },
  );
  return res.data.access;
}
