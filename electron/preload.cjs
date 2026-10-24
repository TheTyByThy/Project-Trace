// Project-Trace — preload bridge. Exposes a narrow, typed API (see src/core/bridge.ts) as window.pt.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('pt', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  listWorkspaces: () => ipcRenderer.invoke('workspaces:list'),
  saveWorkspace: (ws) => ipcRenderer.invoke('workspaces:save', ws),
  deleteWorkspace: (id) => ipcRenderer.invoke('workspaces:delete', id),
  getCache: () => ipcRenderer.invoke('cache:get'),
  setCache: (c) => ipcRenderer.invoke('cache:set', c),
  getNotes: () => ipcRenderer.invoke('notes:get'),
  setNotes: (n) => ipcRenderer.invoke('notes:set', n),
  chooseFolder: (defaultPath) => ipcRenderer.invoke('dialog:openFolder', defaultPath),
  chooseFiles: (defaultPath) => ipcRenderer.invoke('dialog:openFiles', defaultPath),
  openJson: () => ipcRenderer.invoke('dialog:openJson'),
  saveFile: (defaultName, filters, data) => ipcRenderer.invoke('dialog:saveFile', { defaultName, filters, data }),
  listDir: (dir) => ipcRenderer.invoke('fs:listDir', dir),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  stat: (p) => ipcRenderer.invoke('fs:stat', p),
  readHead: (file, bytes) => ipcRenderer.invoke('fs:readHead', file, bytes),
  readFile: (file) => ipcRenderer.invoke('fs:readFile', file),
  readRange: (file, offset, length) => ipcRenderer.invoke('fs:readRange', file, offset, length),
  watchDir: (dir) => ipcRenderer.invoke('fs:watch', dir),
  showItemInFolder: (p) => ipcRenderer.invoke('shell:showItem', p),
  capture: () => ipcRenderer.invoke('app:capture'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onMenu: on('menu:action'),
  onOpenFiles: on('app:open-files'),
  onDirChanged: on('fs:changed'),
});
