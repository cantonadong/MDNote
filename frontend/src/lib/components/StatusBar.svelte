<script lang="ts">
  import { appState } from "$lib/appState.svelte";
  import { editorBridge } from "$lib/editor/bridge.svelte";
  import { t } from "$lib/i18n.svelte";
</script>

<div class="status-bar">
  <span>{appState.wordCount} {t("statusbar.words")}</span>
  <button class="zoom" title={t("statusbar.zoom.reset")} onclick={() => editorBridge.resetZoom?.()}>
    {editorBridge.zoom}%
  </button>
</div>

<style>
  .status-bar {
    height: 26px;
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
</style>
