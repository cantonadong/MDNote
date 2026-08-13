import { api, type Settings, type SyncStatus, type UpdateStatus } from "./api";
import type { OutlineItem } from "./editor/outline";
import { editorBridge } from "./editor/bridge.svelte";
import { i18n, t, type LanguageSetting } from "./i18n.svelte";
import { buildExportHtml } from "./pdfExport";

export interface Tab {
  id: string;
  path: string | null; // null = untitled tab, never saved
  title: string;
  content: string; // live editor content (markdown)
  savedContent: string; // content as of last save/load, for dirty comparison
  missing: boolean; // backing file was deleted/moved outside the app
}

export interface PendingClose {
  tabId: string;
  missing?: boolean;
  // Remaining tab ids still waiting to be closed in a bulk close (close
  // others/left/right) — only one confirm dialog can be pending at a time,
  // so a batch works through this queue one tab per dialog resolution.
  queue?: string[];
}

export interface SelectedEntry {
  path: string;
  isDir: boolean;
}

export interface LinkPick {
  path: string;
  title: string;
  // Stable id for page/file link chips (see linkids.go) — unset for a plain
  // web link, which has no on-disk target to track.
  id?: string;
}

export function stripMdExt(name: string): string {
  return name.replace(/\.md$/i, "");
}

export function parentDir(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx === -1 ? path : path.slice(0, idx);
}

export interface DragOverTarget {
  path: string;
  position: "before" | "after" | "inside";
}

export interface DragGhost {
  label: string;
  isDir: boolean;
  x: number;
  y: number;
}

export interface PendingDelete {
  path: string;
  name: string;
  isDir: boolean;
}

