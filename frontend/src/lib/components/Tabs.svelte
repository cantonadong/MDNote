<script lang="ts">
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import { appState, isDefaultUntitledTitle, stripMdExt, type Tab } from "$lib/appState.svelte";
  import { t } from "$lib/i18n.svelte";
  import { api } from "$lib/api";

  let {
    foregroundMode = false,
    onToggleForeground,
    onForegroundPointerDown,
  }: {
    foregroundMode?: boolean;
    onToggleForeground: () => void;
    onForegroundPointerDown?: (event: PointerEvent) => void;
  } = $props();

  let scrollEl: HTMLDivElement;
  let canScrollRight = $state(false);
  let draggingId: string | null = $state(null);
  let dragOverId: string | null = $state(null);
  let dragOverEnd = $state(false);

  let renamingId: string | null = $state(null);
  let renameValue = $state("");
  let renameInputEl: HTMLInputElement = $state()!;

  let menuTab: Tab | null = $state(null);
  let menuPos = $state({ x: 0, y: 0 });

  function openMenu(e: MouseEvent, tab: Tab) {
    e.preventDefault();
    e.stopPropagation();
    menuPos = { x: e.clientX, y: e.clientY };
    menuTab = tab;
  }

  function closeMenu() {
    menuTab = null;
  }

  function menuClose(tab: Tab) {
    closeMenu();
    appState.requestCloseTab(tab.id);
  }

  function menuCloseOthers(tab: Tab) {
    closeMenu();
    appState.closeOtherTabs(tab.id);
  }

  function menuCloseToRight(tab: Tab) {
    closeMenu();
    appState.closeTabsToSide(tab.id, "right");
  }

  function menuCloseToLeft(tab: Tab) {
    closeMenu();
    appState.closeTabsToSide(tab.id, "left");
  }

  function menuRevealInExplorer(tab: Tab) {
    closeMenu();
    if (!tab.path) return;
    api.revealInExplorer(tab.path).catch((e) => appState.showToast(`${t("toast.openFailed")}: ${e}`));
  }

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
    requestAnimationFrame(syncOverflowIndicator);
  }

  function syncOverflowIndicator() {
    if (!scrollEl) return;
    canScrollRight = scrollEl.scrollLeft + scrollEl.clientWidth < scrollEl.scrollWidth - 1;
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
    e.stopPropagation();
    const sourceId = draggingId || e.dataTransfer?.getData("text/plain") || null;
    if (sourceId && sourceId !== tab.id) {
      appState.reorderTab(sourceId, tab.id);
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
    e.stopPropagation();
    // WebView2 may deliver dragend as the pointer crosses from the trailing
    // spacer onto the adjacent new-tab button. Recover the source from the
    // native drag payload so the visible end insertion target always commits.
    const sourceId = draggingId || e.dataTransfer?.getData("text/plain") || null;
    if (sourceId) appState.moveTabToEnd(sourceId);
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
    const hasRealName = !!tab.path || !isDefaultUntitledTitle(tab.title);
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

  let menuTabIndex = $derived(menuTab ? appState.tabs.findIndex((t) => t.id === menuTab!.id) : -1);
  let menuHasLeft = $derived(menuTabIndex > 0);
  let menuHasRight = $derived(menuTabIndex !== -1 && menuTabIndex < appState.tabs.length - 1);
  let menuHasOthers = $derived(appState.tabs.length > 1);
  let foregroundTitle = $derived(
    appState.settingsActive
      ? t("settings.tabTitle")
      : stripMdExt(appState.tabs.find((tab) => tab.id === appState.activeTabId)?.title ?? ""),
  );

  // Opening/creating a tab can place it beyond the currently visible part
  // of the horizontal strip. Always bring the newly active tab on screen.
  $effect(() => {
    const activeId = appState.activeTabId;
    if (!activeId || !scrollEl) return;
    tick().then(() => {
      const active = scrollEl.querySelector<HTMLElement>(`.tab[data-tab-id="${CSS.escape(activeId)}"]`);
      active?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  });

  $effect(() => {
    appState.tabs.length;
    appState.settingsOpen;
    foregroundMode;
    tick().then(syncOverflowIndicator);
  });
</script>

<svelte:window onclick={menuTab ? closeMenu : undefined} onresize={syncOverflowIndicator} />

<div class="tabs" class:foreground-mode={foregroundMode} onpointerdown={onForegroundPointerDown} role="presentation">
  <div class="tabs-scroll" bind:this={scrollEl} onwheel={onWheel} onscroll={syncOverflowIndicator}>
    {#each appState.tabs as tab (tab.id)}
      <div
        class="tab"
        class:active={tab.id === appState.activeTabId && !appState.settingsActive}
        class:foreground-hidden={foregroundMode}
        class:drag-over={dragOverId === tab.id}
        data-tab-id={tab.id}
        draggable={renamingId !== tab.id}
        onclick={() => select(tab)}
        onmousedown={(e) => onMouseDown(e, tab)}
        ondragstart={(e) => onDragStart(e, tab)}
        ondragover={(e) => onDragOverTab(e, tab)}
        ondrop={(e) => onDropTab(e, tab)}
        ondragend={onDragEnd}
        oncontextmenu={(e) => openMenu(e, tab)}
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
        class:foreground-hidden={foregroundMode}
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
  {#if foregroundMode}
    <div class="foreground-title">{foregroundTitle}</div>
  {/if}
  {#if canScrollRight && !foregroundMode}
    <span class="tabs-overflow-indicator" aria-hidden="true"></span>
  {/if}
  <button
    class="new-tab-btn"
    title={t("tabs.newTab")}
    aria-label={t("tabs.newTab")}
    ondragover={onEndDragOver}
    ondrop={onEndDrop}
    onclick={() => appState.newTab()}
  >
    <Icon name="plus" size={15} />
  </button>
  <button
    class="foreground-btn"
    class:active={foregroundMode}
    title={t(foregroundMode ? "sidebar.foregroundOff" : "sidebar.foreground")}
    aria-label={t(foregroundMode ? "sidebar.foregroundOff" : "sidebar.foreground")}
    aria-pressed={foregroundMode}
    onclick={onToggleForeground}
  >
    <Icon name="pin" size={15} />
  </button>
</div>

{#if menuTab}
  <div class="context-menu" style={`left:${menuPos.x}px; top:${menuPos.y}px`}>
    <button onclick={() => menuClose(menuTab!)}><Icon name="close" size={14} /> {t("tabs.close")}</button>
    <div class="menu-sep"></div>
    <button disabled={!menuHasOthers} onclick={() => menuCloseOthers(menuTab!)}>{t("tabs.closeOthers")}</button>
    <button disabled={!menuHasRight} onclick={() => menuCloseToRight(menuTab!)}>{t("tabs.closeToRight")}</button>
    <button disabled={!menuHasLeft} onclick={() => menuCloseToLeft(menuTab!)}>{t("tabs.closeToLeft")}</button>
    <div class="menu-sep"></div>
    <button disabled={!menuTab.path} onclick={() => menuRevealInExplorer(menuTab!)}>
      <Icon name="folder" size={14} /> {t("tabs.revealInExplorer")}
    </button>
  </div>
{/if}

<style>
  .tabs {
    position: relative;
    display: flex;
    align-items: center;
    height: 34px;
    background: var(--sidebar-bg);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .tabs-scroll {
    display: flex;
    flex: 1;
    min-width: 0;
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
     edge and letting the close button drift wherever the text ends.
     Three-column grid rather than a plain centered flex row: the dirty/
     missing dot lives in the 3rd column, right after the title with its own
     small gap, but — since columns 1 and 3 are both `1fr` — its presence
     doesn't change how the *title* column is centered the way stuffing the
     dot into the same centered flex group used to (that pushed the whole
     "title + dot" cluster's midpoint left of true center). */
  .tab-title-wrap {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 1fr minmax(0, auto) 1fr;
    align-items: center;
    overflow: hidden;
  }
  .tab-title {
    grid-column: 2;
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
  /* Grid column 3 (see .tab-title-wrap) — sits right after the title with
     a small gap of its own, without being part of the title's centering
     column. */
  .dirty-dot,
  .missing-dot {
    grid-column: 3;
    justify-self: start;
    margin-left: 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dirty-dot {
    background: var(--accent);
  }
  .missing-dot {
    background: #e03e3e;
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
  .new-tab-btn,
  .foreground-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
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
  .tab.foreground-hidden {
    display: none;
  }
  .tabs.foreground-mode {
    /* Foreground mode uses pointer-driven movement in +page.svelte. Native
       draggable regions stop WebView pointer delivery at the window edge,
       which conflicts with the custom clipped-window resize handles. */
    --wails-draggable: no-drag;
    -webkit-app-region: no-drag;
    cursor: move;
  }
  .tabs-overflow-indicator {
    width: 2px;
    height: 22px;
    margin-left: 2px;
    border-radius: 1px;
    background: var(--accent);
    flex-shrink: 0;
    pointer-events: none;
  }
  .tabs.foreground-mode .tab,
  .tabs.foreground-mode .new-tab-btn,
  .tabs.foreground-mode .foreground-btn {
    --wails-draggable: no-drag;
    -webkit-app-region: no-drag;
    cursor: pointer;
  }
  .foreground-title {
    position: absolute;
    left: 50%;
    top: 50%;
    max-width: calc(100% - 140px);
    transform: translate(-50%, -50%);
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }
  .foreground-btn {
    margin-left:2px;
    margin-right:0;
  }
  .foreground-btn:hover {
    background:var(--hover-bg);
    color:var(--text-primary);
  }
  .foreground-btn.active {
    background:var(--active-bg);
    color:var(--accent);
  }
  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--content-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    padding: 4px;
    min-width: 170px;
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
  .context-menu button:hover:not(:disabled) {
    background: var(--hover-bg);
  }
  .context-menu button:disabled {
    color: var(--text-secondary);
    opacity: 0.5;
    cursor: default;
  }
  .menu-sep {
    height: 1px;
    background: var(--border);
    margin: 4px 2px;
  }
</style>
