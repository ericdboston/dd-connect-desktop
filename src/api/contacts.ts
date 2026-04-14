import { getApi } from './client';

/**
 * Extension record as returned by GET /api/pbx/extensions/.
 * The full ExtensionSerializer has many more fields; we pick only the
 * ones the Contacts page actually displays. Unknown fields are tolerated
 * by axios so the response shape doesn't need to be exhaustive here.
 */
export interface Extension {
  id: number;
  number: string;
  caller_id_name: string;
  caller_id_number: string;
  user_name: string;
  user_email: string;
  tenant: number;
  tenant_name: string;
  tenant_domain: string;
  enabled: boolean;
}

/**
 * Current registration status keyed by extension number. Shape returned
 * by GET /api/pbx/device-registrations/ — a dict of
 *   { "1001": [ {user, ip, port, ...}, ... ] }
 * An extension with at least one entry is considered "online".
 */
export type RegistrationMap = Record<string, unknown[]>;

export async function listExtensions(accessToken: string): Promise<Extension[]> {
  const res = await getApi().get<Extension[]>('/api/pbx/extensions/', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data;
}

export async function listRegistrations(
  accessToken: string,
): Promise<RegistrationMap> {
  const res = await getApi().get<RegistrationMap>(
    '/api/pbx/device-registrations/',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return res.data;
}
