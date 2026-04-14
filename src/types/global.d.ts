export {};

interface IncomingCallBridgeInfo {
  callerName: string;
  callerNumber: string;
  callId: string;
}

declare global {
  interface Window {
    ddconnect: {
      platform: NodeJS.Platform;
      version: string;
      store: {
        get: <T = unknown>(key: string) => Promise<T | undefined>;
        set: (key: string, value: unknown) => Promise<void>;
        delete: (key: string) => Promise<void>;
        clear: () => Promise<void>;
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
