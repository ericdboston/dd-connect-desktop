/**
 * SIP.js-based client for FreeSWITCH mod_sofia WSS (port 7443).
 *
 * Replaces the earlier VertoClient after a full day of debugging
 * uncovered an upstream bug in mod_verto 1.10.12 (and master):
 * mod_verto.c calls switch_core_session_outgoing_channel() with the
 * short endpoint name "rtc" while the endpoint is registered under
 * the full name "verto.rtc", so every outbound call fails with
 * CHAN_NOT_IMPLEMENTED. This is a fundamental bug in mod_verto and
 * doesn't have an upstream fix as of v1.10.12 / master.
 *
 * Switching the desktop to mod_sofia WSS-SIP matches what the mobile
 * app uses, which has been running reliably in production for months.
 * Same FreeSWITCH, same tenant-ddtg-lab context, same Skyetel gateway
 * — just a different signaling protocol on the client side.
 *
 * Public surface is intentionally identical to the old VertoClient
 * so src/store/sip.ts doesn't need restructuring. Events emitted:
 *
 *   registered      — Registerer transitioned to Registered
 *   unregistered    — Registerer transitioned to Unregistered/Terminated
 *   incomingCall    — delegate.onInvite fired with caller info
 *   callAnswered    — Session transitioned to Established
 *   callEnded       — Session transitioned to Terminated or user hung up
 */

import {
  UserAgent,
  UserAgentOptions,
  Registerer,
  RegistererState,
  Inviter,
  Invitation,
  Session,
  SessionState,
} from 'sip.js';

export interface SipClientConfig {
  /** wss://portal.decisivedatatech.com:7443 */
  wsUrl: string;
  extension: string;
  password: string;
  /** lab.ddtg.local */
  domain: string;
  displayName?: string;
  registerExpires?: number;
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

export class SipClient {
  private config: SipClientConfig;
  private ua: UserAgent | null = null;
  private registerer: Registerer | null = null;
  private currentSession: Session | null = null;
  private listeners = new Map<EventName, Set<Listener>>();
  private registered = false;
  private remoteAudio: HTMLAudioElement | null = null;

  constructor(config: SipClientConfig) {
    this.config = config;
  }

  // ---------- public surface (matches old VertoClient) ----------

  on(event: EventName, cb: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.off(event, cb);
  }

  off(event: EventName, cb: Listener): void {
    this.listeners.get(event)?.delete(cb);
  }

  isRegistered(): boolean {
    return this.registered;
  }

