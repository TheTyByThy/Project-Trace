// Typed access to the Electron preload bridge (electron/preload.cjs).

export interface AppInfo {
  platform: string;
  version: string;
  sampleDataDir: string;
  defaultTelemetryRoot: string;
  userData: string;
  automation: boolean;
}

export interface DirFolder {
  name: string;
  path: string;
  csvCount: number;
  subCount: number;
  latestMtime: number;
}

export interface DirFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

export interface DirListing {
  path: string;
  parent: string | null;
  folders: DirFolder[];
  files: DirFile[];
  error: string | null;
}

/** Data the main process needs to build the dynamic Workspace / Worksheet menus. */
export interface MenuState {
  workspaces: { id: string; name: string; locked: boolean }[];
  activeWorkspaceId: string;
  library: { id: string; name: string }[];
  refColors: 'channel' | 'lap';
  smoothing: boolean;
  theme: 'dark' | 'light';
  canUndo: boolean;
  canRedo: boolean;
  /** First key combo of each shortcut action (src/shortcuts.ts), shown next to menu items. */
  shortcuts: Record<string, string>;
}

export interface PtBridge {
  appInfo(): Promise<AppInfo>;
  getSettings(): Promise<any>;
  setSettings(s: any): Promise<void>;
  listWorkspaces(): Promise<any[]>;
  /** Writes the workspace to the workspaces folder; resolves to the file path. */
  saveWorkspace(ws: any): Promise<string>;
  deleteWorkspace(id: string): Promise<void>;
  /** Read-only default workspaces shipped with the app (default-workspaces/). */
  defaultWorkspaces(): Promise<any[]>;
  workspacesDir(): Promise<string>;
  openWorkspacesDir(): Promise<string>;
  getCache(): Promise<Record<string, any>>;
  setCache(c: Record<string, any>): Promise<void>;
  getNotes(): Promise<Record<string, string>>;
  setNotes(n: Record<string, string>): Promise<void>;
  chooseFolder(defaultPath?: string): Promise<string | null>;
  chooseFiles(defaultPath?: string): Promise<string[]>;
  openJson(): Promise<any | null>;
  saveFile(defaultName: string, filters: { name: string; extensions: string[] }[], data: string | ArrayBuffer): Promise<string | null>;
  listDir(dir: string): Promise<DirListing>;
  exists(p: string): Promise<boolean>;
  stat(p: string): Promise<{ size: number; mtime: number; isDir: boolean } | null>;
  readHead(file: string, bytes?: number): Promise<ArrayBuffer>;
  readFile(file: string): Promise<ArrayBuffer>;
  readRange(file: string, offset: number, length: number): Promise<ArrayBuffer>;
  watchDir(dir: string): Promise<boolean>;
  showItemInFolder(p: string): Promise<void>;
  capture(): Promise<ArrayBuffer>;
  getLibrary(): Promise<any[]>;
  setLibrary(lib: any[]): Promise<void>;
  setMenuState(state: MenuState): void;
  pathForFile(file: File): string;
  onMenu(cb: (action: string) => void): () => void;
  onOpenFiles(cb: (files: string[]) => void): () => void;
  onDirChanged(cb: (dir: string) => void): () => void;
  /** Files changed in the workspaces folder (e.g. a shared workspace was dropped in). */
  onWorkspacesChanged(cb: () => void): () => void;
  /** Capture a rectangle of the window (CSS px) and save it as a titled one-page PDF; resolves to the path or null. */
  printSheetPdf(opts: { rect: { x: number; y: number; width: number; height: number }; title: string; subtitle: string; defaultName: string }): Promise<string | null>;
  /** macOS: the window entered / left full screen (the traffic lights are hidden in full screen). */
  onFullscreen(cb: (on: boolean) => void): () => void;
}

declare global {
  interface Window {
    pt: PtBridge;
    __ptAutomation?: any;
  }
}

export const pt = (): PtBridge => window.pt;

export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
export const dirName = (p: string) => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
};
