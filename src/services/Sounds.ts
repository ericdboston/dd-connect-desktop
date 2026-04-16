/**
 * Sounds.ts — Web Audio synthesis for all softphone tones.
 *
 * Added in v0.1.1 after the first installer test showed DD Connect
 * Desktop had no audio feedback whatsoever: no ringtone on inbound,
 * no ringback on outbound, no DTMF clicks on the dialpad. Every
 * serious softphone has these, they're trivially cheap, and users
 * interpret a silent dialpad as the call not working.
 *
 * Synthesis rather than audio files: no licensing, no bundle size,
 * reproducible on any device, and the frequencies are exactly the
 * standard North American precise tone plan (ITU-T Q.23) which is
 * what every PSTN phone in the country is tuned to emit.
 *
 *   Ringback (outbound):   440 + 480 Hz combined, 2s on / 4s off
 *   Incoming ringtone:     same fundamentals, 1.5s on / 1.5s off
 *                          (more aggressive cadence than ringback
 *                          so the user hears "this is a call coming
 *                          in" vs "we're waiting for them")
 *   DTMF:                  standard two-tone per key, 150ms per press
 *                          Row:  697/770/852/941 Hz (rows 1-4)
 *                          Col:  1209/1336/1477/1633 Hz (cols 1-4)
 *
 * Chromium auto-suspends AudioContext until a user gesture has
 * happened. getContext() resumes it on demand. The first tone the
 * user triggers (a dialpad press, an outbound call, or an incoming
 * call) is always after a gesture so this is fine in practice.
 */

// Standard North American DTMF frequencies — ITU-T Recommendation Q.23
const DTMF_LOW: Record<string, number> = {
  '1': 697, '2': 697, '3': 697, 'A': 697,
  '4': 770, '5': 770, '6': 770, 'B': 770,
  '7': 852, '8': 852, '9': 852, 'C': 852,
  '*': 941, '0': 941, '#': 941, 'D': 941,
};
const DTMF_HIGH: Record<string, number> = {
  '1': 1209, '4': 1209, '7': 1209, '*': 1209,
  '2': 1336, '5': 1336, '8': 1336, '0': 1336,
  '3': 1477, '6': 1477, '9': 1477, '#': 1477,
  'A': 1633, 'B': 1633, 'C': 1633, 'D': 1633,
};

class Sounds {
  private ctx: AudioContext | null = null;
  private ringbackTimer: number | null = null;
  private incomingTimer: number | null = null;

  private getContext(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    }
    // Chromium suspends the AudioContext at creation until a user
    // gesture happens. Since every tone is triggered by a user action
    // (dial button press, outbound invite, inbound invite — which
    // itself was preceded by the user opening the app), resuming
    // synchronously here is safe.
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => { /* ignore */ });
    }
    return this.ctx;
  }

  /**
   * Schedule a two-tone burst on the audio context. Uses a gain
   * envelope (2ms attack, 2ms release) so the tone starts and stops
   * without clicking. Returns nothing — the oscillators self-destruct
   * after `durationSec`.
   */
  private playTwoTone(f1: number, f2: number, durationSec: number, level: number): void {
    const ctx = this.getContext();
    const start = ctx.currentTime;
    const end = start + durationSec;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level, start + 0.005);
    gain.gain.setValueAtTime(level, end - 0.005);
    gain.gain.linearRampToValueAtTime(0, end);
    gain.connect(ctx.destination);

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = f1;
    o1.connect(gain);
    o1.start(start);
    o1.stop(end + 0.02);

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f2;
    o2.connect(gain);
    o2.start(start);
    o2.stop(end + 0.02);
  }

  // ---------------- Ringback (outbound) ----------------

  startRingback(): void {
    this.stopRingback();
    // One cycle immediately, then repeat on the 6s interval so the
    // cadence is exactly 2s-on / 4s-off — the North American
    // precise-tone-plan ringback pattern.
    this.playTwoTone(440, 480, 2, 0.08);
    this.ringbackTimer = window.setInterval(() => {
      this.playTwoTone(440, 480, 2, 0.08);
    }, 6000);
  }

  stopRingback(): void {
    if (this.ringbackTimer !== null) {
      clearInterval(this.ringbackTimer);
      this.ringbackTimer = null;
    }
  }

  // ---------------- Incoming ringtone ----------------

  startIncomingRingtone(): void {
    this.stopIncomingRingtone();
    // More aggressive cadence than ringback: 1.5s on / 1.5s off.
    // Louder gain too since the user's attention is what we need.
    this.playTwoTone(440, 480, 1.5, 0.15);
    this.incomingTimer = window.setInterval(() => {
      this.playTwoTone(440, 480, 1.5, 0.15);
    }, 3000);
  }

  stopIncomingRingtone(): void {
    if (this.incomingTimer !== null) {
      clearInterval(this.incomingTimer);
      this.incomingTimer = null;
    }
  }

  // ---------------- DTMF (dialpad) ----------------

  playDtmf(digit: string): void {
    const low = DTMF_LOW[digit];
    const high = DTMF_HIGH[digit];
    if (!low || !high) return;
    // 150ms is the standard human-perceivable DTMF length used by
    // most softphones; shorter feels clicky, longer feels laggy.
    this.playTwoTone(low, high, 0.15, 0.12);
  }

  /**
   * Stop every scheduled tone immediately. Called on logout /
   * unregister so the UI can't keep ringing after the SIP stack
   * has been torn down.
   */
  stopAll(): void {
    this.stopRingback();
    this.stopIncomingRingtone();
  }
}

export const sounds = new Sounds();
