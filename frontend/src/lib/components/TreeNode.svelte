<script lang="ts">
  import Icon from "./Icon.svelte";
  import TreeNode from "./TreeNode.svelte";
  import NewEntryRow from "./NewEntryRow.svelte";
  import { appState, stripMdExt } from "$lib/appState.svelte";
  import { api, type FileEntry } from "$lib/api";
  import { startRowDrag } from "$lib/dragController";
  import { t } from "$lib/i18n.svelte";

  let { entry, depth = 0 }: { entry: FileEntry; depth?: number } = $props();

  let expanded = $state(false);
  let children = $state<FileEntry[] | null>(null);
  let renaming = $state(false);
  let renameValue = $state("");
  let menuOpen = $state(false);
  let menuPos = $state({ x: 0, y: 0 });

  function focusRenameInput(node: HTMLInputElement) {
    queueMicrotask(() => {
      node.focus();
      node.select();
    });
  }

  // silent is set for the background refresh below: any tree mutation bumps
  // treeRefreshToken globally, which re-triggers this for every expanded
  // node — including, briefly, the node that just got dragged elsewhere.
  // Its own entry.path is stale at that instant (Svelte hasn't unmounted it
  // yet, since that only happens once the parent's own listing reloads and
  // re-renders), so listDir(entry.path) genuinely 404s — an expected,
  // harmless race, not something the user needs an error toast about. A
  // real user-initiated expand (toggle()) still surfaces genuine failures.
  async function loadChildren(silent = false) {
    try {
      children = await api.listDir(entry.path);
    } catch (e) {
      if (!silent) appState.showToast(`${t("tree.readDirFailed")}: ${e}`);
      children = [];
    }
  }

  $effect(() => {
    appState.treeRefreshToken;
    if (expanded) loadChildren(true);
  });

  // A "new file/folder" started here (toolbar with this dir selected, or
  // this node's own context menu) must be visible, so force this node open.
  $effect(() => {
    if (entry.isDir && appState.pendingNewEntry?.parentDir === entry.path && !expanded) {
      void toggle();
    }
  });

  // A drag-drop that just moved something into this folder should reveal it.
  $effect(() => {
    if (entry.isDir && appState.pendingExpandPath === entry.path && !expanded) {
      void toggle();
    }
  });

  async function toggle() {
    if (!entry.isDir) return;
    if (!expanded) {
      if (children === null) await loadChildren();
      expanded = true;
    } else {
      expanded = false;
    }
  }

  function onChevronClick(e: MouseEvent) {
    e.stopPropagation();
    appState.selectEntry(entry.path, entry.isDir);
    toggle();
  }

  function onRowClick(e: MouseEvent) {
    e.stopPropagation();
    appState.selectEntry(entry.path, entry.isDir);
    if (entry.isDir) {
      toggle();
    } else {
      appState.openPath(entry.path);
    }
  }

  function onRowDblClick(e: MouseEvent) {
    e.stopPropagation();
    startRename();
  }

  function openMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    menuPos = { x: e.clientX, y: e.clientY };
    menuOpen = true;
  }

  function closeMenu() {
    menuOpen = false;
  }

  function newFile() {
    closeMenu();
    appState.beginCreateEntry(entry.path, false);
  }

  function newFolder() {
    closeMenu();
    appState.beginCreateEntry(entry.path, true);
  }

  function startRename() {
    closeMenu();
    // Files edit as just the base name (the .md suffix is implicit and
    // re-appended on commit, same as the tab-rename input) — folders have no
    // extension to hide.
    renameValue = entry.isDir ? entry.name : stripMdExt(entry.name);
    renaming = true;
  }

  async function commitRename() {
    // Enter calls this directly; setting renaming = false then removes the
    // <input> from the DOM, which — since it's still focused — fires a
    // native blur event that invokes this same handler a second time. By
    // then entry.path/name are still the old values (the parent hasn't
    // re-rendered with the renamed entry yet), so the guard below would
    // pass and a second RenameEntry call would fire against the now-already-
    // renamed source path, failing with a spurious error toast right after
    // a rename that actually succeeded. Bail out on the re-entrant call.
    if (!renaming) return;
    renaming = false;
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    const newName = entry.isDir || /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
    if (newName === entry.name) return;
    await appState.renameEntry(entry.path, newName);
  }

  function cancelRename() {
    renaming = false;
  }

  function doDelete() {
    closeMenu();
    appState.requestDelete(entry.path, entry.name, entry.isDir);
  }

  async function revealInExplorer() {
    closeMenu();
    try {
      await api.revealInExplorer(entry.path);
    } catch (e) {
      appState.showToast(`${t("toast.revealFailed")}: ${e}`);
    }
  }

  // Reordering/moving a row is driven by plain pointer events rather than
  // native HTML5 Drag and Drop (see dragController.ts for why). pointerdown
  // just hands off to the shared controller, which hit-tests and reports
  // back through appState.dragOverTarget the same way the old dragover
  // handler did, so the CSS below keeps working unchanged.
  function onPointerDown(e: PointerEvent) {
    if (renaming) return;
    const label = entry.isDir ? entry.name : entry.name.replace(/\.md$/i, "");
    startRowDrag(entry.path, entry.isDir, label, e);
  }
</script>

<svelte:window onclick={menuOpen ? closeMenu : undefined} />

