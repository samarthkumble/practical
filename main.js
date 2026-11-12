// Electron main process for Practical.
// Creates one window, wires the SmartSpectra IPC bridge (live mode only) and
// grants camera access to our own local page and nothing else.
'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, session, shell } = require('electron');

function readMode() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'dist', 'mode.json'), 'utf8'));
  } catch {
    return { demo: false };
  }
}

const mode = readMode();

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#f6f1e7',
    title: mode.demo ? 'Practical (demo data)' : 'Practical',
    webPreferences: {
      // The SDK's preload exposes a narrow bridge for its renderer client.
      preload: require.resolve('@smartspectra/node-sdk/preload'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (!mode.demo) {
    // Loading the main-process binding loads the native runtime, so it is
    // skipped in demo mode (which never talks to the SDK).
    const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');
    bindSmartSpectraIpc(win);
  }

  // Only our bundled page is ever shown. Links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.loadFile(path.join(__dirname, 'index.html'));
  if (process.env.PRACTICAL_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  // Camera only (no microphone), and only for our own file:// page.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
    const types = (details && details.mediaTypes) || [];
    const cameraOnly = types.length === 1 && types[0] === 'video';
    callback(permission === 'media' && cameraOnly && url.startsWith('file://'));
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