  async connect(): Promise<void> {
    if (this.ua) return; // idempotent

    const sipUri = `sip:${this.config.extension}@${this.config.domain}`;
    const stun = this.config.stunServer ?? 'stun:stun.l.google.com:19302';
    const expires = this.config.registerExpires ?? 3600;

    const uaOptions: UserAgentOptions = {
      uri: UserAgent.makeURI(sipUri)!,
      transportOptions: { server: this.config.wsUrl },
      authorizationUsername: this.config.extension,
      authorizationPassword: this.config.password,
      displayName: this.config.displayName || this.config.extension,
      userAgentString: 'DDConnect-Desktop/0.1',
      logLevel: 'warn',
      delegate: {
        onInvite: (invitation) => this.handleIncoming(invitation),
      },
      sessionDescriptionHandlerFactoryOptions: {
        peerConnectionConfiguration: {
          iceServers: [{ urls: stun }],
        },
      },
    };

    this.ua = new UserAgent(uaOptions);

    try {
      await this.ua.start();
    } catch (err) {
      console.error('[Sip] UA start failed', err);
      throw err;
    }

    this.registerer = new Registerer(this.ua, {
      expires,
      refreshFrequency: 90, // re-register at 90% of expiry
    });
    this.registerer.stateChange.addListener((state) => {
      console.log('[Sip] register state', state);
      if (state === RegistererState.Registered) {
        this.registered = true;
        this.emit('registered');
      } else if (
        state === RegistererState.Unregistered ||
        state === RegistererState.Terminated
      ) {
        if (this.registered) this.emit('unregistered');
        this.registered = false;
      }
    });

    try {
      await this.registerer.register();
    } catch (err) {
      console.error('[Sip] register failed', err);
      this.registered = false;
      this.emit('unregistered');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    // Tear down any in-flight call first so we don't leave a dangling
    // session that the UI thinks is still alive.
    try { await this.hangupCall(); } catch { /* noop */ }

    if (this.registerer) {
      try { await this.registerer.unregister(); } catch { /* noop */ }
      this.registerer = null;
    }
    if (this.ua) {
      try { await this.ua.stop(); } catch { /* noop */ }
      this.ua = null;
    }
    if (this.registered) {
      this.registered = false;
      this.emit('unregistered');
    }
    this.detachRemoteAudio();
  }

  async makeCall(destination: string): Promise<void> {
    if (!this.ua) throw new Error('Not connected');
    if (!this.registered) throw new Error('Not registered');
    if (this.currentSession) throw new Error('A call is already in progress');

    const target = destination.includes('@')
      ? UserAgent.makeURI(`sip:${destination}`)
      : UserAgent.makeURI(`sip:${destination}@${this.config.domain}`);
    if (!target) throw new Error('Invalid destination');

    console.log('[Sip] makeCall ->', target.toString());

    const inviter = new Inviter(this.ua, target, {
      sessionDescriptionHandlerOptions: {
        constraints: { audio: true, video: false },
      },
    });
    this.currentSession = inviter;
    this.setupSession(inviter);

    try {
      await inviter.invite();
    } catch (err) {
      console.warn('[Sip] invite failed, cleaning up', err);
      this.currentSession = null;
      this.detachRemoteAudio();
      throw err;
    }
  }

  async answerCall(): Promise<void> {
    const s = this.currentSession;
    if (!(s instanceof Invitation)) return;
    await s.accept({
      sessionDescriptionHandlerOptions: {
        constraints: { audio: true, video: false },
      },
    });
  }

  async hangupCall(): Promise<void> {
    const s = this.currentSession;
    if (!s) return;

    // Clear the local ref up front. When the state listener's
    // Terminated event fires later, it checks `currentSession === s`
    // and bails if not, so we don't double-emit callEnded.
    this.currentSession = null;

    try {
      if (s.state === SessionState.Initial || s.state === SessionState.Establishing) {
        if (s instanceof Inviter) {
          await s.cancel();
        } else if (s instanceof Invitation) {
          await (s as Invitation).reject();
        }
      } else if (s.state === SessionState.Established) {
        await s.bye();
      }
    } catch (err) {
      console.warn('[Sip] hangup error', err);
    }

    this.detachRemoteAudio();
    this.emit('callEnded');
  }

  async muteCall(muted: boolean): Promise<void> {
    const s = this.currentSession;
    if (!s) return;
    const sdh = s.sessionDescriptionHandler as unknown as {
      peerConnection?: RTCPeerConnection;
    } | null;
    const pc = sdh?.peerConnection;
    if (!pc) return;
    for (const sender of pc.getSenders()) {
      if (sender.track && sender.track.kind === 'audio') {
        sender.track.enabled = !muted;
      }
    }
  }

  // Hold is still a no-op in v0.1. SIP.js supports it via
  // session.sessionDescriptionHandlerOptions + re-invite, can be
  // added later.
  holdCall(_held: boolean): void { /* noop */ }

  // ---------- internals ----------

  private handleIncoming(invitation: Invitation): void {
    if (this.currentSession) {
      // Busy — reject the new invite with 486 Busy Here.
      invitation.reject({ statusCode: 486 }).catch(() => { /* noop */ });
      return;
    }
    console.log(
      '[Sip] incoming invite from',
      invitation.remoteIdentity.uri.user,
    );
    this.currentSession = invitation;
    this.setupSession(invitation);

    const caller = invitation.remoteIdentity;
    this.emit('incomingCall', {
      callerName: caller.displayName || '',
      callerNumber: caller.uri.user || '',
      callId: invitation.id,
    } as IncomingCallInfo);
  }

  private setupSession(session: Session): void {
    session.stateChange.addListener((state: SessionState) => {
      console.log('[Sip] session state', state);
      switch (state) {
        case SessionState.Established:
          this.attachRemoteAudio(session);
          this.emit('callAnswered');
          break;
        case SessionState.Terminating:
        case SessionState.Terminated:
          // If the user already hung up locally, currentSession was
          // nulled in hangupCall() — don't double-emit.
          if (this.currentSession === session) {
            this.currentSession = null;
            this.detachRemoteAudio();
            this.emit('callEnded');
          }
          break;
        default:
          break;
      }
    });
  }

  /**
   * Pipe the remote audio track out to a hidden <audio autoplay>
   * element so Chromium actually plays it. Without this, the call
   * connects but no sound comes out — SIP.js only hands us the
   * peer connection, it doesn't wire up playback for us.
   */
  private attachRemoteAudio(session: Session): void {
    const sdh = session.sessionDescriptionHandler as unknown as {
      peerConnection?: RTCPeerConnection;
    } | null;
    const pc = sdh?.peerConnection;
    if (!pc) {
      console.warn('[Sip] no peerConnection on session, cannot attach audio');
      return;
    }
    if (!this.remoteAudio) {
      this.remoteAudio = document.createElement('audio');
      this.remoteAudio.autoplay = true;
      this.remoteAudio.style.display = 'none';
      document.body.appendChild(this.remoteAudio);
    }
    const stream = new MediaStream();
    for (const receiver of pc.getReceivers()) {
      if (receiver.track && receiver.track.kind === 'audio') {
        stream.addTrack(receiver.track);
      }
    }
    this.remoteAudio.srcObject = stream;
  }

  private detachRemoteAudio(): void {
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
    }
  }

  private emit(event: EventName, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try { cb(...args); }
      catch (e) { console.warn('[Sip] listener error', event, e); }
    }
  }
}
