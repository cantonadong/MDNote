<script lang="ts">
  import { tick } from "svelte";
  import RasterIcon from "./RasterIcon.svelte";
  import { appState } from "$lib/appState.svelte";

  let { depth = 0, isDir }: { depth?: number; isDir: boolean } = $props();
  let value = $state("");
  let settled = false;
  let inputEl: HTMLInputElement;

  // The native `autofocus` attribute only reliably fires for elements
  // present at initial page load; this row is always inserted later (in
  // response to a click), so focus it explicitly once it's in the DOM.
  $effect(() => {
    tick().then(() => inputEl?.focus());
  });

  function commit() {
    if (settled) return;
    settled = true;
    void appState.commitCreateEntry(value);
  }

  function cancel() {
    if (settled) return;
    settled = true;
    appState.cancelCreateEntry();
  }
</script>

<div class="row" style={`padding-left:${8 + depth * 16}px`}>
  <span class="chevron-spacer"></span>
  <span class="row-icon" class:folder-icon={isDir} class:file-icon={!isDir}>
    <RasterIcon name={isDir ? "folder" : "file"} size={15} />
  </span>
  <input
    class="name-input"
    bind:this={inputEl}
    bind:value
    onkeydown={(e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") cancel();
    }}
    onblur={commit}
  />
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding-right: 8px;
    font-size: 13.5px;
  }
  .chevron-spacer {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
  .row-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .row-icon.folder-icon {
    color: #b7791f;
    background: rgba(217, 155, 40, 0.14);
  }
  .row-icon.file-icon {
    color: #3974b9;
    background: rgba(57, 116, 185, 0.11);
  }
  .name-input {
    flex: 1;
    font-size: 13.5px;
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 1px 4px;
    background: var(--content-bg);
    color: var(--text-primary);
    outline: none;
  }
</style>
