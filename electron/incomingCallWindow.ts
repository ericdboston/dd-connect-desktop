import { BrowserWindow, screen } from 'electron';
import path from 'node:path';

/**
 * Incoming call popup window — always-on-top, frameless, borderless.
 *
 * Lifecycle:
 *   openIncomingCallWindow(info)  — creates the popup if none exists,
 *                                    otherwise loads the new caller info
 *                                    into the existing one
 *   closeIncomingCallWindow()     — closes and clears the singleton
 *
 * There is at most one popup at a time. If a second incoming call
 * arrived while the first popup was still showing (shouldn't happen
 * in v0.1 because SipClient rejects a second invite with 486) we'd
 * just re-target the same popup.
 *
 * The popup loads the same renderer bundle but navigates to the
 * #/incoming-call hash, which App.tsx detects and renders the
 * IncomingCallPopup component instead of the main shell.
 */

let popup: BrowserWindow | null = null;

export interface IncomingCallInfo {
  callerName: string;
  callerNumber: string;
  callId: string;
}

export function openIncomingCallWindow(info: IncomingCallInfo): void {
  // If a popup already exists just navigate it to the new caller info.
  if (popup && !popup.isDestroyed()) {
    popup.webContents.send('incoming-call:update', info);
    popup.focus();
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();
  const width = 380;
  const height = 220;
  // Center horizontally, sit a bit above vertical center so the popup
  // doesn't fight a typical active-call window for attention.
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = Math.round(workArea.y + workArea.height / 3 - height / 2);

  popup = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Make it appear above fullscreen apps on macOS too.
  popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popup.setAlwaysOnTop(true, 'screen-saver');

  // Encode caller info as hash-query params so the renderer reads
  // them from window.location.hash without any IPC round-trip for
  // the initial render. We still use IPC for the update path
  // above if a second call arrives.
  const qs = new URLSearchParams({
    name: info.callerName,
    number: info.callerNumber,
    callId: info.callId,
  }).toString();

  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    popup.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/incoming-call?${qs}`);
  } else {
    popup.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      hash: `/incoming-call?${qs}`,
    });
  }

  popup.once('ready-to-show', () => {
    popup?.show();
  });

  popup.on('closed', () => {
    popup = null;
  });
}

export function closeIncomingCallWindow(): void {
  if (popup && !popup.isDestroyed()) {
    popup.close();
  }
  popup = null;
}
