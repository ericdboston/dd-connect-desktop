import { getApi } from './client';

/**
 * Partial CDR record from GET /api/pbx/calls/.
 * The backend CDRSerializer returns more fields than we display; we
 * pick the ones the Recents page actually uses.
 */
export interface CdrRecord {
  id: number;
  uuid: string;
  caller_id_number: string;
  caller_id_name: string;
  destination_number: string;
  direction: 'inbound' | 'outbound' | 'local' | string;
  start_time: string;       // ISO 8601
  answer_time: string | null;
  hangup_time: string | null;
  duration_seconds: number;
  billable_seconds: number;
  hangup_cause: string;
  trunk_used: string;
  recording_path: string;
  was_answered: boolean;
}

export async function listCdrs(accessToken: string): Promise<CdrRecord[]> {
  const res = await getApi().get<CdrRecord[]>('/api/pbx/calls/', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data;
}
