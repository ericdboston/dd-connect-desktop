import { getApi, API_BASE } from './client';

// ── Types ─────────────────────────────────────────────────────

export interface ParticipantName {
  id: number;
  name: string;
}

export interface LastMessagePreview {
  body: string;
  sender_name: string;
  message_type: string;
  created_at: string;
}

/** Shape returned by GET /api/chat/conversations/?view=flat. */
export interface Conversation {
  id: number;
  title: string;
  display_title: string;
  conversation_type: string;
  is_active: boolean;
  channel_name: string;
  channel_topic: string;
  is_channel: boolean;
  last_message: LastMessagePreview | null;
  unread_count: number;
  participant_names: ParticipantName[];
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: number;
  conversation: number;
  sender: number | null;
  sender_name: string;
  message_type: string;
  body: string;
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string;
  is_deleted: boolean;
  edited_at: string | null;
  created_at: string;
}

export interface MessagesPage {
  messages: ChatMessage[];
  has_more: boolean;
}

export interface GetOrCreateResponse {
  conversation_id: number;
  created: boolean;
  participants: Array<{
    user_id: number;
    extension: string;
    display_name: string;
  }>;
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

// ── API calls ─────────────────────────────────────────────────

export async function listConversations(accessToken: string): Promise<Conversation[]> {
  const res = await getApi().get<Conversation[]>('/api/chat/conversations/', {
    headers: authHeaders(accessToken),
    params: { view: 'flat' },
  });
  return res.data;
}

export async function getMessages(
  accessToken: string,
  conversationId: number,
): Promise<MessagesPage> {
  const res = await getApi().get<MessagesPage>(
    `/api/chat/conversations/${conversationId}/messages/`,
    { headers: authHeaders(accessToken) },
  );
  return res.data;
}

/**
 * Send a chat message via the REST endpoint. We prefer the WebSocket
 * path when the socket is open (immediate broadcast + echo), but this
 * REST fallback is used when WS is disconnected or while reconnecting
 * so the message still persists and propagates once the socket comes
 * back and reloads history.
 */
export async function postMessage(
  accessToken: string,
  conversationId: number,
  body: string,
): Promise<ChatMessage> {
  const res = await getApi().post<ChatMessage>(
    `/api/chat/conversations/${conversationId}/messages/`,
    { body, message_type: 'text' },
    { headers: authHeaders(accessToken) },
  );
  return res.data;
}

export async function getUnreadCount(accessToken: string): Promise<number> {
  const res = await getApi().get<{ unread: number }>('/api/chat/unread/', {
    headers: authHeaders(accessToken),
  });
  return res.data.unread ?? 0;
}

export async function getOrCreateConversationByExtension(
  accessToken: string,
  peerExtension: string,
): Promise<GetOrCreateResponse> {
  const res = await getApi().post<GetOrCreateResponse>(
    '/api/chat/ddconnect/conversation/',
    { peer_extension: peerExtension },
    { headers: authHeaders(accessToken) },
  );
  return res.data;
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Build the WebSocket URL for a conversation. The ChatConsumer reads
 * the JWT from the ?token query param via an auth middleware in the
 * Django Channels routing layer, so we pass the access token here and
 * let the middleware authenticate the scope before connect() runs.
 */
export function chatWebSocketUrl(
  conversationId: number,
  accessToken: string,
): string {
  const base = API_BASE.replace(/^http/, 'ws');
  return `${base}/ws/chat/${conversationId}/?token=${encodeURIComponent(accessToken)}`;
}

/**
 * Decode the `user_id` claim from a portal JWT without validating the
 * signature. We only use it for self-vs-other styling on chat bubbles;
 * trust boundaries live on the server. Safe against malformed tokens —
 * returns null on any parse failure.
 */
export function userIdFromAccess(accessToken: string | undefined): number | null {
  if (!accessToken) return null;
  try {
    const [, payload] = accessToken.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json = JSON.parse(atob(padded));
    return typeof json.user_id === 'number' ? json.user_id : null;
  } catch {
    return null;
  }
}
