import { create } from 'zustand';
import { SipClient, type IncomingCallInfo } from '../services/SipClient';
import type { SipConfig } from '../api/types';

export interface ActiveCall {
  id: string;
  number: string;
  name: string;
  direction: 'incoming' | 'outgoing';
  state: 'ringing' | 'connected' | 'ended';
  startedAt: number;
}

interface SipState {
  client: SipClient | null;
  isRegistered: boolean;
  currentCall: ActiveCall | null;
  muted: boolean;
  audioInput: string | null;
  audioOutput: string | null;

  init: (config: SipConfig) => void;
  destroy: () => void;
  makeCall: (number: string) => Promise<void>;
  answerCall: () => Promise<void>;
  hangupCall: () => void;
  toggleMute: () => Promise<void>;
  setAudioInput: (id: string) => Promise<void>;
  setAudioOutput: (id: string) => Promise<void>;
}

const STORE_KEY_INPUT = 'audio:input';
const STORE_KEY_OUTPUT = 'audio:output';

export const useSip = create<SipState>((set, get) => ({
  client: null,
  isRegistered: false,
  currentCall: null,
  muted: false,
  audioInput: null,
  audioOutput: null,

  init(config) {
    // Idempotent by design — React StrictMode double-mounts the
    // ShellLayout effect in dev, which would otherwise churn the
    // SipClient. The early-return here makes repeated calls safe.
    // destroy() is only ever called from an explicit sign-out path,
    // NOT from a React useEffect cleanup.
    if (get().client) return;

    const client = new SipClient({
      // ws_url is mod_sofia WSS on port 7443, the same path the mobile
      // app uses. verto_url (mod_verto on /verto) is still advertised
      // by the backend sip_config but intentionally not used here —
      // there's an upstream bug in mod_verto that blocked the desktop
      // Verto path in v0.1 debugging, see commit history on 2026-04-13.
      wsUrl: config.ws_url,
      extension: config.extension,
      password: config.password,
      domain: config.sip_domain,
      displayName: config.display_name,
      registerExpires: config.register_expires,
      stunServer: config.stun_server,
    });

    client.on('registered', () => set({ isRegistered: true }));
    client.on('unregistered', () => set({ isRegistered: false }));
    client.on('incomingCall', (...args) => {
      const info = args[0] as IncomingCallInfo;
      set({
        currentCall: {
          id: info.callId,
          number: info.callerNumber,
          name: info.callerName,
          direction: 'incoming',
          state: 'ringing',
          startedAt: Date.now(),
        },
      });
      // Pop the always-on-top Electron window via the IPC bridge.
      // If ddconnect isn't on window (e.g. running in a browser,
      // pure web fallback, etc.) this is a no-op.
      void window.ddconnect?.incomingCall?.show({
        callerName: info.callerName,
        callerNumber: info.callerNumber,
        callId: info.callId,
      });
    });
    client.on('callAnswered', () => {
      const cur = get().currentCall;
      if (cur) set({ currentCall: { ...cur, state: 'connected' } });
      // Close the popup now that the main window is handling the call.
      void window.ddconnect?.incomingCall?.dismiss();
    });
    client.on('callEnded', () => {
      set({ currentCall: null, muted: false });
      void window.ddconnect?.incomingCall?.dismiss();
    });

    // Subscribe to popup button actions forwarded from the main
    // process. Decline → 486 Busy (via hangupCall). Answer → accept.
    // Registered once per sip store init, which is guarded by the
    // early-return at the top of init(), so this runs exactly once
    // per authed session.
    window.ddconnect?.incomingCall?.onAction((action) => {
      if (action === 'answer') {
        void client.answerCall();
      } else if (action === 'decline') {
        void client.hangupCall();
      }
    });

    // connect() is async but we don't await here — the state transitions
    // will drive the UI via the event listeners above.
    client.connect().catch((e) => {
      console.error('[sip] connect failed', e);
      set({ isRegistered: false });
    });
    set({ client });

    // Hydrate persisted audio device preferences from electron-store
    // and push them into the client. Settings page also calls the
    // setter actions below when the user changes device selections.
    void (async () => {
      try {
        const input = await window.ddconnect?.store.get<string>(STORE_KEY_INPUT);
        const output = await window.ddconnect?.store.get<string>(STORE_KEY_OUTPUT);
        if (input) client.setInputDevice(input);
        if (output) client.setOutputDevice(output);
        set({ audioInput: input ?? null, audioOutput: output ?? null });
      } catch (e) {
        console.warn('[sip] load device prefs failed', e);
      }
    })();
  },

  destroy() {
    const c = get().client;
    if (c) { void c.disconnect(); }
    set({ client: null, isRegistered: false, currentCall: null, muted: false });
  },

  async makeCall(destination) {
    try {
      console.log('[sip] makeCall started, destination:', destination);

      // Probe getUserMedia up front so any OS-level mic permission
      // denial surfaces as a clear error before we even touch SIP.
      console.log('[sip] requesting microphone…');
      const testStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      console.log('[sip] microphone OK, tracks:', testStream.getTracks().length);
      testStream.getTracks().forEach((t) => t.stop()); // release test stream

      const call: ActiveCall = {
        id: crypto.randomUUID(),
        number: destination,
        name: destination,
        direction: 'outgoing',
        state: 'ringing',
        startedAt: Date.now(),
      };
      set({ currentCall: call, muted: false });

      console.log('[sip] calling SipClient.makeCall…');
      await get().client?.makeCall(destination);
      console.log('[sip] SipClient.makeCall returned OK');
    } catch (err: unknown) {
      console.error('[sip] makeCall FAILED:', err);
      console.error('[sip] error type:', typeof err);
      try {
        console.error(
          '[sip] error JSON:',
          JSON.stringify(err, Object.getOwnPropertyNames(err as object)),
        );
      } catch { /* circular reference safety */ }
      set({ currentCall: null });
    }
  },

  async answerCall() {
    const c = get().client;
    if (!c) return;
    await c.answerCall();
  },

  hangupCall() {
    const c = get().client;
    if (c) { void c.hangupCall(); }
    set({ currentCall: null, muted: false });
  },

  async toggleMute() {
    const c = get().client;
    if (!c) return;
    const next = !get().muted;
    await c.muteCall(next);
    set({ muted: next });
  },

  async setAudioInput(id) {
    const c = get().client;
    if (c) c.setInputDevice(id);
    set({ audioInput: id });
    try { await window.ddconnect?.store.set(STORE_KEY_INPUT, id); }
    catch (e) { console.warn('[sip] persist audioInput failed', e); }
  },

  async setAudioOutput(id) {
    const c = get().client;
    if (c) c.setOutputDevice(id);
    set({ audioOutput: id });
    try { await window.ddconnect?.store.set(STORE_KEY_OUTPUT, id); }
    catch (e) { console.warn('[sip] persist audioOutput failed', e); }
  },
}));
