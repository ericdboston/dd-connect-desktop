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
