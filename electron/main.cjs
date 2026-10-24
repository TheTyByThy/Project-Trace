// Project-Trace — Electron main process.
// Responsibilities: window lifecycle, the app:// protocol that serves the built renderer,
// and a small, explicit IPC surface for filesystem access, dialogs and persistence.
// The renderer never gets Node access; everything goes through preload.cjs.

const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const IS_DEV = !!process.env.PT_DEV_URL;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const SCREENSHOT_DIR = process.env.PT_SCREENSHOT_DIR || '';

// Screenshot automation runs with a throwaway profile so it never touches real settings.
if (SCREENSHOT_DIR) {
  const tmpProfile = path.join(app.getPath('temp'), 'project-trace-screenshot-profile');
  fs.rmSync(tmpProfile, { recursive: true, force: true });
  app.setPath('userData', tmpProfile);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// ---------------------------------------------------------------------------------------------
// Paths & JSON persistence
// ---------------------------------------------------------------------------------------------

const userDir = () => app.getPath('userData');
const settingsFile = () => path.join(userDir(), 'settings.json');
const workspacesDir = () => path.join(userDir(), 'workspaces');
const cacheFile = () => path.join(userDir(), 'session-cache.json');
const notesFile = () => path.join(userDir(), 'session-notes.json');
const libraryFile = () => path.join(userDir(), 'worksheet-library.json');

function sampleDataDir() {
  const packaged = path.join(process.resourcesPath || '', 'sample-data');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'sample-data');
}

