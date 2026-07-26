<script lang="ts">
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import { appState, stripMdExt, type Tab } from "$lib/appState.svelte";
  import { t } from "$lib/i18n.svelte";

  let scrollEl: HTMLDivElement;
  let draggingId: string | null = $state(null);
  let dragOverId: string | null = $state(null);
  let dragOverEnd = $state(false);

  let renamingId: string | null = $state(null);
  let renameValue = $state("");
  let renameInputEl: HTMLInputElement = $state()!;

  function select(tab: Tab) {
    appState.activateTab(tab.id);
    void appState.checkMissing(tab);
  }

  function close(e: MouseEvent, tab: Tab) {
    e.stopPropagation();
    appState.requestCloseTab(tab.id);
  }

  function onMouseDown(e: MouseEvent, tab: Tab) {
    if (e.button === 1) {
      e.preventDefault();
      appState.requestCloseTab(tab.id);
    }
  }

  function onSettingsMouseDown(e: MouseEvent) {
    if (e.button === 1) {
      e.preventDefault();
      appState.closeSettings();
    }
  }

  function onWheel(e: WheelEvent) {
    if (!scrollEl) return;
    if (scrollEl.scrollWidth <= scrollEl.clientWidth) return;
    e.preventDefault();
    scrollEl.scrollLeft += e.deltaY + e.deltaX;
  }

  function onDragStart(e: DragEvent, tab: Tab) {
    draggingId = tab.id;
    e.dataTransfer?.setData("text/plain", tab.id);
    e.dataTransfer!.effectAllowed = "move";
  }

  function onDragOverTab(e: DragEvent, tab: Tab) {
    if (!draggingId || draggingId === tab.id) return;
    e.preventDefault();
    dragOverId = tab.id;
    dragOverEnd = false;
  }

  function onDropTab(e: DragEvent, tab: Tab) {
    e.preventDefault();
    if (draggingId && draggingId !== tab.id) {
      appState.reorderTab(draggingId, tab.id);
    }
    draggingId = null;
    dragOverId = null;
    dragOverEnd = false;
  }

  function onDragEnd() {
    draggingId = null;
    dragOverId = null;
    dragOverEnd = false;
  }

  // The trailing space after the last tab has no tab element of its own to
  // fire dragover/drop, so without this, a tab can be dragged left onto an
  // earlier tab but never past the last one. Tracked separately from
  // dragOverId (which highlights a specific tab's left edge) since "will
  // land at the very end" needs its own indicator, not another tab's.
  function onEndDragOver(e: DragEvent) {
    if (!draggingId) return;
    e.preventDefault();
    dragOverId = null;
    dragOverEnd = true;
  }

  function onEndDrop(e: DragEvent) {
    e.preventDefault();
    if (draggingId) appState.moveTabToEnd(draggingId);
    draggingId = null;
    dragOverId = null;
    dragOverEnd = false;
  }

  // Double-click to rename: an untitled tab still on its generic default
  // name starts with an empty, focused input (nothing worth keeping); any
  // tab with a real name (a saved file, or one already renamed once) starts
  // with that name selected, ready to be overwritten in one keystroke.
  async function startRename(e: MouseEvent, tab: Tab) {
    e.stopPropagation();
    const hasRealName = !!tab.path || tab.title !== "未命名.md";
    renamingId = tab.id;
    renameValue = hasRealName ? stripMdExt(tab.title) : "";
    await tick();
    renameInputEl?.focus();
    if (hasRealName) renameInputEl?.select();
  }

  async function commitRename(tab: Tab) {
    if (renamingId !== tab.id) return;
    renamingId = null;
    const val = renameValue.trim();
    if (!val) return;
    const newName = /\.md$/i.test(val) ? val : `${val}.md`;
    if (newName === tab.title) return;
    if (tab.path) {
      await appState.renameEntry(tab.path, newName);
    } else {
      tab.title = newName;
    }
  }

  function cancelRename() {
    renamingId = null;
  }
</script>

