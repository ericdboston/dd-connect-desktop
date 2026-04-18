import { getApi } from './client';
import type { SmsConversation, SmsMessage, ParkSlotsResponse } from './types';

/** GET /api/pbx/ddconnect/sms/conversations/ */
export async function fetchSmsConversations(): Promise<SmsConversation[]> {
  const { data } = await getApi().get<SmsConversation[]>('/api/pbx/ddconnect/sms/conversations/');
  return data;
}

/** GET /api/pbx/ddconnect/sms/messages/?remote=NUMBER */
export async function fetchSmsMessages(remoteNumber: string): Promise<SmsMessage[]> {
  const { data } = await getApi().get<SmsMessage[]>('/api/pbx/ddconnect/sms/messages/', {
    params: { remote: remoteNumber },
  });
  return data;
}

/** POST /api/pbx/ddconnect/sms/send/ */
export async function sendSms(to: string, body: string): Promise<any> {
  const { data } = await getApi().post('/api/pbx/ddconnect/sms/send/', { to, body });
  return data;
}

/** GET /api/pbx/ddconnect/park-slots/ */
export async function fetchParkSlots(): Promise<ParkSlotsResponse> {
  const { data } = await getApi().get<ParkSlotsResponse>('/api/pbx/ddconnect/park-slots/');
  return data;
}
