import { create } from 'zustand';
import type { SipConfig } from '../api/types';
import { resetApiInstance, setApiBase } from '../api/client';

// Persisted slice. The full PersistedAuth (including the SIP password
// inside sip_config) is written to <userData>/ddconnect-secure.bin via
// Electron's safeStorage API:
//   - Windows: DPAPI, scoped to the current Windows user profile
//   - macOS:   Keychain, scoped to the current macOS user
//   - Linux:   libsecret (gnome-keyring / kwallet)
// Encrypted bytes are NOT portable across machines or OS users —
// copying the file to another box yields decryption failure. If
// safeStorage reports the keychain unavailable at startup we refuse
// to persist; the session lives in memory for the lifetime of the
// app and the user is asked to re-enter credentials on next launch.
export interface PersistedAuth {
  access: string;
  refresh: string;
  extension: string;
  display_name: string;
  sip_config: SipConfig;
  // v0.1.4 — portal server the user logged into (may differ from the
  // default if the user changed the Server field on the login screen).
  serverUrl?: string;
}

interface AuthState extends Partial<PersistedAuth> {
  isAuthed: boolean;
  hydrating: boolean;
  /**
   * Last persistence error from secureStore, surfaced to the UI so the
   * login screen can warn when "Remember me" is checked but the OS
   * keychain refused. null when persistence is healthy or has not
   * been attempted.
   */
  persistError: string | null;
  setSession: (s: PersistedAuth, remember: boolean) => Promise<void>;
  hydrate: () => Promise<void>;
  signOut: () => Promise<void>;
  updateAccess: (newAccessToken: string) => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  isAuthed: false,
  hydrating: true,
  persistError: null,

  async hydrate() {
    try {
      const result = await window.ddconnect.secureStore.get<PersistedAuth>();
      if (!result.ok) {
        // Keychain unavailable or read/decrypt failed. Surface so the
        // login screen can prompt re-entry; do not silently lose state.
        set({ hydrating: false, persistError: result.error });
        return;
      }
      const saved = result.data;
      if (saved && saved.access && saved.refresh && saved.extension) {
        // v0.1.4 — restore the server URL the user logged into so API
        // calls go to the right host even if the default changed.
        if (saved.serverUrl) {
          setApiBase(saved.serverUrl);
        }
        set({
          ...saved,
          isAuthed: true,
          hydrating: false,
          persistError: null,
        });
        return;
      }
    } catch (e) {
      console.warn('[auth] hydrate failed', e);
      set({ persistError: e instanceof Error ? e.message : String(e) });
    }
    set({ hydrating: false });
  },

  async setSession(session, remember) {
    set({ ...session, isAuthed: true });
    if (remember) {
      const result = await window.ddconnect.secureStore.set(session);
      if (!result.ok) {
        // Refuse to fall back to plaintext. Keep the user signed in
        // for this process, surface the error, and make the next cold
        // start drop them at the login screen.
        console.warn('[auth] secure persist failed:', result.error);
        set({ persistError: result.error });
      } else {
        set({ persistError: null });
      }
    } else {
      // Explicitly clear any prior persisted session so toggling
      // Remember me off actually means "don't remember me".
      await window.ddconnect.secureStore.delete();
      set({ persistError: null });
    }
  },

  async signOut() {
    await window.ddconnect.secureStore.delete();
    set({
      isAuthed: false,
      access: undefined,
      refresh: undefined,
      extension: undefined,
      display_name: undefined,
      sip_config: undefined,
      persistError: null,
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
    // Refresh the persisted ciphertext too so the next cold start has
    // the freshest access token. If a saved session existed, write
    // back; if not, this was an in-memory-only session and there's
    // nothing on disk to update.
    try {
      const read = await window.ddconnect.secureStore.get<PersistedAuth>();
      if (read.ok && read.data) {
        await window.ddconnect.secureStore.set({
          ...read.data,
          access: newAccessToken,
        });
      }
    } catch (e) {
      console.warn('[auth] updateAccess persist failed', e);
    }
  },
}));
