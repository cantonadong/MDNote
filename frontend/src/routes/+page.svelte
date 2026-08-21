<script lang="ts">
  import { flushSync, onMount } from "svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import Tabs from "$lib/components/Tabs.svelte";
  import Toolbar from "$lib/components/Toolbar.svelte";
  import Editor from "$lib/components/Editor.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";
  import Outline from "$lib/components/Outline.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import FindReplace from "$lib/components/FindReplace.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import WebLinkDialog from "$lib/components/WebLinkDialog.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { appState } from "$lib/appState.svelte";
  import { api } from "$lib/api";

  let sidebarCollapsed = $state(false);
  let outlineCollapsed = $state(false);
  let foregroundMode = $state(false);
  let foregroundTransitioning = false;
  let layoutBeforeForeground = { sidebarCollapsed: false, outlineCollapsed: false };
  let foregroundInsets = { left: 0, right: 0 };
  let foregroundEpoch = 0;
  let foregroundRegionQueue: Promise<void> = Promise.resolve();

  function queueForegroundRegion(left: number, right: number, enabled: boolean, topmost: boolean): Promise<void> {
    const operation = foregroundRegionQueue.then(() =>
      api.applyForegroundWindowRegion(left, right, enabled, topmost),
    );
    foregroundRegionQueue = operation.catch(() => {});
    return operation;
  }

  type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

  async function beginForegroundResize(event: PointerEvent, direction: ResizeDirection) {
    if (!foregroundMode || event.button !== 0) return;
    const resizeEpoch = foregroundEpoch;
    event.preventDefault();
    event.stopPropagation();
    const [startSize, startPosition] = await Promise.all([api.getWindowSize(), api.getWindowPosition()]);
    const startX = event.screenX;
    const startY = event.screenY;
    let latestX = startX;
    let latestY = startY;
    let frame = 0;

    const apply = () => {
      frame = 0;
      if (!foregroundMode || resizeEpoch !== foregroundEpoch) return;
      const dx = latestX - startX;
      const dy = latestY - startY;
      const west = direction.includes("w");
      const east = direction.includes("e");
      const north = direction.includes("n");
      const south = direction.includes("s");
      const minWidth = Math.ceil(foregroundInsets.left + foregroundInsets.right + 320);
      const minHeight = 360;
      let x = startPosition.x;
      let y = startPosition.y;
      let width = startSize.w;
      let height = startSize.h;

      if (east) width = Math.max(minWidth, startSize.w + dx);
      if (south) height = Math.max(minHeight, startSize.h + dy);
      if (west) {
        width = Math.max(minWidth, startSize.w - dx);
        x = startPosition.x + (startSize.w - width);
      }
      if (north) {
        height = Math.max(minHeight, startSize.h - dy);
        y = startPosition.y + (startSize.h - height);
      }
      api.setWindowPosition(Math.round(x), Math.round(y));
      api.setWindowSize(Math.round(width), Math.round(height));
      void queueForegroundRegion(foregroundInsets.left, foregroundInsets.right, true, true);
    };
    const move = (e: PointerEvent) => {
      latestX = e.screenX;
      latestY = e.screenY;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const finish = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        apply();
      }
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
  }

  async function toggleForegroundMode() {
    if (foregroundTransitioning) return;
    foregroundTransitioning = true;
    foregroundEpoch += 1;
    try {
      if (!foregroundMode) {
        layoutBeforeForeground = { sidebarCollapsed, outlineCollapsed };
        const sidebarWidth = document.querySelector<HTMLElement>(".sidebar")?.getBoundingClientRect().width ?? 0;
        const outlineWidth = document.querySelector<HTMLElement>(".outline")?.getBoundingClientRect().width ?? 0;
        foregroundInsets = { left: sidebarWidth, right: outlineWidth };
        api.setWindowMinSize(Math.ceil(sidebarWidth + outlineWidth + 320), 360);
        // Clip first while the sidebars are still rendered. They disappear at
        // the native window edge; hiding their DOM afterwards changes nothing
        // inside the already-visible centre region.
        await queueForegroundRegion(sidebarWidth, outlineWidth, true, true);
        flushSync(() => (foregroundMode = true));
      } else {
        // Restore the complete DOM state while it is still outside the clip,
        // then make the side strips visible with the final queued native call.
        flushSync(() => {
          foregroundMode = false;
          sidebarCollapsed = layoutBeforeForeground.sidebarCollapsed;
          outlineCollapsed = layoutBeforeForeground.outlineCollapsed;
        });
        await queueForegroundRegion(0, 0, false, false);
        api.setWindowMinSize(900, 600);
      }
    } finally {
      foregroundTransitioning = false;
    }
  }

  onMount(() => {
    appState.init();
  });

  function onKeydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key.toLowerCase() === "s" && e.shiftKey) {
      e.preventDefault();
      appState.saveActiveTabAs();
    } else if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      appState.saveActiveTab();
    } else if (e.key.toLowerCase() === "o") {
      e.preventDefault();
      appState.openViaDialog();
    } else if (e.key.toLowerCase() === "n") {
      e.preventDefault();
      appState.newTab();
    } else if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      appState.openFindReplace(false);
    } else if (e.key.toLowerCase() === "h") {
      e.preventDefault();
      appState.openFindReplace(true);
    } else if (e.key.toLowerCase() === "w") {
      if (appState.activeTabId) {
        e.preventDefault();
        appState.requestCloseTab(appState.activeTabId);
      }
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app-shell">
  <Sidebar bind:collapsed={sidebarCollapsed} {foregroundMode} />
  <div class="main-col">
    <Tabs {foregroundMode} onToggleForeground={toggleForegroundMode} />
    {#if appState.settingsActive}
      <SettingsPanel />
    {:else}
      <Toolbar />
      <FindReplace />
      <Editor />
      <StatusBar />
    {/if}
    {#if foregroundMode}
      {#each ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as direction}
        <div
          class={`foreground-resize foreground-resize-${direction}`}
          onpointerdown={(event) => beginForegroundResize(event, direction as ResizeDirection)}
          role="presentation"
        ></div>
      {/each}
    {/if}
  </div>
  {#if !appState.settingsActive}
    <Outline bind:collapsed={outlineCollapsed} {foregroundMode} />
  {/if}
</div>
<ConfirmDialog />
<WebLinkDialog />
<Toast />
{#if appState.dragGhost}
  <div class="drag-ghost" style={`left:${appState.dragGhost.x}px; top:${appState.dragGhost.y}px`}>
    <Icon name={appState.dragGhost.isDir ? "folder" : "file"} size={13} />
    <span>{appState.dragGhost.label}</span>
  </div>
{/if}

<style>
  .app-shell {
    display: flex;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }
  .main-col {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .foreground-resize { position:absolute; z-index:3000; -webkit-app-region:no-drag; }
  .foreground-resize-n { top:0; left:7px; right:7px; height:6px; cursor:n-resize; }
  .foreground-resize-s { bottom:0; left:7px; right:7px; height:6px; cursor:s-resize; }
  .foreground-resize-e { top:7px; right:0; bottom:7px; width:6px; cursor:e-resize; }
  .foreground-resize-w { top:7px; left:0; bottom:7px; width:6px; cursor:w-resize; }
  .foreground-resize-ne { top:0; right:0; width:9px; height:9px; cursor:ne-resize; }
  .foreground-resize-nw { top:0; left:0; width:9px; height:9px; cursor:nw-resize; }
  .foreground-resize-se { right:0; bottom:0; width:9px; height:9px; cursor:se-resize; }
  .foreground-resize-sw { left:0; bottom:0; width:9px; height:9px; cursor:sw-resize; }
  /* Follows the pointer during a sidebar file/folder drag (see
     dragController.ts) — plain pointer-event dragging has no native drag
     image the way HTML5 DnD would, so without this the dragged item gives
     no visual sense of "being carried" as it moves over other rows. */
  .drag-ghost {
    position: fixed;
    z-index: 2000;
    pointer-events: none;
    transform: translate(12px, 12px);
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 240px;
    padding: 5px 10px;
    border-radius: 6px;
    background: var(--content-bg);
    border: 1px solid var(--border);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    font-size: 13px;
    color: var(--text-primary);
    opacity: 0.85;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .drag-ghost :global(svg) {
    flex-shrink: 0;
    color: var(--text-secondary);
  }
</style>