export interface PendingNewEntry {
  parentDir: string;
  isDir: boolean;
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function isDefaultUntitledTitle(title: string): boolean {
  return title === t("tabs.untitled") || title === "未命名.md" || title === "Untitled.md";
}

function isImagePath(path: string): boolean {
  return /\.(apng|avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(path);
}

function isDirty(tab: Tab): boolean {
  return tab.content !== tab.savedContent;
}

class AppState {
  settings = $state<Settings>({
    rootDir: "",
    windowMaximized: false,
    openTabPaths: [],
    activeTabPath: "",
    language: "system",
    outlineAutoNumber: false,
    grammarCheckEnabled: false,
    customDictionary: [],
    syncEnabled: false,
    syncURL: "",
    syncUsername: "",
    syncPassword: "",
    syncIntervalMinutes: 30,
    syncVerified: false,
    lastSyncTime: "",
    lastSyncError: "",
  });
  // Live cloud-sync status for the status bar — seeded from GetSyncStatus
  // at startup, then kept current via the "sync-status" event the Go side
  // emits on every background-ticker or manual sync run (see sync.go).
  syncStatus = $state<SyncStatus>({
    enabled: false,
    configured: false,
    syncing: false,
    lastSyncTime: "",
    lastError: "",
    filesSynced: 0,
  });
  updateStatus = $state<UpdateStatus>({ ready: false, version: "" });
  // The settings page renders as its own pseudo-tab in the tab bar rather
  // than a file — settingsOpen is whether that tab exists at all,
  // settingsActive is whether it's the currently-focused one (vs a real
  // file tab in `tabs`). Kept separate from the Tab/tabs model entirely
  // since Tab's fields (path/content/savedContent/...) are all file-
  // specific and don't mean anything for a settings view.
  settingsOpen = $state(false);
  settingsActive = $state(false);
  tabs = $state<Tab[]>([]);
  activeTabId = $state<string | null>(null);
  pendingClose = $state<PendingClose | null>(null);
  pendingDelete = $state<PendingDelete | null>(null);
  toast = $state<string | null>(null);
  exportedPdfPath = $state<string | null>(null);
  findReplaceOpen = $state(false);
  // Which field FindReplace.svelte should focus, and a nonce that bumps on
  // every openFindReplace() call so the $effect there refires even when the
  // panel was already open and the target field didn't change (e.g. Ctrl+F
  // pressed twice in a row should reselect the query box's text, not no-op).
  findFocusReplacement = $state(false);
  findFocusNonce = $state(0);
  treeRefreshToken = $state(0);
  outlineItems = $state<OutlineItem[]>([]);
  wordCount = $state(0);
  selectedEntry = $state<SelectedEntry | null>(null);
  pendingNewEntry = $state<PendingNewEntry | null>(null);
  dragOverTarget = $state<DragOverTarget | null>(null);
  draggingPath = $state<string | null>(null);
  dragGhost = $state<DragGhost | null>(null);
  pendingExpandPath = $state<string | null>(null);
  private openTabsSaveQueue: Promise<void> = Promise.resolve();

  get activeTab(): Tab | null {
    return this.tabs.find((t) => t.id === this.activeTabId) ?? null;
  }

  // settings.rootDir is the directory the user *picked* — shown as-is in
  // the sidebar. Actual notes live in a fixed "MDNote" subfolder inside it
  // (see fsops.go's effectiveRoot), so every real file operation targets
  // this instead of settings.rootDir directly.
  get effectiveRootDir(): string {
    return this.settings.rootDir ? `${this.settings.rootDir}\\MDNote` : "";
  }

  isDirty(tab: Tab): boolean {
    return isDirty(tab);
  }

  async init() {
    this.settings = await api.getSettings();
    i18n.setLanguage((this.settings.language as LanguageSetting) || "system");
    const initialFile = await api.getInitialFile();
    this.syncStatus = await api.getSyncStatus();
    api.onSyncStatus((status) => {
      this.syncStatus = status;
    });
    this.updateStatus = await api.getUpdateStatus();
    api.onUpdateStatus((status) => {
      this.updateStatus = status;
    });

    // Restore whatever was open last session — silently skipping any file
    // that's since been deleted/moved rather than surfacing an error toast
    // for something the user didn't just do themselves.
    for (const p of this.settings.openTabPaths ?? []) {
      if (!(await api.fileExists(p))) continue;
      // Do not overwrite the saved foreground tab while the session is only
      // partially restored. Persist the complete, correctly-focused session
      // once all paths have been reopened below.
      await this.openPath(p, { silent: true, persist: false });
    }

    if (initialFile) {
      // A double-clicked/associated file just launched this process — that
      // takes priority as the focused tab over whatever was last active.
      await this.openPath(initialFile);
    } else if (this.settings.activeTabPath) {
      const restored = this.findTabByPath(this.settings.activeTabPath);
      if (restored) this.activeTabId = restored.id;
    }

    if (this.tabs.length === 0) this.newTab();
    else this.persistOpenTabs();

    // While this instance keeps running, later double-clicked .md files get
    // forwarded here (see singleinstance.go) instead of opening a second window.
    api.onOpenFile((path) => {
      void this.openPath(path);
    });
    // Dragging .md/.txt file(s) from Explorer onto the window opens each as
    // a tab instead of WebView2's default "navigate to file://" behavior —
    // landing right after whatever tab is currently active (and switching
    // to it) rather than tacked onto the far end of the tab strip, since a
    // drop is a deliberate "open this next to what I'm looking at" gesture.
    api.onFileDrop((paths, coords) => {
      const imagePaths = paths.filter(isImagePath);
      if (imagePaths.length > 0) {
        editorBridge.insertImagesFromPaths?.(imagePaths, coords);
      }
      for (const p of paths) {
        if (/\.(md|txt)$/i.test(p)) void this.openPath(p, { insertAfterActive: true });
      }
    });
  }

  showToast(message: string) {
    this.toast = message;
    setTimeout(() => {
      if (this.toast === message) this.toast = null;
    }, 3000);
  }

  hideExportedPdf() {
    this.exportedPdfPath = null;
  }

  refreshTree() {
    this.treeRefreshToken++;
  }

  async selectRootDir() {
    this.settings = await api.selectRootDir();
    this.selectedEntry = null;
    this.refreshTree();
  }

  async migrateRootDir() {
    const oldRoot = this.effectiveRootDir;
    try {
      this.settings = await api.migrateRootDir();
      const newRoot = this.effectiveRootDir;
      // Every open tab's file physically moved along with the rest of the
      // MDNote folder — remap each affected path the same way rename/move
      // elsewhere in the tree already do, instead of leaving tabs pointing
      // at a location that no longer exists.
      if (oldRoot && newRoot && oldRoot !== newRoot) {
        for (const t of this.tabs) {
          if (t.path && (t.path === oldRoot || t.path.startsWith(oldRoot + "\\"))) {
            t.path = newRoot + t.path.slice(oldRoot.length);
          }
        }
      }
      this.selectedEntry = null;
      this.refreshTree();
      this.persistOpenTabs();
    } catch (e) {
      this.showToast(`${t("toast.migrateFailed")}: ${e}`);
    }
  }

  selectEntry(path: string, isDir: boolean) {
    this.selectedEntry = { path, isDir };
  }

  // Directory that "新建文件/文件夹" (and the save-as dialog's default
  // location) should target: the selected directory, the parent of a
  // selected file, or the root if nothing is selected.
  targetDirForNewEntry(): string {
    if (this.selectedEntry) {
      return this.selectedEntry.isDir ? this.selectedEntry.path : parentDir(this.selectedEntry.path);
    }
    return this.effectiveRootDir;
  }

  openFindReplace(focusReplacement = false) {
    this.findReplaceOpen = true;
    this.findFocusReplacement = focusReplacement;
    this.findFocusNonce++;
  }

  newTab() {
    const tab: Tab = {
      id: makeId(),
      path: null,
      title: t("tabs.untitled"),
      content: "",
      savedContent: "",
      missing: false,
    };
    this.tabs.push(tab);
    this.activeTabId = tab.id;
    this.persistOpenTabs();
    return tab;
  }

  findTabByPath(path: string): Tab | undefined {
    return this.tabs.find((t) => t.path === path);
  }

  // A brand-new, still-blank, never-renamed tab — the one newTab()/startup
  // creates and the user hasn't touched yet. Opening a real file while this
  // is the active tab should replace it rather than leaving it sitting
  // around as clutter alongside the newly opened one.
  private isPristineTab(tab: Tab | null): boolean {
    return !!tab && tab.path === null && tab.content === "" && isDefaultUntitledTitle(tab.title);
  }

  // Persists which files are currently open (and which is active) so the
  // next launch can restore them — see settings.go's SaveOpenTabs. Called
  // after every tab open/close/switch rather than only at shutdown, so a
  // crash doesn't lose the last-known state. Untitled tabs have no path and
  // are simply left out — there's nothing on disk to reopen them from.
  persistOpenTabs() {
    const paths = this.tabs.map((t) => t.path).filter((p): p is string => !!p);
    const activePath = this.activeTab?.path ?? "";
    // Wails calls are asynchronous. Serialize snapshots so an older save can
    // never finish after a newer reorder/activation and overwrite it on disk.
    this.openTabsSaveQueue = this.openTabsSaveQueue
      .catch(() => {})
      .then(() => api.saveOpenTabs(paths, activePath));
  }

  // silent: used when restoring last session's tabs on startup — a file
  // that's since been deleted/moved shouldn't interrupt startup with an
  // error toast, it should just be skipped (see appState.init()). A
  // deliberate open elsewhere (sidebar click, Open dialog, a link jump)
  // still surfaces the normal failure toast.
  // insertAfterActive: places the new tab immediately to the right of
  // whatever's currently active instead of at the far end of the tab strip
  // — used for the drag-and-drop-from-Explorer path, where "open this next
  // to what I'm looking at" is the more deliberate, expected placement than
  // wherever the tab strip happens to end.
  async openPath(path: string, opts: { silent?: boolean; insertAfterActive?: boolean; persist?: boolean } = {}) {
    const existing = this.findTabByPath(path);
    if (existing) {
      this.activeTabId = existing.id;
      if (opts.persist !== false) this.persistOpenTabs();
      return;
    }
    const staleTabId = this.isPristineTab(this.activeTab) ? this.activeTab!.id : null;
    try {
      const content = await api.readFile(path);
      const name = await api.basename(path);
      const tab: Tab = {
        id: makeId(),
        path,
        title: name,
        content,
        savedContent: content,
        missing: false,
      };
      if (opts.insertAfterActive) {
        const activeIdx = this.tabs.findIndex((t) => t.id === this.activeTabId);
        this.tabs.splice(activeIdx === -1 ? this.tabs.length : activeIdx + 1, 0, tab);
      } else {
        this.tabs.push(tab);
      }
      this.activeTabId = tab.id;
      if (staleTabId) this.closeTabImmediately(staleTabId);
      if (opts.persist !== false) this.persistOpenTabs();
    } catch (e) {
      if (!opts.silent) this.showToast(`${t("toast.openFailed")}: ${e}`);
    }
  }

  async openViaDialog() {
    try {
      const path = await api.openFileDialog(this.targetDirForNewEntry());
      if (path) await this.openPath(path);
    } catch (e) {
      this.showToast(`${t("toast.openFailed")}: ${e}`);
    }
  }

  updateActiveContent(content: string) {
    const tab = this.activeTab;
    if (tab) tab.content = content;
  }

  private flushActiveEditorContent() {
    const tab = this.activeTab;
    const editor = editorBridge.instance;
    if (!tab || !editor) return;
    tab.content = (editor.storage as any).markdown.getMarkdown();
  }

  // Checked when a tab becomes active and right before it's closed, so a
  // stale tab pointing at a file someone deleted/moved outside the app
  // gets flagged instead of silently resurrecting or losing content.
  async checkMissing(tab: Tab) {
    if (!tab.path) {
      tab.missing = false;
      return;
    }
    tab.missing = !(await api.fileExists(tab.path));
  }

  async saveTab(tab: Tab): Promise<boolean> {
    if (tab.id === this.activeTabId) this.flushActiveEditorContent();
    if (!tab.path) {
      return this.saveTabAs(tab);
    }
    try {
      await api.writeFile(tab.path, tab.content);
      tab.savedContent = tab.content;
      return true;
    } catch (e) {
      this.showToast(`${t("toast.saveFailed")}: ${e}`);
      return false;
    }
  }

  async saveTabAs(tab: Tab): Promise<boolean> {
    if (tab.id === this.activeTabId) this.flushActiveEditorContent();
    try {
      const path = await api.saveFileDialog(stripMdExt(tab.title), this.targetDirForNewEntry());
      if (!path) return false;
      await api.writeFile(path, tab.content);
      tab.path = path;
      tab.title = await api.basename(path);
      tab.savedContent = tab.content;
      tab.missing = false;
      this.refreshTree();
      return true;
    } catch (e) {
      this.showToast(`${t("toast.saveAsFailed")}: ${e}`);
      return false;
    }
  }

  async saveActiveTab() {
    this.flushActiveEditorContent();
    if (this.activeTab) await this.saveTab(this.activeTab);
  }

  async saveActiveTabAs() {
    this.flushActiveEditorContent();
    if (this.activeTab) await this.saveTabAs(this.activeTab);
  }

  // Silent "另存为PDF": picks a save path, then renders straight to a PDF via
  // a throwaway hidden WebView2 instance on the Go side — never opens a
  // print preview/print dialog. Distinct from the "打印" toolbar button,
  // which still uses window.print() so the user can pick their own printer.
  async exportActiveTabAsPdf() {
    const tab = this.activeTab;
    if (!tab) return;
    try {
      const path = await api.savePdfDialog(`${stripMdExt(tab.title)}.pdf`, this.targetDirForNewEntry());
      if (!path) return;
      const pdfName = await api.basename(path);
      const html = buildExportHtml(pdfName);
      if (!html) return;
      await api.exportPdf(html, path);
      this.exportedPdfPath = path;
    } catch (e) {
      this.showToast(`${t("toast.exportPdfFailed")}: ${e}`);
    }
  }

  async requestCloseTab(tabId: string) {
    await this.requestCloseTabs([tabId]);
  }

  // Closes tabs one at a time, in order; a dirty/missing tab pauses the
  // batch on pendingClose (same single-dialog flow as a lone close) and
  // resolvePendingClose picks the queue back up once the user answers.
  async requestCloseTabs(tabIds: string[]) {
    const [tabId, ...queue] = tabIds;
    if (tabId === undefined) return;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) {
      await this.requestCloseTabs(queue);
      return;
    }
    if (tab.id === this.activeTabId) this.flushActiveEditorContent();
    await this.checkMissing(tab);
    if (tab.missing) {
      this.pendingClose = { tabId, missing: true, queue };
    } else if (isDirty(tab)) {
      this.pendingClose = { tabId, queue };
    } else {
      this.closeTabImmediately(tabId);
      await this.requestCloseTabs(queue);
    }
  }

  closeOtherTabs(keepId: string) {
    void this.requestCloseTabs(this.tabs.filter((t) => t.id !== keepId).map((t) => t.id));
  }

  closeTabsToSide(tabId: string, side: "left" | "right") {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const ids = (side === "left" ? this.tabs.slice(0, idx) : this.tabs.slice(idx + 1)).map((t) => t.id);
    void this.requestCloseTabs(ids);
  }

  reorderTab(fromId: string, toId: string) {
    if (fromId === toId) return;
    const fromIdx = this.tabs.findIndex((t) => t.id === fromId);
    const toIdx = this.tabs.findIndex((t) => t.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = this.tabs.splice(fromIdx, 1);
    // Dropping onto a tab always means "land just before it" (matches the
    // left-edge insertion line the drag-over highlight draws). Removing the
    // source first shifts every later index down by one — so when the
    // target was to the right of the source, its own index shifted too and
    // has to be corrected, or the moved tab lands one slot past the target
    // (after it, not before) instead of where the indicator pointed.
    const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
    this.tabs.splice(insertIdx, 0, moved);
    this.persistOpenTabs();
  }

  // Dropping past the last tab (empty space to the right of it, with no
  // "next tab" element to fire a dragover/drop on) has no target for
  // reorderTab to swap against, so it's a separate append-at-end move.
  moveTabToEnd(fromId: string) {
    const fromIdx = this.tabs.findIndex((t) => t.id === fromId);
    if (fromIdx === -1 || fromIdx === this.tabs.length - 1) return;
    const [moved] = this.tabs.splice(fromIdx, 1);
    this.tabs.push(moved);
    this.persistOpenTabs();
  }

  closeTabImmediately(tabId: string) {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    this.tabs.splice(idx, 1);
    if (this.activeTabId === tabId) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1] ?? null;
      this.activeTabId = next?.id ?? null;
    }
    if (this.tabs.length === 0) this.newTab();
    else this.persistOpenTabs();
    void api.cleanupUnusedImages(this.tabs.map((t) => t.content)).catch(() => {});
  }

