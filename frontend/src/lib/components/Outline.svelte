<script lang="ts">
  import { appState } from "$lib/appState.svelte";
  import { editorBridge } from "$lib/editor/bridge.svelte";
  import { numberOutline } from "$lib/editor/outline";
  import { t } from "$lib/i18n.svelte";

  function jump(pos: number) {
    editorBridge.scrollToPos?.(pos);
  }

  let numbers = $derived(
    appState.settings.outlineAutoNumber ? numberOutline(appState.outlineItems) : null,
  );
</script>

<aside class="outline">
  <div class="outline-title">{t("outline.title")}</div>
  {#if appState.outlineItems.length === 0}
    <div class="empty">{t("outline.empty")}</div>
  {:else}
    <ul>
      {#each appState.outlineItems as item, i (i)}
        <li>
          <button
            style={`padding-left:${8 + (item.level - 1) * 12}px`}
            title={item.text || "(空标题)"}
            onclick={() => jump(item.pos)}
          >
            {#if numbers}<span class="outline-number">{numbers[i]}</span>{/if}{item.text || "(空标题)"}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .outline {
    width: 220px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    background: var(--sidebar-bg);
    overflow-y: auto;
    padding: 12px 8px;
  }
  .outline-title {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 0 6px 8px;
  }
  .empty {
    font-size: 12.5px;
    color: var(--text-secondary);
    padding: 0 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li button {
    display: block;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    font-size: 12.5px;
    color: var(--text-primary);
    padding: 5px 6px;
    border-radius: 4px;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  li button:hover {
    background: var(--hover-bg);
  }
  .outline-number {
    color: var(--text-secondary);
    margin-right: 5px;
  }
</style>