<div class="node">
  <div
    class="row"
    class:selected={appState.selectedEntry?.path === entry.path}
    class:dragging={appState.draggingPath === entry.path}
    class:drag-inside={appState.dragOverTarget?.path === entry.path &&
      appState.dragOverTarget.position === "inside"}
    class:drag-before={appState.dragOverTarget?.path === entry.path && appState.dragOverTarget.position === "before"}
    class:drag-after={appState.dragOverTarget?.path === entry.path && appState.dragOverTarget.position === "after"}
    style={`padding-left:${8 + depth * 16}px; --indent:${8 + depth * 16}px`}
    data-tree-row={entry.path}
    data-tree-dir={entry.isDir}
    onpointerdown={onPointerDown}
    onclick={onRowClick}
    ondblclick={onRowDblClick}
    oncontextmenu={openMenu}
    role="presentation"
  >
    {#if entry.isDir}
      <span class="chevron" onclick={onChevronClick} role="presentation">
        <Icon name={expanded ? "chevron-down" : "chevron-right"} size={13} />
      </span>
    {:else}
      <span class="chevron-spacer"></span>
    {/if}
    <span class="row-icon"><Icon name={entry.isDir ? "folder" : "file"} size={14} /></span>
    {#if renaming}
      <input
        class="rename-input"
        bind:value={renameValue}
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") cancelRename();
        }}
        onblur={commitRename}
        use:focusRenameInput
      />
    {:else}
      <span class="row-label">
        {entry.isDir ? entry.name : entry.name.replace(/\.md$/i, "")}
      </span>
    {/if}
  </div>

  {#if entry.isDir && expanded}
    <div class="children">
      {#if children === null}
        <div class="loading" style={`padding-left:${28 + depth * 16}px`}>{t("sidebar.loading")}</div>
      {:else}
        {#if appState.pendingNewEntry?.parentDir === entry.path}
          <NewEntryRow depth={depth + 1} isDir={appState.pendingNewEntry.isDir} />
        {/if}
        {#if children.length === 0 && !appState.pendingNewEntry}
          <div class="loading" style={`padding-left:${28 + depth * 16}px`}>{t("tree.emptyFolder")}</div>
        {:else}
          {#each children as child (child.path)}
            <TreeNode entry={child} depth={depth + 1} />
          {/each}
        {/if}
      {/if}
    </div>
  {/if}
</div>

{#if menuOpen}
  <div class="context-menu" style={`left:${menuPos.x}px; top:${menuPos.y}px`}>
    {#if entry.isDir}
      <button onclick={newFile}><Icon name="file-plus" size={14} /> {t("tree.newFile")}</button>
      <button onclick={newFolder}><Icon name="folder-plus" size={14} /> {t("tree.newFolder")}</button>
      <div class="menu-sep"></div>
    {/if}
    <button onclick={revealInExplorer}><Icon name="open" size={14} /> {t("tabs.revealInExplorer")}</button>
    <div class="menu-sep"></div>
    <button onclick={startRename}><Icon name="rename" size={14} /> {t("tree.rename")}</button>
    <button class="danger" onclick={doDelete}><Icon name="trash" size={14} /> {t("tree.delete")}</button>
  </div>
{/if}

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding-right: 8px;
    cursor: pointer;
    font-size: 13.5px;
    color: var(--text-primary);
    border-radius: 4px;
    user-select: none;
  }
  .row:hover {
    background: var(--hover-bg);
  }
  .row.selected {
    background: var(--active-bg);
    box-shadow:
      inset 3px 0 0 0 var(--accent),
      0 1px 3px rgba(0, 0, 0, 0.12);
  }
  .row.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }
  /* "inside" = drop as a child of this folder */
  .row.drag-inside {
    background: var(--active-bg);
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  /* "before"/"after" = drop as a sibling above/below this row. Starts at
     this row's own indent (--indent, set inline alongside padding-left)
     rather than a fixed offset, so the line's length/position reflects
     which nesting level — a deeper row's line is visibly shorter/further
     right — instead of always spanning the same width regardless of depth. */
  .row.drag-before::before,
  .row.drag-after::after {
    content: "";
    position: absolute;
    left: var(--indent, 4px);
    right: 4px;
    height: 2px;
    background: var(--accent);
    border-radius: 1px;
  }
  .row.drag-before::before {
    top: 0;
  }
  .row.drag-after::after {
    bottom: 0;
  }
  .chevron,
  .chevron-spacer {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--text-secondary);
  }
  .row-icon {
    display: flex;
    align-items: center;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .row-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rename-input {
    flex: 1;
    font-size: 13.5px;
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 1px 4px;
    background: var(--content-bg);
    color: var(--text-primary);
    outline: none;
  }
  .loading {
    font-size: 12.5px;
    color: var(--text-secondary);
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--content-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    padding: 4px;
    min-width: 150px;
    display: flex;
    flex-direction: column;
  }
  .context-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: none;
    background: none;
    text-align: left;
    font-size: 13px;
    border-radius: 5px;
    cursor: pointer;
    color: var(--text-primary);
  }
  .context-menu button:hover {
    background: var(--hover-bg);
  }
  .context-menu button.danger {
    color: #e03e3e;
  }
  .menu-sep {
    height: 1px;
    background: var(--border);
    margin: 4px 2px;
  }
</style>
