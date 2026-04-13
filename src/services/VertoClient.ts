/**
 * Minimal TypeScript Verto client for FreeSWITCH mod_verto.
 *
 * Implements the Verto JSON-RPC 2.0 protocol over a native WebSocket,
 * plus the WebRTC peer connection management needed for an audio call.
 *
 * Scope (v0.1):
 *   - login / clientReady / unregister
 *   - outbound calls via verto.invite + verto.answer
 *   - inbound calls via server-initiated verto.invite
 *   - hangup via verto.bye (both sides)
 *   - mute via local audio track enable/disable
 *   - auto-reconnect with 3s backoff
 *
 * NOT yet implemented (intentionally):
 *   - hold / unhold via verto.modify
 *   - blind transfer via verto.modify
 *   - DTMF via verto.info
 *   - early media negotiation
 *   - SRTP/DTLS — Chromium handles this transparently for us
 *
 * The reference for the wire protocol is FreeSWITCH's html5/verto/js
 * source tree. We only implement the subset the desktop softphone
 * actually needs.
 */

export interface VertoConfig {
  url: string;
  extension: string;
  password: string;
  /**
   * SIP domain the user lives in inside the FreeSWITCH directory
   * (e.g. "lab.ddtg.local"). Sent to mod_verto as `${extension}@${domain}`
   * so the directory lookup hits the right tenant. mod_verto's
   * force-register-domain may rewrite this server-side, but we still
   * send the qualified form for clarity and so the client works against
   * any FS that doesn't override it.
   */
  domain: string;
  stunServer?: string;
}

export interface IncomingCallInfo {
  callerName: string;
  callerNumber: string;
  callId: string;
}

type EventName =
  | 'registered'
  | 'unregistered'
  | 'incomingCall'
  | 'callAnswered'
  | 'callEnded';

type Listener = (...args: unknown[]) => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 30_000;
const RECONNECT_DELAY_MS = 3_000;
const ICE_GATHERING_TIMEOUT_MS = 5_000;