  async resolvePendingClose(choice: "save" | "discard" | "cancel") {
    const pending = this.pendingClose;
    this.pendingClose = null;
    if (!pending) return;
    // Cancel aborts the whole batch, not just this one tab — continuing to
    // close the rest after the user explicitly said "stop" would surprise
    // them more than leaving the remaining tabs open.
    if (choice === "cancel") return;
    const tab = this.tabs.find((t) => t.id === pending.tabId);
    if (tab) {
      if (choice === "save") {
        // A missing-file tab always goes through "另存为": its old path may
        // no longer be a place the user wants to recreate the file at.
        const ok = pending.missing ? await this.saveTabAs(tab) : await this.saveTab(tab);
        if (!ok) return;
      }
      this.closeTabImmediately(pending.tabId);
    }
    if (pending.queue?.length) await this.requestCloseTabs(pending.queue);
  }

  // -- Slash-menu / block-handle async helpers (file link / new page) --

  async pickFileLink(): Promise<LinkPick | null> {
    try {
      const path = await api.openAnyFileDialog();
      if (!path) return null;
      const name = await api.basename(path);
      const id = await api.ensureLinkID(path).catch(() => undefined);
      return { path, title: name, id };
    } catch (e) {
      this.showToast(`${t("toast.pickFailed")}: ${e}`);
      return null;
    }
  }

