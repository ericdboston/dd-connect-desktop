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

  async makeCall(number) {
    const c = get().client;
    if (!c) throw new Error('SIP client not initialized');
    set({
      currentCall: {
        id: '',
        number,
        name: number,
        direction: 'outgoing',
        state: 'ringing',
        startedAt: Date.now(),
      },
      muted: false,
    });
    try {
      await c.makeCall(number);
    } catch (e) {
      console.error('[sip] makeCall failed', e);
      set({ currentCall: null });
      throw e;
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
