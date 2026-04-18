export interface SipConfig {
  extension: string;
  password: string;
  display_name: string;
  sip_server: string;
  sip_port: number;
  sip_domain: string;
  transport: string;
  ws_url: string;
  verto_url: string;
  codecs: string[];
  voicemail_number: string;
  register_expires: number;
  media_encryption: string;
  stun_server: string;
  sms_enabled?: boolean;
  sms_number?: string;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  sip_config: SipConfig;
}

export interface ParkSlot {
  slot: number;
  occupied: boolean;
  caller_id_name: string;
  caller_id_number: string;
  uuid: string;
}

export interface ParkSlotsResponse {
  slot_start: number;
  slot_end: number;
  slots: ParkSlot[];
  total: number;
  occupied: number;
}

export interface SmsConversation {
  remote_number: string;
  last_message: string;
  last_timestamp: string;
  direction: 'inbound' | 'outbound';
  is_read: boolean;
  unread_count: number;
}

export interface SmsMessage {
  id: number;
  from_number: string;
  to_number: string;
  body: string;
  direction: 'inbound' | 'outbound';
  status: string;
  is_read: boolean;
  created_at: string;
}