function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class VertoClient {
  private config: VertoConfig;
  private sessionId = randomUuid();
  private nextRequestId = 1;

  private ws: WebSocket | null = null;
  private pending = new Map<number, PendingRequest>();
  private listeners = new Map<EventName, Set<Listener>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private registered = false;

  // Active call state. We only support one call at a time in v0.1.
  private currentCallId: string | null = null;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private pendingOfferSdp: string | null = null;

  constructor(config: VertoConfig) {
    this.config = config;
  }

  // ---------- public surface ----------

  on(event: EventName, cb: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.off(event, cb);
  }

  off(event: EventName, cb: Listener): void {
    this.listeners.get(event)?.delete(cb);
  }

  connect(): void {
    this.shouldReconnect = true;
    this.openSocket();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupCall();
    if (this.ws) {
      try { this.ws.close(); } catch { /* noop */ }
      this.ws = null;
    }
    if (this.registered) {
      this.registered = false;
      this.emit('unregistered');
    }
  }

  isRegistered(): boolean {
    return this.registered;
  }

  async makeCall(destination: string): Promise<void> {
    if (!this.registered) throw new Error('Not registered');
    if (this.currentCallId) throw new Error('A call is already in progress');

    const callId = randomUuid();
    this.currentCallId = callId;

    await this.openPeerConnection();
    if (!this.pc) throw new Error('Peer connection failed');

    const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
    await this.pc.setLocalDescription(offer);
    await this.waitForIceComplete();

    const localSdp = this.pc.localDescription?.sdp;
    if (!localSdp) throw new Error('No local SDP after offer');

    await this.sendRequest('verto.invite', {
      sdp: localSdp,
      dialogParams: {
        callID: callId,
        destination_number: destination,
        caller_id_name: this.config.extension,
        caller_id_number: this.config.extension,
        useVideo: false,
        useStereo: false,
        screenShare: false,
        useCamera: false,
      },
    });
  }

  async answerCall(): Promise<void> {
    if (!this.pendingOfferSdp || !this.currentCallId) return;

    await this.openPeerConnection();
    if (!this.pc) return;

    await this.pc.setRemoteDescription({ type: 'offer', sdp: this.pendingOfferSdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.waitForIceComplete();

    const localSdp = this.pc.localDescription?.sdp;
    if (!localSdp) return;

    this.sendNotification('verto.answer', {
      sdp: localSdp,
      dialogParams: { callID: this.currentCallId },
    });

    this.pendingOfferSdp = null;
    this.emit('callAnswered');
  }

  hangupCall(): void {
    if (this.currentCallId) {
      this.sendNotification('verto.bye', {
        cause: 'NORMAL_CLEARING',
        causeCode: 16,
        callID: this.currentCallId,
      });
    }
    const wasInCall = this.currentCallId !== null;
    this.cleanupCall();
    if (wasInCall) this.emit('callEnded');
  }

  async muteCall(muted: boolean): Promise<void> {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  // Hold is intentionally a no-op in v0.1. Verto supports it via
  // verto.modify with action=hold/unhold; we'll wire that in once the
  // basic call flow is proven.
  holdCall(_held: boolean): void { /* noop */ }

  // ---------- socket lifecycle ----------

  private openSocket(): void {
    console.log('[Verto] opening', this.config.url);
    try {
      this.ws = new WebSocket(this.config.url);
    } catch (e) {
      console.error('[Verto] WebSocket constructor threw', e);
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      console.log('[Verto] socket open, sending login');
      void this.sendLogin();
    };
    this.ws.onmessage = (e) => this.handleMessage(typeof e.data === 'string' ? e.data : '');
    this.ws.onerror = (e) => console.warn('[Verto] socket error', e);
    this.ws.onclose = (e) => {
      console.log('[Verto] socket closed', e.code, e.reason);
      // Reject any in-flight requests so callers don't hang forever.
      for (const [id, req] of this.pending) {
        clearTimeout(req.timer);
        req.reject(new Error('socket closed'));
        this.pending.delete(id);
      }
      if (this.registered) {
        this.registered = false;
        this.emit('unregistered');
      }
      this.ws = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, RECONNECT_DELAY_MS);
  }

  private async sendLogin(): Promise<void> {
    try {
      const loginValue = this.config.domain
        ? `${this.config.extension}@${this.config.domain}`
        : this.config.extension;
      await this.sendRequest('login', {
        login: loginValue,
        passwd: this.config.password,
        sessid: this.sessionId,
      });
      console.log('[Verto] login OK');
      // verto.clientReady arrives as a server-initiated method shortly
      // after login. Some FS builds skip clientReady entirely, so emit
      // 'registered' here too — duplicate emits are idempotent in the
      // store.
      this.registered = true;
      this.emit('registered');
    } catch (e) {
      console.error('[Verto] login failed', e);
      this.registered = false;
      this.emit('unregistered');
    }
  }

  // ---------- JSON-RPC plumbing ----------

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('socket not open'));
    }
    const id = this.nextRequestId++;
    const msg = { jsonrpc: '2.0', method, params, id };
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`verto request ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  private sendResponse(id: number | string, result: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }

  private handleMessage(raw: string): void {
    let msg: {
      id?: number | string;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: unknown;
    };
    try { msg = JSON.parse(raw); }
    catch { console.warn('[Verto] non-JSON frame', raw); return; }

    // Response to one of our requests
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const req = this.pending.get(msg.id as number);
      if (req) {
        clearTimeout(req.timer);
        this.pending.delete(msg.id as number);
        if (msg.error !== undefined) req.reject(msg.error);
        else req.resolve(msg.result);
      }
      return;
    }

    // Server-initiated method call
    if (msg.method) {
      void this.handleServerMethod(
        msg.method,
        msg.params ?? {},
        msg.id,
      );
    }
  }

  private async handleServerMethod(
    method: string,
    params: Record<string, unknown>,
    id?: number | string,
  ): Promise<void> {
    console.log('[Verto] <-', method, params);
    switch (method) {
      case 'verto.clientReady':
        this.registered = true;
        this.emit('registered');
        break;

      case 'verto.invite':
        this.handleIncomingInvite(params);
        break;

      case 'verto.answer':
        await this.handleSdpAnswer(params);
        break;

      case 'verto.bye':
        this.handleRemoteBye();
        break;

      case 'verto.ping':
        // Server keepalive — reply with a pong using the same id.
        // FS accepts either {method: 'verto.ping'} or {pong: timestamp}
        // as a successful ack; we send the explicit pong shape so logs
        // are obviously a heartbeat reply.
        if (id !== undefined) {
          this.sendResponse(id, { pong: Date.now() });
          return; // don't fall through to the trailing default ack
        }
        return;

      case 'verto.media':
      case 'verto.info':
      case 'verto.display':
      case 'verto.event':
        // Acknowledged silently
        break;

      case 'verto.punt':
        // Server-initiated kick
        this.disconnect();
        break;

      default:
        console.log('[Verto] unhandled method', method);
        break;
    }
    if (id !== undefined) this.sendResponse(id, { method });
  }

  // ---------- call handlers ----------

  private handleIncomingInvite(params: Record<string, unknown>): void {
    const callId = String(params.callID ?? '');
    const sdp = String(params.sdp ?? '');
    if (!callId || !sdp) {
      console.warn('[Verto] verto.invite missing callID/sdp', params);
      return;
    }
    this.currentCallId = callId;
    this.pendingOfferSdp = sdp;
    this.emit('incomingCall', {
      callerName: String(params.caller_id_name ?? ''),
      callerNumber: String(params.caller_id_number ?? ''),
      callId,
    } as IncomingCallInfo);
  }

  private async handleSdpAnswer(params: Record<string, unknown>): Promise<void> {
    if (!this.pc) return;
    const sdp = String(params.sdp ?? '');
    if (!sdp) return;
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp });
      this.emit('callAnswered');
    } catch (e) {
      console.error('[Verto] setRemoteDescription failed', e);
      this.hangupCall();
    }
  }

  private handleRemoteBye(): void {
    if (!this.currentCallId) return;
    this.cleanupCall();
    this.emit('callEnded');
  }

  // ---------- WebRTC ----------

  private async openPeerConnection(): Promise<void> {
    if (this.pc) return;
    const stun = this.config.stunServer ?? 'stun:stun.l.google.com:19302';
    this.pc = new RTCPeerConnection({ iceServers: [{ urls: stun }] });

    this.pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (!stream) return;
      if (!this.remoteAudio) {
        this.remoteAudio = document.createElement('audio');
        this.remoteAudio.autoplay = true;
        // Hidden but in DOM so Chromium plays it
        this.remoteAudio.style.display = 'none';
        document.body.appendChild(this.remoteAudio);
      }
      this.remoteAudio.srcObject = stream;
    };
    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc?.iceConnectionState;
      console.log('[Verto] ICE state', state);
      if (state === 'failed' || state === 'closed') {
        this.handleRemoteBye();
      }
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      console.error('[Verto] getUserMedia failed', e);
      throw e;
    }
    for (const track of this.localStream.getTracks()) {
      this.pc.addTrack(track, this.localStream);
    }
  }

  private waitForIceComplete(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.pc || this.pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const onChange = () => {
        if (this.pc?.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', onChange);
          resolve();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', onChange);
      // Fallback: don't wait forever, even partial trickle SDP works for
      // most LAN scenarios.
      setTimeout(() => {
        this.pc?.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }, ICE_GATHERING_TIMEOUT_MS);
    });
  }

  private cleanupCall(): void {
    if (this.pc) {
      try { this.pc.close(); } catch { /* noop */ }
      this.pc = null;
    }
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
    }
    this.currentCallId = null;
    this.pendingOfferSdp = null;
  }

  // ---------- event emit ----------

  private emit(event: EventName, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try { cb(...args); }
      catch (e) { console.warn('[Verto] listener error', event, e); }
    }
  }
}
