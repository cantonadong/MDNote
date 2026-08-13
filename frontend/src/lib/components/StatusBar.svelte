<script lang="ts">
  import { appState } from "$lib/appState.svelte";
  import { editorBridge } from "$lib/editor/bridge.svelte";
  import { t, i18n, formatSyncTime } from "$lib/i18n.svelte";
  import Icon from "./Icon.svelte";

  let sync = $derived(appState.syncStatus);
  let syncText = $derived.by(() => {
    if (sync.syncing) return t("statusbar.sync.syncing");
    if (sync.lastError) return t("statusbar.sync.failed");
    if (sync.lastSyncTime) {
      const time = formatSyncTime(sync.lastSyncTime, i18n.locale);
      return t("statusbar.sync.synced", { time });
    }
    return t("statusbar.sync.never");
  });
</script>

<div class="status-bar">
  <span>{appState.wordCount} {t("statusbar.words")}</span>
  {#if sync.enabled && sync.configured}
    <span class="sync-indicator" class:error={!!sync.lastError && !sync.syncing} title={syncText}>
      <span class="sync-icon" class:spin={sync.syncing}>
        <Icon name={sync.syncing ? "refresh" : "cloud"} size={13} />
      </span>
      {syncText}
    </span>
  {/if}
  <button class="zoom" title={t("statusbar.zoom.reset")} onclick={() => editorBridge.resetZoom?.()}>
    {editorBridge.zoom}%
  </button>
</div>

<style>
  .status-bar {
    height: 34px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    font-size: 12px;
    color: var(--text-secondary);
    border-top: 1px solid var(--border);
    background: var(--content-bg);
  }
  .zoom {
    border: none;
    background: none;
    padding: 2px 6px;
    margin: 0 -6px;
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .zoom:hover {
    background: var(--hover-bg);
    color: var(--text-primary);
  }
  .sync-indicator {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sync-indicator.error {
    color: #e03e3e;
  }
  .sync-icon {
    display: inline-flex;
    flex-shrink: 0;
  }
  .sync-icon.spin {
    animation: sync-spin 1s linear infinite;
  }
  @keyframes sync-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
