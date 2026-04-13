export {};

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
    };
  }
}
