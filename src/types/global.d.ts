export {};

interface IncomingCallBridgeInfo {
  callerName: string;
  callerNumber: string;
  callId: string;
}

declare global {
  // Injected by vite.config.ts `define` block at build time (YYYY-MM-DD).
  const __BUILD_DATE__: string;

  interface Window {
    ddconnect: {
      platform: NodeJS.Platform;
      version: string;
      // v0.1.4 — CLI provisioning args for customer zero-touch setup
      provision: {
        getArgs: () => Promise<{
          extension?: string;
          password?: string;
          server?: string;
        }>;
      };
      // v0.1.4 — open a URL in the user's default browser
      openExternal: (url: string) => Promise<void>;
      store: {
        get: <T = unknown>(key: string) => Promise<T | undefined>;
        set: (key: string, value: unknown) => Promise<void>;
        delete: (key: string) => Promise<void>;
        clear: () => Promise<void>;
      };
      // v0.1.8 — OS-encrypted credential store (safeStorage-backed).
      // Per-user, per-machine. JWT pair + sip_config (incl. SIP
      // password) live here. Returns discriminated { ok, ... } so
      // callers can distinguish keychain-unavailable from missing data.
      secureStore: {
        isAvailable: () => Promise<boolean>;
        get: <T = unknown>() => Promise<
          { ok: true; data: T | null } | { ok: false; error: string }
        >;
        set: <T = unknown>(
          payload: T,
        ) => Promise<{ ok: true } | { ok: false; error: string }>;
        delete: () => Promise<{ ok: true } | { ok: false; error: string }>;
      };
      incomingCall: {
        show: (info: IncomingCallBridgeInfo) => Promise<void>;
        dismiss: () => Promise<void>;
        sendAction: (action: 'answer' | 'decline') => void;
        onAction: (cb: (action: 'answer' | 'decline') => void) => () => void;
        onUpdate: (cb: (info: IncomingCallBridgeInfo) => void) => () => void;
      };
    };
  }
}
