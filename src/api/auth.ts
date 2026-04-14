import { api } from './client';
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
  const res = await api.post<LoginResponse>('/api/auth/ddconnect/', body);
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
  const res = await api.get<MeResponse>('/api/auth/me/', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data;
}