  // Resolved by WebLinkDialog.svelte, which renders whenever this is set —
  // see pickWebLink/resolveWebLink/cancelWebLink/unlinkWebLink.
  // initialUrl/initialText are non-empty when this is editing an existing
  // link (right-click on one) rather than inserting a new one — only then
  // does the dialog offer "convert to plain text", which resolves with the
  // distinct { unlink: true } shape rather than a LinkPick so the caller
  // (links.ts) can tell "remove this link" apart from "replace it with a
  // new one" instead of both just being "some LinkPick".
  pendingWebLink = $state<{
    resolve: (v: LinkPick | { unlink: true } | null) => void;
    initialUrl: string;
    initialText: string;
  } | null>(null);

  pickWebLink(initial?: { url: string; text: string }): Promise<LinkPick | { unlink: true } | null> {
    return new Promise((resolve) => {
      this.pendingWebLink = { resolve, initialUrl: initial?.url ?? "", initialText: initial?.text ?? "" };
    });
  }

  resolveWebLink(url: string, text: string) {
    const pending = this.pendingWebLink;
    this.pendingWebLink = null;
    if (!pending) return;
    const trimmed = url.trim();
    if (!trimmed) {
      pending.resolve(null);
      return;
    }
    const normalized = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    pending.resolve({ path: normalized, title: text.trim() || normalized });
  }