function defaultTelemetryRoot() {
  const candidates = [
    path.join(app.getPath('documents'), 'Assetto Corsa', 'apps', 'telemetrick', 'exported'),
    path.join(app.getPath('home'), 'Documents', 'Assetto Corsa', 'apps', 'telemetrick', 'exported'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || '';
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// File operations are queued per path so overlapping saves/deletes (e.g. undo racing a debounced
// save) run in order and never clash.
const fileQueues = new Map();
let tmpCounter = 0;
function queued(file, op) {
  const next = (fileQueues.get(file) || Promise.resolve()).catch(() => {}).then(op);
  fileQueues.set(file, next);
  return next;
}

// Write to a unique temp file then rename, so a crash mid-write never corrupts settings/workspaces.
function writeJson(file, data) {
  return queued(file, async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fsp.rename(tmp, file);
  });
}

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const isTelemetryFile = (name) => /\.(csv|txt|ld)$/i.test(name);
// An export can have both a .csv and an .ld — count them as one session.
const sessionKey = (name) => name.replace(/\.(csv|txt|ld)$/i, '').toLowerCase();

// ---------------------------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------------------------

let mainWindow = null;
let pendingOpenFiles = [];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1020,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0f1216',
    title: 'Project-Trace',
    icon: fs.existsSync(path.join(__dirname, '..', 'build', 'icon.png')) ? path.join(__dirname, '..', 'build', 'icon.png') : undefined,
    show: !SCREENSHOT_DIR,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  if (IS_DEV) mainWindow.loadURL(process.env.PT_DEV_URL);
  else mainWindow.loadURL('app://bundle/index.html');

  // External links open in the user's browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOpenFiles.length) {
      mainWindow.webContents.send('app:open-files', pendingOpenFiles);
      pendingOpenFiles = [];
    }
    if (SCREENSHOT_DIR) runScreenshotAutomation().catch((e) => {
      console.error('[screenshots] failed:', e);
      app.exit(1);
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendMenu(action) {
  if (mainWindow) mainWindow.webContents.send('menu:action', action);
}

// The renderer pushes the data needed for the dynamic menus (workspaces, saved worksheets…).
let menuState = { workspaces: [], activeWorkspaceId: '', library: [], refColors: 'channel', smoothing: false };

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const s = menuState;
  const library = s.library || [];
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Session Browser…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open-browser') },
        { label: 'Open Telemetry Files…', accelerator: 'CmdOrCtrl+Shift+O', click: () => sendMenu('open-files') },
        { type: 'separator' },
        { label: 'Export Visible Data to CSV…', accelerator: 'CmdOrCtrl+E', click: () => sendMenu('export-csv') },
        { label: 'Save Screenshot (PNG)…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenu('screenshot') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendMenu('settings') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      // Custom Edit menu: Undo/Redo drive the app's own history (layouts, components, worksheets…);
      // inside text fields the renderer falls back to normal text undo.
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendMenu('undo') },
        { label: 'Redo', accelerator: isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y', click: () => sendMenu('redo') },
        ...(isMac ? [] : [{ label: 'Redo', accelerator: 'Ctrl+Shift+Z', visible: false, acceleratorWorksWhenHidden: true, click: () => sendMenu('redo') }]),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Workspace',
      submenu: [
        ...(s.workspaces || []).map((w) => ({
          label: w.locked ? `${w.name}  (built-in, read-only)` : w.name,
          type: 'radio',
          checked: w.id === s.activeWorkspaceId,
          click: () => sendMenu('ws-switch:' + w.id),
        })),
        { type: 'separator' },
        { label: 'New Workspace from Starter…', click: () => sendMenu('ws-new-starter') },
        { label: 'New Blank Workspace…', click: () => sendMenu('ws-new-blank') },
        { label: 'Duplicate Current Workspace', click: () => sendMenu('ws-duplicate') },
        { label: 'Rename Current Workspace…', click: () => sendMenu('ws-rename') },
        { type: 'separator' },
        { label: 'Revert Current Workspace to Starter', click: () => sendMenu('ws-revert') },
        { type: 'separator' },
        { label: 'Export Workspace…', click: () => sendMenu('ws-export') },
        { label: 'Import Workspace…', click: () => sendMenu('ws-import') },
        { type: 'separator' },
        { label: 'Delete Current Workspace…', click: () => sendMenu('ws-delete') },
      ],
    },
    {
      label: 'Worksheet',
      submenu: [
        { label: 'New Worksheet', click: () => sendMenu('sheet-new') },
        { label: 'Duplicate Worksheet', click: () => sendMenu('sheet-duplicate') },
        { label: 'Rename Worksheet…', click: () => sendMenu('sheet-rename') },
        { label: 'Reset Worksheet to Starter Version', click: () => sendMenu('sheet-reset') },
        { type: 'separator' },
        { label: 'Save Worksheet to Library…', click: () => sendMenu('sheet-save-lib') },
        {
          label: 'Insert Saved Worksheet',
          submenu: library.length
            ? library.map((l) => ({ label: l.name, click: () => sendMenu('sheet-insert-lib:' + l.id) }))
            : [{ label: 'Library is empty', enabled: false }],
        },
        {
          label: 'Remove from Library',
          submenu: library.length
            ? library.map((l) => ({ label: l.name, click: () => sendMenu('sheet-delete-lib:' + l.id) }))
            : [{ label: 'Library is empty', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Export Worksheet…', click: () => sendMenu('sheet-export') },
        { label: 'Import Worksheet…', click: () => sendMenu('sheet-import') },
        { type: 'separator' },
        { label: 'Delete Worksheet…', click: () => sendMenu('sheet-delete') },
      ],
    },
    {
      label: 'Analysis',
      submenu: [
        { label: 'Math Channels…', accelerator: 'CmdOrCtrl+M', click: () => sendMenu('math') },
        { label: 'Track Profile (corners, sections, rotation)…', click: () => sendMenu('track-profile') },
        { type: 'separator' },
        { label: 'Toggle Time / Distance', accelerator: 'D', registerAccelerator: false, click: () => sendMenu('toggle-x') },
        { label: 'Toggle Time Variance', accelerator: 'F3', registerAccelerator: false, click: () => sendMenu('toggle-variance') },
        { label: 'Smoothing', type: 'checkbox', checked: !!s.smoothing, accelerator: 'S', registerAccelerator: false, click: () => sendMenu('toggle-smoothing') },
        {
          label: 'Reference Lap in Channel Colours',
          type: 'checkbox',
          checked: s.refColors !== 'lap',
          accelerator: 'J',
          registerAccelerator: false,
          click: () => sendMenu('toggle-ref-colors'),
        },
        { type: 'separator' },
        { label: 'Zoom to Whole Lap', accelerator: 'W', registerAccelerator: false, click: () => sendMenu('zoom-lap') },
        { label: 'Fastest Lap as Reference', accelerator: 'F', registerAccelerator: false, click: () => sendMenu('fastest-lap') },
        { label: 'Previous Lap', accelerator: 'Up', registerAccelerator: false, click: () => sendMenu('prev-lap') },
        { label: 'Next Lap', accelerator: 'Down', registerAccelerator: false, click: () => sendMenu('next-lap') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Properties Pop-out…', click: () => sendMenu('properties') },
        { label: 'Toggle Properties Panel', accelerator: 'CmdOrCtrl+I', click: () => sendMenu('toggle-inspector') },
        { label: 'Command Palette…', accelerator: 'CmdOrCtrl+K', click: () => sendMenu('palette') },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => sendMenu('toggle-sidebar') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'F1', click: () => sendMenu('shortcuts') },
        { label: 'Open Documentation Folder', click: () => shell.openPath(path.join(__dirname, '..', 'docs')) },
        { label: 'Open Settings Folder', click: () => shell.openPath(userDir()) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    sampleDataDir: sampleDataDir(),
    defaultTelemetryRoot: defaultTelemetryRoot(),
    userData: userDir(),
    automation: !!SCREENSHOT_DIR,
  }));

  ipcMain.handle('settings:get', () => readJson(settingsFile(), null));
  ipcMain.handle('settings:set', (_e, data) => writeJson(settingsFile(), data));

  ipcMain.handle('workspaces:list', async () => {
    try {
      const files = (await fsp.readdir(workspacesDir())).filter((f) => f.endsWith('.json'));
      const out = [];
      for (const f of files) {
        const ws = await readJson(path.join(workspacesDir(), f), null);
        if (ws && ws.id) out.push(ws);
      }
      return out;
    } catch {
      return [];
    }
  });
  ipcMain.handle('workspaces:save', (_e, ws) => writeJson(path.join(workspacesDir(), safeName(ws.id) + '.json'), ws));
  ipcMain.handle('workspaces:delete', (_e, id) => {
    const file = path.join(workspacesDir(), safeName(id) + '.json');
    return queued(file, () => fsp.rm(file, { force: true }));
  });

  ipcMain.handle('cache:get', () => readJson(cacheFile(), {}));
  ipcMain.handle('cache:set', (_e, data) => writeJson(cacheFile(), data));
  ipcMain.handle('notes:get', () => readJson(notesFile(), {}));
  ipcMain.handle('notes:set', (_e, data) => writeJson(notesFile(), data));
  ipcMain.handle('library:get', () => readJson(libraryFile(), []));
  ipcMain.handle('library:set', (_e, data) => writeJson(libraryFile(), data));
  ipcMain.on('menu:state', (_e, state) => {
    menuState = state || menuState;
    buildMenu();
  });

  ipcMain.handle('dialog:openFolder', async (_e, defaultPath) => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose your telemetry folder',
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('dialog:openFiles', async (_e, defaultPath) => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Open telemetry CSV files',
      defaultPath: defaultPath || undefined,
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Telemetry (CSV, MoTeC .ld)', extensions: ['csv', 'txt', 'ld'] }, { name: 'All files', extensions: ['*'] }],
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('dialog:openJson', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Import workspace',
      properties: ['openFile'],
      filters: [{ name: 'Project-Trace workspace', extensions: ['json', 'ptw'] }],
    });
    if (r.canceled) return null;
    return readJson(r.filePaths[0], null);
  });

  ipcMain.handle('dialog:saveFile', async (_e, { defaultName, filters, data }) => {
    const r = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName, filters });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
    return r.filePath;
  });

  ipcMain.handle('fs:listDir', async (_e, dir) => listDir(dir));
  ipcMain.handle('fs:exists', (_e, p) => !!p && fs.existsSync(p));
  ipcMain.handle('fs:stat', async (_e, p) => {
    try {
      const s = await fsp.stat(p);
      return { size: s.size, mtime: s.mtimeMs, isDir: s.isDirectory() };
    } catch {
      return null;
    }
  });

  ipcMain.handle('fs:readHead', async (_e, file, bytes) => {
    const fh = await fsp.open(file, 'r');
    try {
      const size = (await fh.stat()).size;
      const n = Math.min(size, bytes || 65536);
      const buf = Buffer.alloc(n);
      await fh.read(buf, 0, n, 0);
      return toArrayBuffer(buf);
    } finally {
      await fh.close();
    }
  });

  ipcMain.handle('fs:readFile', async (_e, file) => toArrayBuffer(await fsp.readFile(file)));
  ipcMain.handle('fs:readRange', async (_e, file, offset, length) => {
    const fh = await fsp.open(file, 'r');
    try {
      const buf = Buffer.alloc(Math.max(0, length));
      const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
      return toArrayBuffer(buf.subarray(0, bytesRead));
    } finally {
      await fh.close();
    }
  });

  ipcMain.handle('fs:watch', (_e, dir) => watchDir(dir));
  ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle('app:capture', async () => toArrayBuffer((await mainWindow.webContents.capturePage()).toPNG()));
}

function safeName(s) {
  return String(s).replace(/[^a-zA-Z0-9_\-]/g, '_');
}

async function listDir(dir) {
  const out = { path: dir, parent: path.dirname(dir) !== dir ? path.dirname(dir) : null, folders: [], files: [], error: null };
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    out.error = String(e.message || e);
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name.startsWith('.')) continue;
      // Peek one level down so the browser can show "12 sessions · last driven 2 days ago".
      const sessions = new Set();
      let subCount = 0;
      let latest = 0;
      try {
        for (const sub of await fsp.readdir(full, { withFileTypes: true })) {
          if (sub.isDirectory()) subCount++;
          else if (isTelemetryFile(sub.name)) {
            sessions.add(sessionKey(sub.name));
            const st = await fsp.stat(path.join(full, sub.name));
            latest = Math.max(latest, st.mtimeMs);
          }
        }
      } catch {
        /* unreadable folder — still list it */
      }
      if (!latest) {
        try {
          latest = (await fsp.stat(full)).mtimeMs;
        } catch {}
      }
      out.folders.push({ name: ent.name, path: full, csvCount: sessions.size, subCount, latestMtime: latest });
    } else if (isTelemetryFile(ent.name)) {
      try {
        const st = await fsp.stat(full);
        out.files.push({ name: ent.name, path: full, size: st.size, mtime: st.mtimeMs });
      } catch {}
    }
  }
  return out;
}

