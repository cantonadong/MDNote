<script lang="ts">
  import Icon from "./Icon.svelte";
  import { appState } from "$lib/appState.svelte";
  import { editorBridge } from "$lib/editor/bridge.svelte";
  import { searchPluginKey, findMatches } from "$lib/editor/searchHighlight";

  let query = $state("");
  let replacement = $state("");
  let matchCount = $state(0);
  let activeIndex = $state(-1);
  let queryInputEl: HTMLInputElement | undefined = $state();
  let replacementInputEl: HTMLInputElement | undefined = $state();

  function syncFromState() {
    const editor = editorBridge.instance;
    if (!editor) return;
    const s = searchPluginKey.getState(editor.state);
    matchCount = s?.matches.length ?? 0;
    activeIndex = s?.activeIndex ?? -1;
  }

  function scrollToActive() {
    const editor = editorBridge.instance;
    if (!editor) return;
    const s = searchPluginKey.getState(editor.state);
    if (!s || s.activeIndex < 0) return;
    const m = s.matches[s.activeIndex];
    // Uses the same bounded slide-into-view as the outline's heading jump
    // (editorBridge.scrollToRange) rather than ProseMirror's own
    // scrollIntoView(): that one also moves the real cursor/selection,
    // which would steal focus away from the find/replace inputs.
    editorBridge.scrollToRange?.(m.from, m.to);
  }

  function dispatchQuery(q: string, idx: number) {
    const editor = editorBridge.instance;
    if (!editor) return;
    const tr = editor.state.tr.setMeta(searchPluginKey, { query: q, activeIndex: idx });
    editor.view.dispatch(tr);
    syncFromState();
    scrollToActive();
  }

  function onQueryInput() {
    dispatchQuery(query, 0);
  }

  function next() {
    if (matchCount === 0) return;
    dispatchQuery(query, (activeIndex + 1) % matchCount);
  }

  function prev() {
    if (matchCount === 0) return;
    dispatchQuery(query, (activeIndex - 1 + matchCount) % matchCount);
  }

  function replaceOne() {
    const editor = editorBridge.instance;
    if (!editor) return;
    const s = searchPluginKey.getState(editor.state);
    if (!s || s.activeIndex < 0) return;
    const m = s.matches[s.activeIndex];
    editor.chain().focus().insertContentAt({ from: m.from, to: m.to }, replacement).run();
    dispatchQuery(query, activeIndex);
  }

  function replaceAll() {
    const editor = editorBridge.instance;
    if (!editor || !query) return;
    const matches = findMatches(editor.state.doc, query);
    if (!matches.length) return;
    let tr = editor.state.tr;
    for (let i = matches.length - 1; i >= 0; i--) {
      tr = tr.insertText(replacement, matches[i].from, matches[i].to);
    }
    tr.setMeta(searchPluginKey, { query, activeIndex: 0 });
    editor.view.dispatch(tr);
    syncFromState();
  }

  function close() {
    dispatchQuery("", -1);
    query = "";
    replacement = "";
    appState.findReplaceOpen = false;
  }

  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.shiftKey ? prev() : next();
    } else if (e.key === "Escape") {
      close();
    }
  }

  $effect(() => {
    if (appState.findReplaceOpen) {
      dispatchQuery(query, 0);
    }
  });

  // Explicit focus rather than the `autofocus` attribute: the panel doesn't
  // remount when it's already open (Ctrl+F pressed again, or the toolbar
  // "replace" button clicked while the query field is focused), so a plain
  // `autofocus` would only ever fire once. Re-runs on findFocusNonce so
  // repeated Ctrl+F/Ctrl+H presses reliably move focus and reselect.
  $effect(() => {
    if (!appState.findReplaceOpen) return;
    appState.findFocusNonce;
    const target = appState.findFocusReplacement ? replacementInputEl : queryInputEl;
    target?.focus();
    target?.select();
  });
</script>

{#if appState.findReplaceOpen}
  <div class="find-replace">
    <button class="close-btn" title="关闭" aria-label="关闭" onclick={close}><Icon name="close" size={16} /></button>
    <div class="rows">
      <div class="row">
        <Icon name="search" size={14} />
        <input
          placeholder="查找"
          bind:value={query}
          bind:this={queryInputEl}
          oninput={onQueryInput}
          onkeydown={onSearchKeydown}
        />
        <span class="count">{matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : "0/0"}</span>
        <div class="nav-group">
          <button title="上一个" aria-label="上一个" onclick={prev}><Icon name="chevron-up" size={14} /></button>
          <button title="下一个" aria-label="下一个" onclick={next}><Icon name="chevron-down" size={14} /></button>
        </div>
      </div>
      <div class="row">
        <Icon name="replace" size={14} />
        <input
          placeholder="替换为"
          bind:value={replacement}
          bind:this={replacementInputEl}
          onkeydown={(e) => {
            if (e.key === "Enter") replaceOne();
          }}
        />
        <div class="nav-group">
          <button class="text-btn primary" onclick={replaceOne}>替换</button>
          <button class="text-btn primary" onclick={replaceAll}>全部替换</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .find-replace {
    position: relative;
    padding: 8px 44px 8px 14px;
    background: var(--sidebar-bg);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
  }
  .row input {
    flex: 1;
    max-width: 320px;
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 4px 8px;
    font-size: 13px;
    background: var(--content-bg);
    color: var(--text-primary);
    outline: none;
  }
  .row input:focus {
    border-color: var(--accent);
  }
  .count {
    font-size: 12px;
    min-width: 42px;
    text-align: center;
  }
  /* Groups prev/next (or replace/replace-all) into one visual unit instead
     of two buttons floating loose in the row. */
  .nav-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .row button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: transparent;
    color: var(--text-primary);
    border-radius: 5px;
    cursor: pointer;
  }
  .row button:hover {
    background: var(--hover-bg);
    color: var(--accent);
  }
  .row button.text-btn {
    width: auto;
    height: 26px;
    padding: 0 10px;
    font-size: 12.5px;
    font-weight: 500;
    border: 1px solid var(--border);
  }
  .row button.text-btn.primary {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .row button.text-btn.primary:hover {
    background: var(--accent);
    color: #fff;
    filter: brightness(1.1);
  }
  /* Pinned to the panel's top-right corner (spanning both rows) rather than
     living inline at the end of the query row — bigger target, and its
     position no longer shifts depending on whether the replace row wraps. */
  .close-btn {
    position: absolute;
    top: 8px;
    right: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 6px;
    cursor: pointer;
  }
  .close-btn:hover {
    background: var(--hover-bg);
    color: var(--text-primary);
  }
</style>
