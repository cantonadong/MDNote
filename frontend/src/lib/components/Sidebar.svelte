<script lang="ts">
  import RasterIcon from "./RasterIcon.svelte";
  import TreeNode from "./TreeNode.svelte";
  import NewEntryRow from "./NewEntryRow.svelte";
  import { appState, parentDir } from "$lib/appState.svelte";
  import { api, type FileEntry } from "$lib/api";
  import { t } from "$lib/i18n.svelte";

  let rootChildren = $state<FileEntry[] | null>(null);
  let collapsed = $state(false);

  function selectActiveTabDirectory() {
    const path = appState.activeTab?.path;
    if (path) appState.selectEntry(parentDir(path), true);
    else if (appState.effectiveRootDir) appState.selectEntry(appState.effectiveRootDir, true);
  }

  function openSidebar() {
    collapsed = false;
    selectActiveTabDirectory();
  }

  function closeSidebar(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    collapsed = true;
  }

  function reopenSidebar(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    openSidebar();
  }

  // Initial app restore is asynchronous. Once the foreground tab becomes
  // available, use its containing folder as the sidebar's default selection;
  // a later user selection is preserved.
  $effect(() => {
    const path = appState.activeTab?.path;
    if (!collapsed && !appState.selectedEntry && path) {
      appState.selectEntry(parentDir(path), true);
    }
  });

  async function loadRoot() {
    if (!appState.settings.rootDir) {
      rootChildren = null;
      return;
    }
    try {
      rootChildren = await api.listDir(appState.effectiveRootDir);
    } catch (e) {
      appState.showToast(`${t("toast.readRootFailed")}: ${e}`);
      rootChildren = [];
    }
  }

  $effect(() => {
    appState.settings.rootDir;
    appState.treeRefreshToken;
    loadRoot();
  });

  function newFile() {
    appState.beginCreateEntry(appState.targetDirForNewEntry(), false);
  }

  function newFolder() {
    appState.beginCreateEntry(appState.targetDirForNewEntry(), true);
  }

  function selectRoot() {
    appState.selectEntry(appState.effectiveRootDir, true);
  }

  // Only the directory the user picked is ever shown — the "MDNote"
  // subfolder underneath it (where files actually live) is an
  // implementation detail, not something worth cluttering the label with.
  let rootDirName = $derived(
    appState.settings.rootDir.split(/[\\/]/).filter(Boolean).pop() ?? appState.settings.rootDir,
  );

  function migrateRootDir(e: MouseEvent) {
    e.stopPropagation();
    void appState.migrateRootDir();
  }
</script>

