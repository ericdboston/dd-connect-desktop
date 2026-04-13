import { create } from 'zustand';
import { VertoClient, type IncomingCallInfo } from '../services/VertoClient';
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
  client: VertoClient | null;
  isRegistered: boolean;
  currentCall: ActiveCall | null;
  muted: boolean;

  init: (config: SipConfig) => void;
  destroy: () => void;
  makeCall: (number: string) => Promise<void>;
  answerCall: () => Promise<void>;
  hangupCall: () => void;
  toggleMute: () => Promise<void>;
}

export const useSip = create<SipState>((set, get) => ({
  client: null,
  isRegistered: false,
  currentCall: null,
  muted: false,

  init(config) {
    if (get().client) return; // already initialized

    const client = new VertoClient({
      url: config.verto_url,
      extension: config.extension,
      password: config.password,
      domain: config.sip_domain,
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
    });
    client.on('callAnswered', () => {
      const cur = get().currentCall;
      if (cur) set({ currentCall: { ...cur, state: 'connected' } });
    });
    client.on('callEnded', () => {
      set({ currentCall: null, muted: false });
    });

    client.connect();
    set({ client });
  },

  destroy() {
    const c = get().client;
    if (c) c.disconnect();
    set({ client: null, isRegistered: false, currentCall: null, muted: false });
  },

  async makeCall(destination) {
    try {
      console.log('[sip] makeCall started, destination:', destination);

      // Test getUserMedia directly before handing off to VertoClient.
      // If this throws on Windows Electron with a permission error, we
      // know the issue is the OS mic gate — not the Verto protocol or
      // the SDP exchange.
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

      console.log('[sip] calling VertoClient.makeCall…');
      await get().client?.makeCall(destination);
      console.log('[sip] VertoClient.makeCall returned OK');
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
    if (c) c.hangupCall();
    set({ currentCall: null, muted: false });
  },

  async toggleMute() {
    const c = get().client;
    if (!c) return;
    const next = !get().muted;
    await c.muteCall(next);
    set({ muted: next });
  },
}));
