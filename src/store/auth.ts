import { create } from 'zustand';
import type { SipConfig } from '../api/types';
import { resetApiInstance } from '../api/client';

// Persisted slice — mirrored into electron-store for reboot survival
// when "Remember me" is on. We deliberately omit the raw SIP password
// and put the minimum needed to resume a session.
export interface PersistedAuth {
  access: string;
  refresh: string;
  extension: string;
  display_name: string;
  sip_config: SipConfig;
}

interface AuthState extends Partial<PersistedAuth> {
  isAuthed: boolean;
  hydrating: boolean;
  setSession: (s: PersistedAuth, remember: boolean) => Promise<void>;
  hydrate: () => Promise<void>;
  signOut: () => Promise<void>;
  updateAccess: (newAccessToken: string) => Promise<void>;
}

const STORE_KEY = 'session';

export const useAuth = create<AuthState>((set) => ({
  isAuthed: false,
  hydrating: true,

  async hydrate() {
    try {
      const saved = await window.ddconnect.store.get<PersistedAuth>(STORE_KEY);
      if (saved && saved.access && saved.refresh && saved.extension) {
        set({
          ...saved,
          isAuthed: true,
          hydrating: false,
        });
        return;
      }
    } catch (e) {
      console.warn('[auth] hydrate failed', e);
    }
    set({ hydrating: false });
  },

  async setSession(session, remember) {
    set({ ...session, isAuthed: true });
    if (remember) {
      try {
        await window.ddconnect.store.set(STORE_KEY, session);
      } catch (e) {
        console.warn('[auth] persist failed', e);
      }
    } else {
      // Explicitly clear any prior persisted session so toggling
      // Remember me off actually means "don't remember me".
      try { await window.ddconnect.store.delete(STORE_KEY); } catch { /* noop */ }
    }
  },

  async signOut() {
    try { await window.ddconnect.store.delete(STORE_KEY); } catch { /* noop */ }
    set({
      isAuthed: false,
      access: undefined,
      refresh: undefined,
      extension: undefined,
      display_name: undefined,
      sip_config: undefined,
    });
    // Drop the cached axios instance so Chromium's HTTP keepalive
    // pool doesn't carry stale sockets into the next login session.
    // This was causing the very next /api/auth/ddconnect/ POST to
    // die at the transport layer after a sign-out → re-login cycle
    // (the preflight would succeed but the POST never fired).
    resetApiInstance();
  },

  async updateAccess(newAccessToken) {
    // Update the in-memory store first so any pending API call that
    // reads auth.access via .getState() sees the new token immediately.
    set({ access: newAccessToken });
    // Persist to electron-store if a remembered session exists, so the
    // next cold start has the freshest token available.
    try {
      const saved = await window.ddconnect?.store.get<PersistedAuth>(STORE_KEY);
      if (saved) {
        await window.ddconnect?.store.set(STORE_KEY, {
          ...saved,
          access: newAccessToken,
        });
      }
    } catch (e) {
      console.warn('[auth] updateAccess persist failed', e);
    }
  },
}));
