<script lang="ts">
  import Icon from "./Icon.svelte";
  import TreeNode from "./TreeNode.svelte";
  import NewEntryRow from "./NewEntryRow.svelte";
  import { appState } from "$lib/appState.svelte";
  import { api, type FileEntry } from "$lib/api";

  let rootChildren = $state<FileEntry[] | null>(null);

  async function loadRoot() {
    if (!appState.settings.rootDir) {
      rootChildren = null;
      return;
    }
    try {
      rootChildren = await api.listDir(appState.effectiveRootDir);
    } catch (e) {
      appState.showToast(`读取根目录失败: ${e}`);
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

  function changeRootDir(e: MouseEvent) {
    e.stopPropagation();
    void appState.selectRootDir();
  }

  function migrateRootDir(e: MouseEvent) {
    e.stopPropagation();
    void appState.migrateRootDir();
  }
</script>

<aside class="sidebar">
  <div class="sidebar-header">
    <span class="brand">MDNote</span>
    {#if appState.settings.rootDir}
      <div class="header-actions">
        <button title="新建文件" aria-label="新建文件" onclick={newFile}><Icon name="file-plus" size={14} /></button>
        <button title="新建文件夹" aria-label="新建文件夹" onclick={newFolder}><Icon name="folder-plus" size={14} /></button>
        <button title="刷新" aria-label="刷新" onclick={() => appState.refreshTree()}><Icon name="refresh" size={14} /></button>
      </div>
    {/if}
  </div>

  {#if !appState.settings.rootDir}
    <div class="empty-state">
      <p>还没有选择笔记目录</p>
      <button class="primary-btn" onclick={() => appState.selectRootDir()}>选择根目录</button>
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
        <span class="row-icon"><Icon name="folder" size={14} /></span>
        <span class="root-label">{rootDirName}</span>
        <button class="root-change-btn" title="迁移到其他位置" aria-label="迁移到其他位置" onclick={migrateRootDir}>
          <Icon name="move" size={12} />
        </button>
        <button class="root-change-btn" title="更换根目录" aria-label="更换根目录" onclick={changeRootDir}>
          <Icon name="refresh" size={12} />
        </button>
      </div>
      {#if rootChildren === null}
        <div class="loading" style="padding-left:28px">加载中…</div>
      {:else}
        {#if appState.pendingNewEntry?.parentDir === appState.effectiveRootDir}
          <NewEntryRow depth={1} isDir={appState.pendingNewEntry.isDir} />
        {/if}
        {#if rootChildren.length === 0 && !appState.pendingNewEntry}
          <div class="loading" style="padding-left:28px">空文件夹，右键或使用上方按钮新建</div>
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
</aside>

<style>
  .sidebar {
    width: 260px;
    flex-shrink: 0;
    background: var(--sidebar-bg);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 40px;
    padding: 0 8px 0 14px;
    flex-shrink: 0;
    -webkit-app-region: drag;
  }
  .brand {
    font-weight: 600;
    font-size: 13.5px;
    color: var(--text-primary);
    letter-spacing: 0.2px;
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
    width: 24px;
    height: 24px;
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
  .root-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .root-change-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
  }
  .root-row:hover .root-change-btn {
    opacity: 1;
  }
  .root-change-btn:hover {
    background: var(--hover-bg-strong);
    color: var(--text-primary);
  }
</style>
