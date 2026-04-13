import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

// Disable GPU hardware acceleration on Linux dev boxes where it tends to
// crash Electron. Safe to leave on — software rendering is plenty fast
// for a softphone UI.
app.disableHardwareAcceleration();

const isDev = !app.isPackaged;

// electron-store v10 is ESM-only. We dynamic-import it inside an async
// factory and cache the instance. Alternative (converting the whole
// main-process bundle to ESM) is noisier than a one-liner await here.
let storeInstance: unknown = null;
async function getStore(): Promise<{
  get: (k: string) => unknown;
  set: (k: string, v: unknown) => void;
  delete: (k: string) => void;
  clear: () => void;
}> {
  if (!storeInstance) {
    const { default: Store } = await import('electron-store');
    // encryptionKey is obfuscation, not real crypto — electron-store
    // uses AES-256 with this key as the passphrase. Good enough to keep
    // a dropped laptop from leaking the refresh token to a casual
    // reader, not good enough to defeat a motivated attacker with
    // filesystem access. Don't store the raw SIP password here.
    storeInstance = new Store({
      name: 'ddconnect-auth',
      encryptionKey: 'ddconnect-desktop-v1',
    }) as unknown;
  }
  return storeInstance as {
    get: (k: string) => unknown;
    set: (k: string, v: unknown) => void;
    delete: (k: string) => void;
    clear: () => void;
  };
}

ipcMain.handle('store:get', async (_e, key: string) => {
  const s = await getStore();
  return s.get(key);
});
ipcMain.handle('store:set', async (_e, key: string, value: unknown) => {
  const s = await getStore();
  s.set(key, value);
});
ipcMain.handle('store:delete', async (_e, key: string) => {
  const s = await getStore();
  s.delete(key);
});
ipcMain.handle('store:clear', async () => {
  const s = await getStore();
  s.clear();
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0d1a6e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
