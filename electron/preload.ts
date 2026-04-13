import { contextBridge, ipcRenderer } from 'electron';

// Renderer-facing API. Kept minimal — each surface is a thin wrapper
// around an ipcRenderer.invoke call. Everything async for a consistent
// shape even when the underlying main-process handler is sync.
contextBridge.exposeInMainWorld('ddconnect', {
  platform: process.platform,
  version: process.versions.electron,
  store: {
    get: <T = unknown>(key: string): Promise<T | undefined> =>
      ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke('store:set', key, value),
    delete: (key: string): Promise<void> =>
      ipcRenderer.invoke('store:delete', key),
    clear: (): Promise<void> => ipcRenderer.invoke('store:clear'),
  },
});
