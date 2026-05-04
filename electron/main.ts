import { app, BrowserWindow, ipcMain, safeStorage, shell, dialog } from 'electron';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import {
  openIncomingCallWindow,
  closeIncomingCallWindow,
} from './incomingCallWindow';
import { SecureStore } from './secureStore';
import { migrateLegacyStore } from './migrateLegacyStore';

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

// ---------- Persistence layout (v0.1.8) ----------
//
// Two stores, both rooted at app.getPath('userData'):
//
//   ddconnect-secure.bin   OS-encrypted credential blob (SIP password,
//                          JWT access + refresh, sip_config). Encrypted
//                          via Electron safeStorage — DPAPI on Windows,
//                          Keychain on macOS, libsecret on Linux. Bound
//                          to the OS user; not portable across machines.
//   ddconnect-prefs.json   Plaintext user prefs that are not credentials:
//                          remembered extension, server URL, audio
//                          device IDs, recents clear-cutoff timestamp.
//
// Replaces the v0.1.7 single file ddconnect-auth.json which used
// electron-store's "encryptionKey" option with a static value baked
// into the binary. migrateLegacyStore() handles the upgrade.

let prefsInstance: {
  get: (k: string) => unknown;
  set: (k: string, v: unknown) => void;
  delete: (k: string) => void;
  clear: () => void;
} | null = null;

async function getPrefs(): Promise<NonNullable<typeof prefsInstance>> {
  if (!prefsInstance) {
    // electron-store v10 is ESM-only. We dynamic-import to avoid
    // converting the whole main-process bundle to ESM.
    const { default: Store } = await import('electron-store');
    prefsInstance = new Store({
      name: 'ddconnect-prefs',
    }) as unknown as NonNullable<typeof prefsInstance>;
  }
  return prefsInstance;
}

const secureStore = new SecureStore(safeStorage, app.getPath('userData'));

// Run the legacy migration once per process. Driven by app.whenReady
// below so app.getPath('userData') resolves to the real location.
let migrationRan = false;
async function runMigrationOnce(): Promise<void> {
  if (migrationRan) return;
  migrationRan = true;
  try {
    const prefs = await getPrefs();
    const result = await migrateLegacyStore(
      app.getPath('userData'),
      secureStore,
      prefs,
    );
    if (result.hadLegacyFile) {
      if (result.migrated) {
        log.info(
          '[migrate] legacy store migrated:',
          `session=${result.migratedSession}`,
          `prefs=${result.migratedPrefCount}`,
        );
      } else {
        log.warn('[migrate] legacy store NOT migrated:', result.error);
      }
    }
  } catch (err) {
    log.error('[migrate] unexpected failure:', err);
  }
}

ipcMain.handle('store:get', async (_e, key: string) => {
  const s = await getPrefs();
  return s.get(key);
});
ipcMain.handle('store:set', async (_e, key: string, value: unknown) => {
  const s = await getPrefs();
  s.set(key, value);
});
ipcMain.handle('store:delete', async (_e, key: string) => {
  const s = await getPrefs();
  s.delete(key);
});
ipcMain.handle('store:clear', async () => {
  const s = await getPrefs();
  s.clear();
});

// Secure store IPC — used by the renderer's auth store for the session
// blob (JWT pair + sip_config including SIP password). All four handlers
// return a discriminated { ok, ... } shape so the renderer can show a
// clear error when the OS keychain is unavailable instead of silently
// degrading to plaintext.
ipcMain.handle('secureStore:isAvailable', () => secureStore.isAvailable());
ipcMain.handle('secureStore:get', async () => {
  await runMigrationOnce();
  return secureStore.get();
});
ipcMain.handle('secureStore:set', async (_e, payload: unknown) =>
  secureStore.set(payload),
);
ipcMain.handle('secureStore:delete', async () => secureStore.delete());

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

app.whenReady().then(async () => {
  // Run the legacy → safeStorage migration before the renderer mounts
  // so the very first secureStore:get from auth.hydrate sees the new
  // layout. Errors are logged inside runMigrationOnce; we don't block
  // window creation on them.
  await runMigrationOnce();

  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
