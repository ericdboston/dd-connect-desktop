import { contextBridge } from 'electron';

// Minimal preload — exposes a marker so the renderer can sanity-check it's
// running inside Electron vs a plain browser. Real IPC surface will be
// added as features land (window management for the incoming-call popup,
// electron-store bridge, etc.).
contextBridge.exposeInMainWorld('ddconnect', {
  platform: process.platform,
  version: process.versions.electron,
});
