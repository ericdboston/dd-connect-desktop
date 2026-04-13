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
}

export interface LoginResponse {
  access: string;
  refresh: string;
  sip_config: SipConfig;
}
