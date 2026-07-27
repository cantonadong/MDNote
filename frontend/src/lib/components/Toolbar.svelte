<script lang="ts">
  import Icon from "./Icon.svelte";
  import { appState } from "$lib/appState.svelte";
  import { editorBridge } from "$lib/editor/bridge.svelte";
  import { t } from "$lib/i18n.svelte";

  function undo() {
    editorBridge.instance?.chain().focus().undo().run();
  }
  function redo() {
    editorBridge.instance?.chain().focus().redo().run();
  }
  function printDoc() {
    window.print();
  }
  let buttons = $derived([
    { name: "open", title: t("toolbar.open"), action: () => appState.openViaDialog(), disabled: () => false },
    { name: "new", title: t("toolbar.new"), action: () => appState.newTab(), disabled: () => false },
    { name: "save", title: t("toolbar.save"), action: () => appState.saveActiveTab(), disabled: () => false },
    { name: "save-as", title: t("toolbar.saveAs"), action: () => appState.saveActiveTabAs(), disabled: () => false },
    {
      name: "export",
      title: t("toolbar.export"),
      action: () => appState.exportActiveTabAsPdf(),
      disabled: () => false,
    },
    { name: "print", title: t("toolbar.print"), action: printDoc, disabled: () => false },
    { name: "search", title: t("toolbar.find"), action: () => appState.openFindReplace(false), disabled: () => false },
    { name: "replace", title: t("toolbar.replace"), action: () => appState.openFindReplace(true), disabled: () => false },
    { name: "undo", title: t("toolbar.undo"), action: undo, disabled: () => !editorBridge.canUndo },
    { name: "redo", title: t("toolbar.redo"), action: redo, disabled: () => !editorBridge.canRedo },
  ]);
</script>

<div class="toolbar">
  {#each buttons as btn (btn.name)}
    <button
      class="tb-btn"
      title={btn.title}
      aria-label={btn.title}
      disabled={btn.disabled()}
      onclick={btn.action}
    >
      <Icon name={btn.name} size={17} />
    </button>
  {/each}
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 40px;
    padding: 0 10px;
    border-bottom: 1px solid var(--border);
    background: var(--content-bg);
    flex-shrink: 0;
    -webkit-app-region: drag;
  }
  .tb-btn {
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 5px;
    cursor: pointer;
  }
  .tb-btn:hover {
    background: var(--hover-bg);
    color: var(--text-primary);
  }
  .tb-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .tb-btn:disabled:hover {
    background: transparent;
    color: var(--text-secondary);
  }
</style>
