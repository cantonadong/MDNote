<script lang="ts">
  import { fade } from "svelte/transition";
  import { appState } from "$lib/appState.svelte";
  import { api } from "$lib/api";
  import { t } from "$lib/i18n.svelte";
  import UpdateReadyToast from "./UpdateReadyToast.svelte";

  async function openExportedPdf() {
    const path = appState.exportedPdfPath;
    if (!path) return;
    try {
      await api.openWithDefaultApp(path);
      appState.hideExportedPdf();
    } catch (e) {
      appState.showToast(`${t("toast.openFailed")}: ${e}`);
    }
  }
</script>

{#if appState.toast}
  <div class="toast" transition:fade={{ duration: 200 }}>{appState.toast}</div>
{/if}

{#if appState.exportedPdfPath}
  <div class="export-toast" transition:fade={{ duration: 200 }}>
    <div class="export-title">{t("toast.exportPdfSuccess")}</div>
    <div class="export-path">{appState.exportedPdfPath}</div>
    <div class="export-actions">
      <button onclick={openExportedPdf}>{t("toast.openFile")}</button>
      <button onclick={() => appState.hideExportedPdf()}>{t("findreplace.close")}</button>
    </div>
  </div>
{/if}

{#if appState.updateStatus.ready}
  <UpdateReadyToast
    version={appState.updateStatus.version}
    title={t("update.ready")}
    detail={t("update.downloaded", { version: appState.updateStatus.version })}
    confirmLabel={t("update.restart")}
    laterLabel={t("update.later")}
    onconfirm={() => void appState.applyUpdate()}
    onlater={() => appState.dismissUpdate()}
  />
{/if}

<style>
  .toast {
    position: fixed;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    background: #37352f;
    color: #fff;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    z-index: 3000;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  }
  .export-toast {
    position: fixed;
    right: 18px;
    bottom: 40px;
    width: min(420px, calc(100vw - 36px));
    background: var(--content-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    z-index: 3000;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    font-size: 13px;
  }
  .export-title {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .export-path {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 10px;
  }
  .export-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .export-actions button {
    border: none;
    border-radius: 5px;
    background: var(--hover-bg);
    color: var(--text-primary);
    padding: 6px 10px;
    cursor: pointer;
    font: inherit;
  }
  .export-actions button:hover {
    background: var(--hover-bg-strong);
  }
</style>
