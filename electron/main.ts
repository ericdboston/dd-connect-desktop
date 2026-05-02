import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import {
  openIncomingCallWindow,
  closeIncomingCallWindow,
} from './incomingCallWindow';

// Disable GPU hardware acceleration on Linux dev boxes where it tends to
// crash Electron. Safe to leave on — software rendering is plenty fast
// for a softphone UI.
app.disableHardwareAcceleration();

const isDev = !app.isPackaged;

// ---------- CLI provisioning args (v0.1.4) ----------
//
// DDTG provisions a customer by running:
//   "DD Connect Desktop.exe" --extension 1001 --password xxx --server portal.decisivedatatech.com
//
// The app detects these args on first launch, auto-logs in, saves the
// session with Remember Me ON, and goes straight to the dialpad. Customer
// relaunches normally → session is restored → zero manual entry.
function parseProvisionArgs(): {
  extension?: string;
  password?: string;
  server?: string;
} {
  const args = process.argv.slice(isDev ? 2 : 1);
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    for (const key of ['extension', 'password', 'server'] as const) {
      if (a === `--${key}` && args[i + 1]) {
        result[key] = args[++i];
      } else if (a.startsWith(`--${key}=`)) {
        result[key] = a.split('=').slice(1).join('=');
      }
    }
  }
  return result;
}

const provisionArgs = parseProvisionArgs();
if (provisionArgs.extension) {
  console.log(`[main] provision args: ext=${provisionArgs.extension} server=${provisionArgs.server ?? '(default)'}`);
}

ipcMain.handle('provision:args', () => provisionArgs);
ipcMain.handle('open-external', (_e, url: string) => shell.openExternal(url));

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

// ---------- Incoming-call popup IPC ----------
//
// Message flow:
//   1. SipClient (main renderer) receives a SIP INVITE from mod_sofia
//   2. useSip.init()'s 'incomingCall' listener calls
//      ipcRenderer.invoke('incoming-call:show', info)
//   3. This handler opens/refocuses the popup window
//   4. Popup renderer's Answer/Decline buttons call
//      ipcRenderer.send('incoming-call:action', 'answer' | 'decline')
//   5. This handler forwards the action to the main window
//   6. Main window's useSip bridge calls SipClient.answerCall() or
//      SipClient.hangupCall() accordingly
//   7. When the call ends (for any reason) main renderer calls
//      ipcRenderer.invoke('incoming-call:dismiss') which closes popup
let mainWindow: BrowserWindow | null = null;

ipcMain.handle(
  'incoming-call:show',
  (
    _e,
    info: { callerName: string; callerNumber: string; callId: string },
  ) => {
    openIncomingCallWindow(info);
  },
);

ipcMain.handle('incoming-call:dismiss', () => {
  closeIncomingCallWindow();
});

ipcMain.on(
  'incoming-call:action',
  (_e, action: 'answer' | 'decline') => {
    // Forward to the main renderer, which wires it into SipClient.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('incoming-call:action', action);
    }
    // Close the popup — the main window takes over the call UI from here.
    closeIncomingCallWindow();
  },
);

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

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// ---------- Auto-update (electron-updater + generic provider) ----------
//
// Provider URL is set in package.json's build.publish block. On launch the
// updater fetches https://portal.decisivedatatech.com/download/latest.yml,
// compares versions, and downloads the newer .exe in the background. When
// the download completes we prompt the user; "Install Now" relaunches into
// the new version, "Later" defers until next launch.
//
// In dev mode (`npm run dev`) electron-updater logs a noisy
// "app-update.yml not found" because there's no release manifest baked in.
// Skip the whole flow there — only packaged builds need it.
function setupAutoUpdater() {
  if (isDev) return;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  // We want to PROMPT before installing, not silent-install on quit.
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    log.info('[autoUpdater] update available:', info.version);
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('[autoUpdater] no update available (current:', info.version, ')');
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[autoUpdater] update downloaded:', info.version);
    const opts = {
      type: 'info' as const,
      title: 'Update Available',
      message: `DD Connect Desktop v${info.version} is ready to install.`,
      detail: `You're currently on v${app.getVersion()}. Install now to get the latest features and fixes.`,
      buttons: ['Install Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    };
    const promise = mainWindow
      ? dialog.showMessageBox(mainWindow, opts)
      : dialog.showMessageBox(opts);
    promise.then((result) => {
      if (result.response === 0) {
        // (isSilent=false, isForceRunAfter=true) → run installer UI then
        // relaunch the app on completion.
        autoUpdater.quitAndInstall(false, true);
      }
    });
  });

  autoUpdater.on('error', (err) => {
    log.error('[autoUpdater] error:', err);
  });

  // Initial check 5s after launch — gives the renderer time to mount and
  // avoids competing with first-paint resource downloads.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.error('[autoUpdater] initial check failed:', err);
    });
  }, 5000);

  // Periodic check every 4 hours for long-running sessions.
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.error('[autoUpdater] periodic check failed:', err);
    });
  }, 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