<aside class="sidebar" class:collapsed>
  {#if collapsed}
    <button type="button" class="collapse-rail-btn" title="MDNote" aria-label="MDNote" onclick={reopenSidebar}>
      <RasterIcon name="right" size={16} />
    </button>
  {:else}
  <div class="sidebar-header">
    <span class="brand">MDNote</span>
    {#if appState.settings.rootDir}
      <div class="header-actions">
        <button type="button" class="collapse-btn" title="折叠侧栏" aria-label="折叠侧栏" onclick={closeSidebar}>
          <RasterIcon name="left" size={16} />
        </button>
        <button title={t("sidebar.newFile")} aria-label={t("sidebar.newFile")} onclick={newFile}
          ><RasterIcon name="new" size={17} /></button
        >
        <button title={t("sidebar.newFolder")} aria-label={t("sidebar.newFolder")} onclick={newFolder}
          ><RasterIcon name="new_folder" size={17} /></button
        >
        <button title={t("sidebar.migrate")} aria-label={t("sidebar.migrate")} onclick={migrateRootDir}
          ><RasterIcon name="transfer" size={17} /></button
        >
        <button title={t("sidebar.refresh")} aria-label={t("sidebar.refresh")} onclick={() => appState.refreshTree()}
          ><RasterIcon name="refresh" size={17} /></button
        >
      </div>
    {:else}
      <button type="button" class="collapse-btn" title="折叠侧栏" aria-label="折叠侧栏" onclick={closeSidebar}>
        <RasterIcon name="left" size={16} />
      </button>
    {/if}
  </div>

  {#if !appState.settings.rootDir}
    <div class="empty-state">
      <p>{t("sidebar.emptyRoot")}</p>
      <button class="primary-btn" onclick={() => appState.selectRootDir()}>{t("sidebar.selectRoot")}</button>
    </div>
  {:else}
    <div class="tree" data-tree-root="true" role="presentation">
      <div
        class="root-row"
        class:selected={appState.selectedEntry?.path === appState.effectiveRootDir}
        onclick={selectRoot}
        title={appState.settings.rootDir}
        role="presentation"
      >
        <span class="row-icon folder-icon"><RasterIcon name="folder" size={15} /></span>
        <span class="root-label">{rootDirName}</span>
      </div>
      {#if rootChildren === null}
        <div class="loading" style="padding-left:28px">{t("sidebar.loading")}</div>
      {:else}
        {#if appState.pendingNewEntry?.parentDir === appState.effectiveRootDir}
          <NewEntryRow depth={1} isDir={appState.pendingNewEntry.isDir} />
        {/if}
        {#if rootChildren.length === 0 && !appState.pendingNewEntry}
          <div class="loading" style="padding-left:28px">{t("sidebar.emptyFolder")}</div>
        {:else}
          {#each rootChildren as child (child.path)}
            <TreeNode entry={child} depth={1} />
          {/each}
        {/if}
      {/if}
      <div
        class="root-drop-line"
        class:visible={appState.dragOverTarget?.path === appState.effectiveRootDir}
      ></div>
    </div>
  {/if}

  <div class="sidebar-footer">
    <button
      class="footer-btn"
      class:active={appState.settingsActive}
      title={t("sidebar.settings")}
      aria-label={t("sidebar.settings")}
      onclick={() => appState.openSettings()}
    >
      <RasterIcon name="config" size={16} />
      <span>{t("sidebar.settings")}</span>
    </button>
    <button
      class="footer-btn"
      title={t("sidebar.sync")}
      aria-label={t("sidebar.sync")}
      disabled={!appState.settings.syncVerified || !appState.syncStatus.configured || appState.syncStatus.syncing}
      onclick={() => void appState.syncNow()}
    >
      <RasterIcon name="sync" size={16} />
      <span>{t("sidebar.sync")}</span>
    </button>
  </div>
  {/if}
</aside>

<style>
  .sidebar {
    position: relative;
    width: 240px;
    flex-shrink: 0;
    background: var(--sidebar-bg);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .sidebar.collapsed {
    width: 32px;
    cursor: pointer;
  }
  .collapse-rail-btn,
  .collapse-btn {
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    -webkit-app-region: no-drag !important;
  }
  .collapse-rail-btn {
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0;
    border-radius: 0;
  }
  .collapse-btn {
    width: 26px;
    height: 26px;
    border-radius: 4px;
    -webkit-app-region: no-drag;
    position: absolute;
    top: 4px;
    left: 3px;
    z-index: 20;
  }
  .collapse-rail-btn:hover,
  .collapse-btn:hover { background: var(--hover-bg); color: var(--text-primary); }
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 34px;
    padding: 0 8px 0 14px;
    flex-shrink: 0;
    -webkit-app-region: drag;
  }
  .brand {
    font-weight: 600;
    font-size: 13.5px;
    color: var(--text-primary);
    letter-spacing: 0.2px;
    margin-left: 28px;
  }
  .header-actions {
    display: flex;
    gap: 2px;
    -webkit-app-region: no-drag;
  }
  .header-actions button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 5px;
    cursor: pointer;
  }
  .header-actions button:hover {
    background: var(--hover-bg);
    color: var(--text-primary);
  }
  .empty-state {
    padding: 24px 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  .empty-state p {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
  }
  .primary-btn {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 5px;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .primary-btn:hover {
    opacity: 0.9;
  }
  .tree {
    flex: 1;
    overflow-y: auto;
    padding: 2px 8px 8px;
  }
  /* Dropping on blank space below the last item (or the root row itself)
     means "become a top-level item" — shown as a line at the very bottom of
     the list, the same visual language as a row's own before/after line. */
  .root-drop-line {
    height: 2px;
    margin-top: 2px;
    border-radius: 1px;
    background: transparent;
  }
  .root-drop-line.visible {
    background: var(--accent);
  }
  .loading {
    font-size: 12.5px;
    color: var(--text-secondary);
    padding: 6px 4px;
  }
  .root-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 8px;
    margin-bottom: 2px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .root-row:hover {
    background: var(--hover-bg);
  }
  .root-row.selected {
    background: var(--active-bg);
    box-shadow:
      inset 3px 0 0 0 var(--accent),
      0 1px 3px rgba(0, 0, 0, 0.12);
  }
  .row-icon {
    display: flex;
    align-items: center;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .row-icon.folder-icon {
    width: 18px;
    height: 18px;
    justify-content: center;
    border-radius: 4px;
    color: #b7791f;
    background: rgba(217, 155, 40, 0.14);
  }
  .root-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sidebar-footer {
    height: 34px;
    flex-shrink: 0;
    padding: 2px 4px;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 4px;
  }
  .footer-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex: 1 1 0;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 5px;
    height: 26px;
    padding: 0 6px;
    font-size: 12px;
    cursor: pointer;
  }
  .footer-btn:hover {
    background: var(--hover-bg);
    color: var(--text-primary);
  }
  .footer-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .footer-btn.active {
    background: var(--active-bg);
    color: var(--text-primary);
  }
</style>
