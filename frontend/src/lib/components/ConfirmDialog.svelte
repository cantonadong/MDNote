<script lang="ts">
  import { appState } from "$lib/appState.svelte";
  import { t } from "$lib/i18n.svelte";

  // Capture phase + stopPropagation: without it, Enter would also reach the
  // editor's own contenteditable underneath (which still holds keyboard
  // focus while this overlay is just a visually-on-top div) and insert a
  // newline there invisibly behind the dialog, in addition to resolving it.
  function onKeydownCapture(e: KeyboardEvent) {
    if (e.key !== "Enter") return;
    if (appState.pendingClose) {
      e.preventDefault();
      e.stopPropagation();
      // "优先保存": Enter always resolves to the save/save-as action, never
      // discard — discarding on a stray Enter would be destructive.
      appState.resolvePendingClose("save");
    } else if (appState.pendingDelete) {
      e.preventDefault();
      e.stopPropagation();
      // "删除高于取消": Enter confirms the delete.
      appState.resolvePendingDelete(true);
    }
  }
</script>

<svelte:window onkeydowncapture={onKeydownCapture} />

{#if appState.pendingClose}
  <div class="overlay">
    <div class="dialog">
      {#if appState.pendingClose.missing}
        <p>{t("confirm.missingTitle")}</p>
        <div class="actions">
          <button onclick={() => appState.resolvePendingClose("cancel")}>{t("confirm.cancel")}</button>
          <button class="danger" onclick={() => appState.resolvePendingClose("discard")}
            >{t("confirm.discardAndClose")}</button
          >
          <button class="primary" onclick={() => appState.resolvePendingClose("save")}>{t("confirm.saveAs")}</button>
        </div>
      {:else}
        <p>{t("confirm.unsavedTitle")}</p>
        <div class="actions">
          <button onclick={() => appState.resolvePendingClose("cancel")}>{t("confirm.cancel")}</button>
          <button class="danger" onclick={() => appState.resolvePendingClose("discard")}>{t("confirm.discard")}</button>
          <button class="primary" onclick={() => appState.resolvePendingClose("save")}>{t("confirm.save")}</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if appState.pendingDelete}
  <div class="overlay">
    <div class="dialog">
      <p>
        {t("confirm.deleteTitle", {
          type: appState.pendingDelete.isDir ? t("confirm.deleteFolder") : t("confirm.deleteFile"),
          name: appState.pendingDelete.name,
        })}
      </p>
      <div class="actions">
        <button onclick={() => appState.resolvePendingDelete(false)}>{t("confirm.cancel")}</button>
        <button class="danger" onclick={() => appState.resolvePendingDelete(true)}>{t("confirm.deleteConfirm")}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }
  .dialog {
    background: var(--content-bg);
    border-radius: 10px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
    padding: 20px;
    width: 340px;
  }
  .dialog p {
    margin: 0 0 16px;
    font-size: 13.5px;
    color: var(--text-primary);
    line-height: 1.5;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions button {
    border: 1px solid var(--border);
    background: var(--content-bg);
    color: var(--text-primary);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .actions button:hover {
    background: var(--hover-bg);
  }
  .actions button.primary {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .actions button.danger {
    background: #e03e3e;
    color: #fff;
    border-color: #e03e3e;
  }
</style>
