import { create } from 'zustand';
import { getUnreadCount } from '../api/chat';

/**
 * Tiny global store for the chat unread-count badge shown on the
 * sidebar nav item. Polled from /api/chat/unread/ every POLL_MS while
 * the shell is mounted, and also refreshed on demand after the user
 * opens/leaves a conversation or sends a message. Kept separate from
 * the ChatPage component state so every route can read it without
 * needing a shared parent data fetch.
 */
interface ChatUnreadState {
  unread: number;
  loading: boolean;
  refresh: (accessToken: string) => Promise<void>;
  setUnread: (n: number) => void;
  reset: () => void;
}

export const useChatUnread = create<ChatUnreadState>((set) => ({
  unread: 0,
  loading: false,

  async refresh(accessToken: string) {
    if (!accessToken) return;
    set({ loading: true });
    try {
      const n = await getUnreadCount(accessToken);
      set({ unread: n, loading: false });
    } catch {
      // Silent — the badge just doesn't update if the poll fails;
      // there's no user-facing action we could prompt anyway.
      set({ loading: false });
    }
  },

  setUnread(n: number) {
    set({ unread: n });
  },

  reset() {
    set({ unread: 0, loading: false });
  },
}));