let watcher = null;
let watchTimer = null;
function watchDir(dir) {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    watcher = fs.watch(dir, { persistent: false }, () => {
      clearTimeout(watchTimer);
      // Exporters write large files incrementally; wait for things to settle before refreshing.
      watchTimer = setTimeout(() => mainWindow && mainWindow.webContents.send('fs:changed', dir), 1200);
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Screenshot automation (used by `npm run screenshots` to produce the images in docs/)
// ---------------------------------------------------------------------------------------------

async function runScreenshotAutomation() {
  const wc = mainWindow.webContents;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const evalJs = (code) => wc.executeJavaScript(code, true);
  await fsp.mkdir(SCREENSHOT_DIR, { recursive: true });
  mainWindow.setSize(1680, 1020);
  mainWindow.showInactive();

  for (let i = 0; i < 100; i++) {
    if (await evalJs('!!(window.__ptAutomation && window.__ptAutomation.ready())')) break;
    await wait(200);
  }
  const shot = async (name) => {
    await wait(900);
    const img = await wc.capturePage();
    await fsp.writeFile(path.join(SCREENSHOT_DIR, name + '.png'), img.toPNG());
    console.log('[screenshots] saved', name);
  };

  const sampleDir = sampleDataDir();
  // Optional: PT_SCREENSHOT_OPEN="<file>;<file>" to capture specific sessions instead of the sample.
  const files = process.env.PT_SCREENSHOT_OPEN
    ? process.env.PT_SCREENSHOT_OPEN.split(';').filter((f) => fs.existsSync(f))
    : (await fsp.readdir(sampleDir)).filter(isTelemetryFile).map((f) => path.join(sampleDir, f));
  // Optional: PT_SCREENSHOT_BROWSE=<folder with track sub-folders> to capture the track picker.
  if (process.env.PT_SCREENSHOT_BROWSE && fs.existsSync(process.env.PT_SCREENSHOT_BROWSE)) {
    await evalJs(`window.__ptAutomation.showBrowser(${JSON.stringify(process.env.PT_SCREENSHOT_BROWSE)})`);
    await shot('00-session-browser-tracks');
  }
  await evalJs(`window.__ptAutomation.showBrowser(${JSON.stringify(sampleDir)})`);
  await shot('00-session-browser');
  await evalJs(`window.__ptAutomation.openFiles(${JSON.stringify(files)})`);
  for (let i = 0; i < 300; i++) {
    if (await evalJs(`window.__ptAutomation.loaded(${files.length})`)) break;
    await wait(200);
  }
  console.log('[screenshots] requested ' + files.length + ' file(s); loaded: ' + JSON.stringify(await evalJs('window.__ptAutomation.sessions ? window.__ptAutomation.sessions() : null')));
  const sheets = await evalJs('window.__ptAutomation.worksheets()');
  for (let i = 0; i < sheets.length; i++) {
    await evalJs(`window.__ptAutomation.setWorksheet(${i}, true)`);
    await shot(String(i + 1).padStart(2, '0') + '-' + sheets[i].toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  }
  const extras = await evalJs('window.__ptAutomation.extras ? window.__ptAutomation.extras() : []');
  for (const name of extras) {
    await evalJs(`window.__ptAutomation.runExtra(${JSON.stringify(name)})`);
    await shot('x-' + name);
  }
  // End-to-end checks (undo/redo, read-only Starter) run last so their toasts don't appear in shots.
  const checks = await evalJs('window.__ptAutomation.checks ? window.__ptAutomation.checks() : []');
  for (const c of checks) console.log('[check] ' + c);
  const errors = await evalJs('window.__ptAutomation.errors()');
  if (errors && errors.length) console.log('[screenshots] renderer errors:\n' + errors.join('\n'));
  app.quit();
}

// ---------------------------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------------------------

const gotLock = SCREENSHOT_DIR ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = argv.filter((a) => isTelemetryFile(a) && fs.existsSync(a));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (files.length) mainWindow.webContents.send('app:open-files', files);
    }
  });

  // macOS: files dropped on the dock icon / opened via Finder.
  app.on('open-file', (e, file) => {
    e.preventDefault();
    if (mainWindow) mainWindow.webContents.send('app:open-files', [file]);
    else pendingOpenFiles.push(file);
  });

  app.whenReady().then(() => {
    protocol.handle('app', (request) => {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (!rel) rel = 'index.html';
      const file = path.normalize(path.join(DIST_DIR, rel));
      if (!file.startsWith(DIST_DIR)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });

    pendingOpenFiles.push(...process.argv.slice(1).filter((a) => isTelemetryFile(a) && fs.existsSync(a)));
    registerIpc();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || SCREENSHOT_DIR) app.quit();
  });
}