  cancelWebLink() {
    const pending = this.pendingWebLink;
    this.pendingWebLink = null;
    pending?.resolve(null);
  }

  unlinkWebLink() {
    const pending = this.pendingWebLink;
    this.pendingWebLink = null;
    pending?.resolve({ unlink: true });
  }

  async createNewPageNear(nearPath: string | null): Promise<LinkPick | null> {
    if (!this.settings.rootDir) {
      this.showToast(t("toast.selectRootFirst"));
      return null;
    }
    const dir = nearPath ? parentDir(nearPath) : this.targetDirForNewEntry();
    // No naming prompt: auto-picks the localized untitled filename, or adds
    // a number if that's already taken. Doesn't open it — the caller inserts a
    // pageLink chip pointing at it in the *current* document; opening the
    // new (still-empty) file would yank focus away from what the user was
    // actually doing. They can click the chip when they're ready to edit it.
    try {
      let entry = null;
      const baseName = stripMdExt(t("tabs.untitled"));
      for (let n = 1; n <= 999; n++) {
        const name = n === 1 ? `${baseName}.md` : `${baseName} ${n}.md`;
        try {
          entry = await api.createEntry(dir, name, false);
          break;
        } catch (e) {
          if (n === 999) throw e;
        }
      }
      if (!entry) return null;
      this.refreshTree();
      const id = await api.ensureLinkID(entry.path).catch(() => undefined);
      return { path: entry.path, title: stripMdExt(entry.name), id };
    } catch (e) {
      this.showToast(`${t("toast.newPageFailed")}: ${e}`);
      return null;
    }
  }

