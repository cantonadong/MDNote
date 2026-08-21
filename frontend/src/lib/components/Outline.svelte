<script lang="ts">
  import { appState } from "$lib/appState.svelte";
  import { editorBridge } from "$lib/editor/bridge.svelte";
  import { numberOutline } from "$lib/editor/outline";
  import { t } from "$lib/i18n.svelte";
  import RasterIcon from "./RasterIcon.svelte";

  let { collapsed = $bindable(false), foregroundMode = false }: { collapsed?: boolean; foregroundMode?: boolean } = $props();

  function jump(pos: number) {
    editorBridge.scrollToPos?.(pos);
  }

  let numbers = $derived(
    appState.settings.outlineAutoNumber ? numberOutline(appState.outlineItems) : null,
  );
  let emptyHeading = $derived(t("outline.emptyHeading"));

  function closeOutline(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    collapsed = true;
  }

  function openOutline(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    collapsed = false;
  }
</script>

<aside class="outline" class:collapsed class:foreground-mode={foregroundMode}>
  {#if collapsed}
    <button type="button" class="rail-btn" title={t("outline.title")} aria-label={t("outline.title")} onclick={openOutline}>
      <RasterIcon name="left" size={16} />
    </button>
  {:else}
  <div class="outline-title">
    <span>{t("outline.title")}</span>
    <button type="button" title="折叠大纲" aria-label="折叠大纲" onclick={closeOutline}><RasterIcon name="right" size={16} /></button>
  </div>
  {#if appState.outlineItems.length === 0}
    <div class="empty">{t("outline.empty")}</div>
  {:else}
    <ul>
      {#each appState.outlineItems as item, i (i)}
        <li>
          <button
            style={`padding-left:${8 + (item.level - 1) * 12}px`}
            title={item.text || emptyHeading}
            onclick={() => jump(item.pos)}
          >
            {#if numbers}<span class="outline-number">{numbers[i]}</span>{/if}{item.text || emptyHeading}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {/if}
</aside>

<style>
  .outline {
    position: relative;
    width: 240px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    background: var(--sidebar-bg);
    overflow-y: auto;
    padding: 0 8px 12px;
  }
  .outline.collapsed { width:32px; padding:0; overflow:hidden; cursor:pointer; }
  .outline.foreground-mode { visibility:hidden; pointer-events:none; }
  .rail-btn,
  .outline-title button {
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    pointer-events: auto;
    -webkit-app-region: no-drag !important;
    z-index: 20;
  }
  .rail-btn { position:absolute; inset:0; width:100%; height:100%; border-radius:0; display:flex; align-items:center; justify-content:center; }
  .rail-btn:hover,
  .outline-title button:hover { background: var(--hover-bg); color: var(--text-primary); }
  .outline-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    height: 34px;
    padding: 0 32px 0 6px;
  }
  .outline-title button { position:absolute; top:4px; right:3px; width:26px; height:26px; border-radius:5px; display:flex; align-items:center; justify-content:center; }
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
