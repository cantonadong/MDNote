// Thin typed wrapper around the Wails-generated `window.go.main.App` bridge.
// Hand-written (not `wails generate`d) since the Go method set is small and
// stable; keeps the frontend buildable without invoking the Wails CLI.

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface Settings {
  rootDir: string;
  windowMaximized: boolean;
  openTabPaths: string[] | null;
  activeTabPath: string;
  language: string;
  outlineAutoNumber: boolean;
  grammarCheckEnabled: boolean;
  customDictionary: string[] | null;
  syncEnabled: boolean;
  syncURL: string;
  syncUsername: string;
  syncPassword: string;
  syncIntervalMinutes: number;
  lastSyncTime: string;
  lastSyncError: string;
}

export interface SyncStatus {
  enabled: boolean;
  configured: boolean;
  syncing: boolean;
  lastSyncTime: string;
  lastError: string;
  filesSynced: number;
}

export interface SyncResult {
  success: boolean;
  message: string;
  filesSynced: number;
  errors: string[] | null;
}

function goApp(): any {
  const w = window as any;
  if (!w.go?.main?.App) {
    throw new Error("Wails runtime unavailable (not running inside the desktop shell)");
  }
  return w.go.main.App;
}

export const api = {
  getSettings: (): Promise<Settings> => goApp().GetSettings(),
  saveOpenTabs: (paths: string[], activePath: string): Promise<void> => goApp().SaveOpenTabs(paths, activePath),
  selectRootDir: (): Promise<Settings> => goApp().SelectRootDir(),
  migrateRootDir: (): Promise<Settings> => goApp().MigrateRootDir(),
  getInitialFile: (): Promise<string> => goApp().GetInitialFile(),
  onOpenFile: (handler: (path: string) => void): void => {
    (window as any).runtime?.EventsOn?.("open-file", handler);
  },
  // window.runtime.OnFileDrop wires up the *frontend-side* dragover/drop
  // listeners that call preventDefault() on an incoming OS file drop —
  // without calling this, WebView2's default "navigate to file://" wins
  // regardless of the Go-side EnableFileDrop option. useDropTarget=false so
  // any drop anywhere in the window counts (no --wails-drop-target CSS
  // marker needed on a specific element).
  onFileDrop: (handler: (paths: string[], coords: { x: number; y: number }) => void): void => {
    (window as any).runtime?.OnFileDrop?.((x: number, y: number, paths: string[]) => handler(paths, { x, y }), false);
  },
  openFileDialog: (defaultDir: string): Promise<string> => goApp().OpenFileDialog(defaultDir),
  openAnyFileDialog: (): Promise<string> => goApp().OpenAnyFileDialog(),
  saveFileDialog: (defaultName: string, defaultDir: string): Promise<string> =>
    goApp().SaveFileDialog(defaultName, defaultDir),
  savePdfDialog: (defaultName: string, defaultDir: string): Promise<string> =>
    goApp().SavePdfDialog(defaultName, defaultDir),
  // Silently renders html to a PDF at path via a throwaway hidden WebView2
  // instance on the Go side — no print preview/print dialog ever appears.
  exportPdf: (html: string, path: string): Promise<void> => goApp().ExportPdf(html, path),
  basename: (path: string): Promise<string> => goApp().Basename(path),
  fileExists: (path: string): Promise<boolean> => goApp().FileExists(path),
  openWithDefaultApp: (path: string): Promise<void> => goApp().OpenWithDefaultApp(path),
  revealInExplorer: (path: string): Promise<void> => goApp().RevealInExplorer(path),
  openURL: (url: string): void => {
    goApp().OpenURL(url);
  },
  listDir: (dirPath: string): Promise<FileEntry[]> => goApp().ListDir(dirPath),
  readFile: (path: string): Promise<string> => goApp().ReadFile(path),
  writeFile: (path: string, content: string): Promise<void> => goApp().WriteFile(path, content),
  createEntry: (parentDir: string, name: string, isDir: boolean): Promise<FileEntry> =>
    goApp().CreateEntry(parentDir, name, isDir),
  renameEntry: (path: string, newName: string): Promise<string> => goApp().RenameEntry(path, newName),
  deleteEntry: (path: string): Promise<void> => goApp().DeleteEntry(path),
  moveEntry: (srcPath: string, destDir: string): Promise<string> => goApp().MoveEntry(srcPath, destDir),
  // Stable id -> path resolution for page/file link chips — see linkids.go.
  // Lets a link keep working after its target is renamed/moved even if the
  // file holding the link wasn't open at the time (nothing was open to
  // patch its stored path, but the id never changes).
  ensureLinkID: (path: string): Promise<string> => goApp().EnsureLinkID(path),
  resolveLinkID: (id: string): Promise<string> => goApp().ResolveLinkID(id),
  saveAppSettings: (language: string, outlineAutoNumber: boolean, grammarCheckEnabled: boolean): Promise<Settings> =>
    goApp().SaveAppSettings(language, outlineAutoNumber, grammarCheckEnabled),
  saveImageAssetFromPath: (src: string): Promise<string> => goApp().SaveImageAssetFromPath(src),
  saveImageAssetFromData: (data: string, mime: string): Promise<string> => goApp().SaveImageAssetFromData(data, mime),
  imageDataURL: (path: string): Promise<string> => goApp().ImageDataURL(path),
  saveImageAs: (src: string): Promise<string> => goApp().SaveImageAs(src),
  cleanupUnusedImages: (openContents: string[]): Promise<void> => goApp().CleanupUnusedImages(openContents),
  addDictionaryWord: (word: string): Promise<Settings> => goApp().AddDictionaryWord(word),
  saveSyncSettings: (
    enabled: boolean,
    url: string,
    username: string,
    password: string,
    intervalMinutes: number,
  ): Promise<Settings> => goApp().SaveSyncSettings(enabled, url, username, password, intervalMinutes),
  testSyncConnection: (url: string, username: string, password: string): Promise<string> =>
    goApp().TestSyncConnection(url, username, password),
  syncNow: (): Promise<SyncResult> => goApp().SyncNow(),
  getSyncStatus: (): Promise<SyncStatus> => goApp().GetSyncStatus(),
  onSyncStatus: (handler: (status: SyncStatus) => void): void => {
    (window as any).runtime?.EventsOn?.("sync-status", handler);
  },
};