<div class="tabs">
  <div class="tabs-scroll" bind:this={scrollEl} onwheel={onWheel}>
    {#each appState.tabs as tab (tab.id)}
      <div
        class="tab"
        class:active={tab.id === appState.activeTabId}
        class:drag-over={dragOverId === tab.id}
        draggable={renamingId !== tab.id}
        onclick={() => select(tab)}
        onmousedown={(e) => onMouseDown(e, tab)}
        ondragstart={(e) => onDragStart(e, tab)}
        ondragover={(e) => onDragOverTab(e, tab)}
        ondrop={(e) => onDropTab(e, tab)}
        ondragend={onDragEnd}
        title={tab.path ?? tab.title}
        role="presentation"
      >
        <div class="tab-title-wrap">
          {#if renamingId === tab.id}
            <input
              class="tab-rename-input"
              bind:this={renameInputEl}
              bind:value={renameValue}
              onclick={(e) => e.stopPropagation()}
              onkeydown={(e) => {
                if (e.key === "Enter") commitRename(tab);
                if (e.key === "Escape") cancelRename();
              }}
              onblur={() => commitRename(tab)}
            />
          {:else}
            <span class="tab-title" ondblclick={(e) => startRename(e, tab)} role="presentation">{stripMdExt(tab.title)}</span>
          {/if}
          {#if tab.missing}
            <span class="missing-dot" title={t("tabs.missingFile")} aria-hidden="true"></span>
          {:else if appState.isDirty(tab)}
            <span class="dirty-dot" aria-hidden="true"></span>
          {/if}
        </div>
        <span class="tab-close" onclick={(e) => close(e, tab)} role="presentation">
          <Icon name="close" size={13} />
        </span>
      </div>
    {/each}
    {#if appState.settingsOpen}
      <div
        class="tab settings-tab"
        class:active={appState.settingsActive}
        onclick={() => (appState.settingsActive = true)}
        onmousedown={onSettingsMouseDown}
        role="presentation"
      >
        <div class="tab-title-wrap">
          <span class="tab-title">{t("settings.tabTitle")}</span>
        </div>
        <span
          class="tab-close"
          onclick={(e) => {
            e.stopPropagation();
            appState.closeSettings();
          }}
          role="presentation"
        >
          <Icon name="close" size={13} />
        </span>
      </div>
    {/if}
    <div
      class="tabs-end-spacer"
      class:drag-over={dragOverEnd}
      ondragover={onEndDragOver}
      ondrop={onEndDrop}
      role="presentation"
    ></div>
  </div>
  <button class="new-tab-btn" title={t("tabs.newTab")} aria-label={t("tabs.newTab")} onclick={() => appState.newTab()}>
    <Icon name="plus" size={15} />
  </button>
</div>

<style>
  .tabs {
    display: flex;
    align-items: center;
    height: 34px;
    background: var(--sidebar-bg);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .tabs-scroll {
    display: flex;
    overflow-x: auto;
    height: 100%;
    scrollbar-width: none;
  }
  .tabs-scroll::-webkit-scrollbar {
    display: none;
  }
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
    height: 100%;
    min-width: 110px;
    max-width: 200px;
    padding: 0 26px 0 8px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    white-space: nowrap;
    cursor: pointer;
    border-right: 1px solid transparent;
  }
  .tab.active {
    background: var(--content-bg);
    color: var(--text-primary);
    box-shadow: inset 0 -2px 0 0 var(--accent);
  }
  .tab:hover:not(.active) {
    background: var(--hover-bg);
  }
  .tab.drag-over {
    box-shadow: inset 2px 0 0 var(--accent);
  }
  /* Title is centered in the remaining space (the close button is pulled
     out of flow, pinned to the tab's right edge via .tab-close below) so it
     stays centered regardless of tab width instead of hugging the left
     edge and letting the close button drift wherever the text ends. */
  .tab-title-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    overflow: hidden;
  }
  .tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-rename-input {
    width: 100px;
    font: inherit;
    color: var(--text-primary);
    background: var(--content-bg);
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 1px 4px;
    outline: none;
  }
  .tabs-end-spacer {
    flex: 1;
    min-width: 16px;
    height: 100%;
  }
  .tabs-end-spacer.drag-over {
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }
  .missing-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #e03e3e;
    flex-shrink: 0;
  }
  .tab-close {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    flex-shrink: 0;
    color: var(--text-secondary);
  }
  .tab-close:hover {
    background: var(--hover-bg-strong);
    color: var(--text-primary);
  }
  .new-tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    margin-left: 4px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 5px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .new-tab-btn:hover {
    background: var(--hover-bg);
    color: var(--text-primary);
  }
</style>