  async createEntry(parentDir: string, name: string, isDir: boolean) {
    try {
      await api.createEntry(parentDir, name, isDir);
      this.refreshTree();
    } catch (e) {
      this.showToast(`${t("toast.createFailed")}: ${e}`);
    }
  }

  // Inline create flow (replaces the old window.prompt-based one): the tree
  // renders an empty, focused name field in place under parentDir; nothing
  // is written to disk until the user commits a non-empty name.
  beginCreateEntry(parentDir: string, isDir: boolean) {
    this.pendingNewEntry = { parentDir, isDir };
  }

  cancelCreateEntry() {
    this.pendingNewEntry = null;
  }

  async commitCreateEntry(rawName: string) {
    const pending = this.pendingNewEntry;
    this.pendingNewEntry = null;
    if (!pending) return;
    const trimmed = rawName.trim();
    if (!trimmed) return;
    const name = pending.isDir || /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
    await this.createEntry(pending.parentDir, name, pending.isDir);
  }

  // Page-link/file-link chips store a `path` attr (see links.ts — the
  // displayed label is derived from it, not stored separately), which goes
  // stale/broken the moment the target gets renamed or moved unless
  // something rewrites every chip that pointed at the old path. Called
  // after a successful rename/move with the old/new path pair; also
  // correctly handles a *folder* rename/move cascading to every descendant
  // file's chips, since `oldPath + "\\"` as a prefix match covers that case
  // the same way the existing tab-path-rewrite loops above it already do.
  private syncLinkReferences(oldPath: string, newPath: string) {
    const matches = (p: string) => p === oldPath || p.startsWith(oldPath + "\\");
    const remap = (p: string) => (p === oldPath ? newPath : newPath + p.slice(oldPath.length));
    for (const t of this.tabs) {
      if (t.id === this.activeTabId && editorBridge.instance) {
        // Live document — rewrite via a transaction so the visible chip(s)
        // update immediately; tab.content resyncs shortly after through the
        // editor's normal onUpdate → scheduleSync path.
        const editor = editorBridge.instance;
        let tr = editor.state.tr;
        let changed = false;
        editor.state.doc.descendants((node, pos) => {
          if (
            (node.type.name === "pageLink" || node.type.name === "fileLink") &&
            typeof node.attrs.path === "string" &&
            matches(node.attrs.path)
          ) {
            tr = tr.setNodeAttribute(pos, "path", remap(node.attrs.path));
            changed = true;
          }
        });
        if (changed) editor.view.dispatch(tr);
        continue;
      }
      // Inactive tab: only its markdown string is in memory. The chip
      // round-trips as a quoted `data-path="..."` HTML attribute (see
      // links.ts), so anchoring the replacement to that exact quoted form
      // (rather than a bare oldPath substring anywhere in the text) avoids
      // false hits on some unrelated path that merely shares oldPath as a
      // text prefix.
      if (!t.content.includes(oldPath)) continue;
      let updated = t.content
        .split(`data-path="${oldPath}"`)
        .join(`data-path="${newPath}"`);
      updated = updated.split(`data-path="${oldPath}\\`).join(`data-path="${newPath}\\`);
      if (updated === t.content) continue;
      t.content = updated;
      // Not an edit the user made — write it straight through rather than
      // leaving the tab looking dirty for a change they didn't type.
      if (t.path) {
        api
          .writeFile(t.path, updated)
          .then(() => {
            t.savedContent = updated;
          })
          .catch(() => {
            /* best effort — in-memory content is still corrected either way */
          });
      } else {
        t.savedContent = updated;
      }
    }
  }

