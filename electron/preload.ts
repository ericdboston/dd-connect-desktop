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
  incomingCall: {
    // Main window asks main process to open the popup.
    show: (info: {
      callerName: string;
      callerNumber: string;
      callId: string;
    }): Promise<void> => ipcRenderer.invoke('incoming-call:show', info),
    // Main window asks main process to close the popup (called when
    // the call ends for any reason).
    dismiss: (): Promise<void> =>
      ipcRenderer.invoke('incoming-call:dismiss'),
    // Popup renderer fires this when Answer or Decline is clicked.
    sendAction: (action: 'answer' | 'decline'): void =>
      ipcRenderer.send('incoming-call:action', action),
    // Main window subscribes to action events forwarded from the popup.
    onAction: (cb: (action: 'answer' | 'decline') => void): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        action: 'answer' | 'decline',
      ) => cb(action);
      ipcRenderer.on('incoming-call:action', handler);
      return () => ipcRenderer.removeListener('incoming-call:action', handler);
    },
    // Popup subscribes to re-target events (a second call replacing
    // the first one while the popup is still showing — edge case).
    onUpdate: (
      cb: (info: {
        callerName: string;
        callerNumber: string;
        callId: string;
      }) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        info: { callerName: string; callerNumber: string; callId: string },
      ) => cb(info);
      ipcRenderer.on('incoming-call:update', handler);
      return () => ipcRenderer.removeListener('incoming-call:update', handler);
    },
  },
});
