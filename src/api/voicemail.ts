import { getApi } from './client';

/**
 * Voicemail message as returned by GET /api/pbx/voicemail-inbox/.
 * Shape comes from voicemail_service.list_voicemails — the backend
 * scans the FreeSWITCH recordings tree so the dict is flat and
 * comfortably serializable with no DB model behind it.
 */
export interface VoicemailMessage {
  id: string;
  extension: string;
  domain: string;
  caller_id_name: string;
  caller_id_number: string;
  duration: number;
  duration_display: string;
  created: string;       // ISO 8601
  created_epoch: number;
  is_read: boolean;
  file_size: number;
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function listVoicemails(
  accessToken: string,
  extension: string,
  domain: string,
): Promise<VoicemailMessage[]> {
  const res = await getApi().get<VoicemailMessage[]>('/api/pbx/voicemail-inbox/', {
    headers: authHeaders(accessToken),
    params: { extension, domain },
  });
  return res.data;
}

/**
 * Fetch a voicemail WAV as a blob so it can be attached to an <audio>
 * element as an object URL. We can't point the <audio src> straight at
 * the REST endpoint because the browser element fires an unauthenticated
 * GET that would 401 without the Bearer token, and stream responses
 * don't play nicely with axios interceptors either — so blob + object
 * URL is the cleanest path.
 *
 * Side effect: this endpoint also auto-marks the message as read on the
 * server (voicemail_views.voicemail_audio calls mark_voicemail_read).
 */
export async function fetchVoicemailAudio(
  accessToken: string,
  msgId: string,
  extension: string,
  domain: string,
): Promise<Blob> {
  const res = await getApi().get<Blob>(
    `/api/pbx/voicemail-inbox/${encodeURIComponent(msgId)}/audio/`,
    {
      headers: authHeaders(accessToken),
      params: { extension, domain },
      responseType: 'blob',
    },
  );
  return res.data;
}

export async function markVoicemailRead(
  accessToken: string,
  msgId: string,
  extension: string,
  domain: string,
): Promise<void> {
  await getApi().post(
    `/api/pbx/voicemail-inbox/${encodeURIComponent(msgId)}/mark-read/`,
    { extension, domain },
    { headers: authHeaders(accessToken) },
  );
}

export async function markVoicemailUnread(
  accessToken: string,
  msgId: string,
  extension: string,
  domain: string,
): Promise<void> {
  await getApi().post(
    `/api/pbx/voicemail-inbox/${encodeURIComponent(msgId)}/mark-unread/`,
    { extension, domain },
    { headers: authHeaders(accessToken) },
  );
}

export async function deleteVoicemail(
  accessToken: string,
  msgId: string,
  extension: string,
  domain: string,
): Promise<void> {
  await getApi().delete(
    `/api/pbx/voicemail-inbox/${encodeURIComponent(msgId)}/`,
    {
      headers: authHeaders(accessToken),
      params: { extension, domain },
    },
  );
}