  async renameEntry(path: string, newName: string) {
    try {
      const newPath = await api.renameEntry(path, newName);
      for (const t of this.tabs) {
        if (t.path === path) {
          t.path = newPath;
          t.title = newName;
        } else if (t.path && t.path.startsWith(path + "\\")) {
          t.path = newPath + t.path.slice(path.length);
        }
      }
      if (this.selectedEntry?.path === path) {
        this.selectedEntry = { ...this.selectedEntry, path: newPath };
      }
      this.syncLinkReferences(path, newPath);
      this.refreshTree();
      this.persistOpenTabs();
    } catch (e) {
      this.showToast(`${t("toast.renameFailed")}: ${e}`);
    }
  }

  async moveEntry(srcPath: string, destDir: string) {
    try {
      const newPath = await api.moveEntry(srcPath, destDir);
      for (const t of this.tabs) {
        if (t.path === srcPath) {
          t.path = newPath;
        } else if (t.path && t.path.startsWith(srcPath + "\\")) {
          t.path = newPath + t.path.slice(srcPath.length);
        }
      }
      if (this.selectedEntry?.path === srcPath) {
        this.selectedEntry = { ...this.selectedEntry, path: newPath };
      }
      this.syncLinkReferences(srcPath, newPath);
      this.refreshTree();
      this.persistOpenTabs();
    } catch (e) {
      // Backend rejects a drop that resolves to the item's current directory
      // with this exact message — a benign no-op (the drag guard in
      // dragController.ts filters most of these client-side already, but
      // path-normalization edge cases can still slip one through), not a
      // failure worth alarming the user about.
      if (String(e).includes("already in target directory")) return;
      this.showToast(`${t("toast.moveFailed")}: ${e}`);
    }
  }

