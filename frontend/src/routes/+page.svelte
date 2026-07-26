<script lang="ts">
  import { onMount } from "svelte";
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
  <Sidebar />
  <div class="main-col">
    <Tabs />
    {#if appState.settingsActive}
      <SettingsPanel />
    {:else}
      <Toolbar />
      <FindReplace />
      <Editor />
      <StatusBar />
    {/if}
  </div>
  {#if !appState.settingsActive}
    <Outline />
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
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
  }
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
