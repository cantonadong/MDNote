<script lang="ts">
  import { appState } from "$lib/appState.svelte";
  import { editorBridge } from "$lib/editor/bridge.svelte";
  import { t, i18n, formatSyncTime } from "$lib/i18n.svelte";

  let sync = $derived(appState.syncStatus);
  let lightState = $derived(
    sync.lastError ? "error" : sync.syncing || appState.hasUnsyncedChanges ? "pending" : sync.lastSyncTime ? "success" : "idle",
  );
  let syncText = $derived.by(() => {
    if (sync.syncing) return t("statusbar.sync.syncing");
    if (sync.lastError) return t("statusbar.sync.failed");
    if (appState.hasUnsyncedChanges) return t("statusbar.sync.pending");
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
    <span class="sync-indicator" role="status" title={sync.lastError || syncText}>
      <span class="sync-light {lightState}" aria-hidden="true"></span>
      {syncText}
    </span>
  {/if}
  <button class="zoom" title={t("statusbar.zoom.reset")} onclick={() => editorBridge.resetZoom?.()}>
    {editorBridge.zoom}%
  </button>
</div>

<style>
  .status-bar {
    position: relative;
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
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    max-width: 60%;
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sync-light {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-secondary);
    flex-shrink: 0;
  }
  .sync-light.success {
    background: #22a559;
  }
  .sync-light.error {
    background: #e03e3e;
  }
  .sync-light.pending {
    background: #3b82f6;
  }
</style>