  requestDelete(path: string, name: string, isDir: boolean) {
    this.pendingDelete = { path, name, isDir };
  }

  async resolvePendingDelete(confirm: boolean) {
    const pending = this.pendingDelete;
    this.pendingDelete = null;
    if (!pending || !confirm) return;
    try {
      await api.deleteEntry(pending.path);
      for (const t of [...this.tabs]) {
        if (t.path === pending.path || (pending.isDir && t.path?.startsWith(pending.path + "\\"))) {
          this.closeTabImmediately(t.id);
        }
      }
      if (
        this.selectedEntry?.path === pending.path ||
        (pending.isDir && this.selectedEntry?.path.startsWith(pending.path + "\\"))
      ) {
        this.selectedEntry = null;
      }
      this.refreshTree();
    } catch (e) {
      this.showToast(`${t("toast.deleteFailed")}: ${e}`);
    }
  }

  // -- Settings pseudo-tab --

  openSettings() {
    this.settingsOpen = true;
    this.settingsActive = true;
  }

  closeSettings() {
    this.settingsOpen = false;
    this.settingsActive = false;
  }

  // Switching to a real file tab while the settings tab exists just
  // defocuses it (leaves it open in the tab bar) rather than closing it —
  // same "still there, just not looking at it" behavior as any other
  // inactive tab.
  activateTab(tabId: string) {
    this.activeTabId = tabId;
    this.settingsActive = false;
    this.persistOpenTabs();
  }

  async saveAppSettings(language: LanguageSetting, outlineAutoNumber: boolean, grammarCheckEnabled: boolean) {
    try {
      this.settings = await api.saveAppSettings(language, outlineAutoNumber, grammarCheckEnabled);
      i18n.setLanguage(language);
    } catch (e) {
      this.showToast(`${t("toast.saveSettingsFailed")}: ${e}`);
    }
  }

  async addDictionaryWord(word: string) {
    try {
      this.settings = await api.addDictionaryWord(word);
    } catch (e) {
      this.showToast(`${t("toast.saveSettingsFailed")}: ${e}`);
    }
  }

  async saveSyncSettings(
    enabled: boolean,
    url: string,
    username: string,
    password: string,
    intervalMinutes: number,
    verified: boolean,
  ): Promise<boolean> {
    try {
      this.settings = await api.saveSyncSettings(enabled, url, username, password, intervalMinutes, verified);
      this.syncStatus = await api.getSyncStatus();
      return true;
    } catch (e) {
      this.showToast(`${t("toast.saveSettingsFailed")}: ${e}`);
      return false;
    }
  }

  // Runs a sync immediately (the settings panel's "立即同步" button) and
  // shows its outcome as a toast — syncStatus itself updates separately via
  // the "sync-status" event this also triggers, so the status bar reflects
  // it too without needing this call's result.
  async syncNow() {
    try {
      const result = await api.syncNow();
      this.showToast(result.success ? t("settings.sync.syncSuccess") : `${t("settings.sync.syncFailed")}: ${result.message}`);
      return result;
    } catch (e) {
      this.showToast(`${t("settings.sync.syncFailed")}: ${e}`);
      return null;
    }
  }

  dismissUpdate() {
    this.updateStatus = { ready: false, version: "" };
  }

  async applyUpdate() {
    if (this.tabs.some((tab) => isDirty(tab))) {
      this.showToast(t("update.saveFirst"));
      return;
    }
    try {
      await api.applyUpdate();
    } catch (e) {
      this.showToast(`${t("update.failed")}: ${e}`);
    }
  }
}

export const appState = new AppState();
