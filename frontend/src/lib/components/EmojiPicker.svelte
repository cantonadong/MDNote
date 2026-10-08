<script lang="ts">
  import { onMount, tick } from "svelte";
  import EmojiGlyph from "./EmojiGlyph.svelte";
  import { preloadEmojiSprites } from "$lib/emoji/sprites";
  import { appState } from "$lib/appState.svelte";
  import { cachedRecentEmojis, preloadRecentEmojis, rememberEmoji } from "$lib/emoji/recent";
  import { t } from "$lib/i18n.svelte";
  import { emojiFont, pickerPosition, cachedEmojiGroups, supportedEmojiGroups, type EmojiGroup } from "$lib/emoji/catalogue";

  let { anchor, current = "", onPick, onClose }: {
    anchor: HTMLElement;
    current?: string;
    onPick: (emoji: string) => Promise<void>;
    onClose: () => void;
  } = $props();

  let picker: HTMLDivElement;
  let scroller: HTMLDivElement;
  let groups = $state.raw<EmojiGroup[]>(cachedEmojiGroups());
  let recent = $state<string[]>(cachedRecentEmojis());
  let category = $state(groups.find(group => group.entries.some(entry => entry.emoji === current))?.name ?? groups[0]?.name ?? "");
  let saving = $state(false);
  let error = $state("");
  let spriteRevision = $state(0);
  const categories: Record<string, { key: string; icon: string }> = {
    "Smileys & Emotion": { key: "smileys", icon: "☺" },
    "People & Body": { key: "people", icon: "☝" },
    "Animals & Nature": { key: "nature", icon: "❀" },
    "Food & Drink": { key: "food", icon: "☕" },
    "Travel & Places": { key: "travel", icon: "✈" },
    "Activities": { key: "activities", icon: "⚽" },
    "Objects": { key: "objects", icon: "⌨" },
    "Symbols": { key: "symbols", icon: "♯" },
    "Flags": { key: "flags", icon: "⚑" },
  };
  let selected = $derived(groups.find(group => group.name === category));
  const rowHeight = 37;
  const labelHeight = 18;
  let scrollTop = $state(0);
  let viewportHeight = $state(370);
  let entries = $derived(selected?.entries ?? []);
  let rowCount = $derived(Math.ceil(entries.length / 6));
  let firstRow = $derived(Math.min(Math.max(0, rowCount - 1), Math.max(0, Math.floor((scrollTop - labelHeight) / rowHeight) - 2)));
  let endRow = $derived(Math.min(rowCount, firstRow + Math.ceil(viewportHeight / rowHeight) + 5));
  let visibleEntries = $derived(entries.slice(firstRow * 6, endRow * 6));
  let supportedRecent = $derived(recent.filter(emoji => groups.some(group => group.entries.some(entry => entry.emoji === emoji))).slice(0, 6));
  function label(name: string) { return t(`emoji.${categories[name]?.key ?? name}`); }

  function position() {
    if (!picker || !anchor.isConnected) return;
    const rect = picker.getBoundingClientRect();
    const at = pickerPosition(anchor.getBoundingClientRect(), rect.width, rect.height, window.innerWidth, window.innerHeight);
    picker.style.left = `${at.left}px`;
    picker.style.top = `${at.top}px`;
  }

  function close(restoreFocus = false) {
    if (restoreFocus) anchor.focus();
    onClose();
  }

  async function choose(emoji: string) {
    if (saving) return;
    saving = true;
    error = "";
    try { await onPick(emoji); rememberEmoji(emoji); close(true); }
    catch (reason) { error = `${t("emoji.saveFailed")}: ${reason}`; }
    finally { saving = false; }
  }

  function changeCategory(name: string) {
    if (category === name) return;
    scrollTop = 0;
    category = name;
    if (scroller) scroller.scrollTop = 0;
  }

  async function onGridKey(e: KeyboardEvent) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 };
    if (!(e.key in moves) || !(e.target instanceof HTMLButtonElement)) return;
    const grid = e.target.closest(".emoji-grid");
    if (!grid) return;
    if (e.target.dataset.index !== undefined) {
      const nextIndex = Math.max(0, Math.min(entries.length - 1, Number(e.target.dataset.index) + moves[e.key]));
      e.preventDefault();
      e.stopPropagation();
      const top = labelHeight + Math.floor(nextIndex / 6) * rowHeight;
      if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (top + 34 > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + 34 - scroller.clientHeight;
      scrollTop = scroller.scrollTop;
      await tick();
      scroller.querySelector<HTMLButtonElement>(`[data-index="${nextIndex}"]`)?.focus({ preventScroll: true });
      return;
    }
    const buttons = Array.from(grid.querySelectorAll<HTMLButtonElement>("button"));
    const index = buttons.indexOf(e.target);
    e.preventDefault();
    e.stopPropagation();
    buttons[Math.max(0, Math.min(buttons.length - 1, index + moves[e.key]))]?.focus();
  }

  onMount(() => {
    let disposed = false;
    void preloadEmojiSprites().then(() => {
      if (!disposed) spriteRevision++;
    }).catch(() => {});
    // The top layer keeps the picker above the editor and outside tree clipping.
    picker.showPopover?.();
    position();
    picker.focus();
    const observer = new ResizeObserver(position);
    observer.observe(picker);
    const viewportObserver = new ResizeObserver(() => { viewportHeight = scroller.clientHeight; });
    viewportObserver.observe(scroller);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !picker.contains(event.target) && !anchor.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close(true);
      }
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && picker.contains(event.target)) return;
      close();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", position);
    supportedEmojiGroups().then(available => {
      if (disposed) return;
      groups = available;
      if (!available.some(group => group.name === category)) category = available[0]?.name ?? "";
    }).catch(reason => {
      if (!disposed) error = `${t("emoji.loadFailed")}: ${reason}`;
    });
    preloadRecentEmojis(appState.effectiveRootDir).then(history => {
      if (!disposed) recent = history;
    }).catch(reason => {
      if (!disposed) error = `${t("emoji.loadFailed")}: ${reason}`;
    });
    return () => {
      disposed = true;
      observer.disconnect();
      viewportObserver.disconnect();
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", position);
    };
  });
</script>

<div bind:this={picker} class="emoji-picker" popover="manual" role="dialog" aria-label={t("emoji.choose")} tabindex="-1" style={`--emoji-font:${emojiFont}`} onkeydown={onGridKey}>
  <div class="picker-header">
    <span>{t("emoji.choose")}</span>
    <button class="text-button" onclick={() => close(true)} aria-label={t("emoji.close")}>×</button>
  </div>
  <section class="recent" aria-label={t("emoji.recent")}>
    <div class="section-label">{t("emoji.recent")}</div>
    {#if supportedRecent.length}
      <div class="emoji-grid">
        {#each supportedRecent as emoji (emoji)}
          <button class="emoji" class:chosen={emoji === current} disabled={saving} title={emoji} aria-label={emoji} onclick={() => choose(emoji)}><EmojiGlyph {emoji} revision={spriteRevision} /></button>
        {/each}
      </div>
    {:else}
      <div class="empty">{t("emoji.noRecent")}</div>
    {/if}
  </section>
  <div class="catalogue" bind:this={scroller} onscroll={() => scrollTop = scroller.scrollTop}>
    {#if selected}
      <div class="section-label">{label(selected.name)}</div>
      <div class="virtual-rows" style={`height:${Math.max(0, rowCount * rowHeight - 3)}px`}>
        <div class="emoji-grid visible-rows" style={`top:${firstRow * rowHeight}px`} aria-label={label(selected.name)}>
          {#each visibleEntries as entry, index}
            <button class="emoji" data-index={firstRow * 6 + index} class:chosen={entry.emoji === current} disabled={saving} title={entry.name} aria-label={entry.name} onclick={() => choose(entry.emoji)}><EmojiGlyph emoji={entry.emoji} revision={spriteRevision} /></button>
          {/each}
        </div>
      </div>
    {:else if !error}
      <div class="empty">{t("emoji.empty")}</div>
    {/if}
  </div>
  {#if error}<div class="error" role="alert">{error}</div>{/if}
  <button class="reset text-button" disabled={saving || !current} onclick={() => choose("")}>{t("emoji.reset")}</button>
  {#if groups.length > 1}
    <nav class="categories" aria-label={t("emoji.categories")}>
      {#each groups as group (group.name)}
        <button class:active={category === group.name} title={label(group.name)} aria-label={label(group.name)} aria-pressed={category === group.name} onclick={() => changeCategory(group.name)}>{categories[group.name]?.icon ?? "•"}</button>
      {/each}
    </nav>
  {/if}
</div>

<style>
  .emoji-picker {
    position: fixed;
    inset: auto;
    margin: 0;
    width: 258px;
    max-width: calc(100vw - 16px);
    max-height: min(510px, calc(100vh - 16px));
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    padding: 10px;
    gap: 8px;
    z-index: 1100;
    color: var(--text-primary);
    background: var(--content-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 6px 24px #0003;
    font-family: inherit;
    font-size: 12px;
    outline: none;
    -webkit-app-region: no-drag;
  }
  .picker-header { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 600; flex-shrink: 0; }
  button { cursor: pointer; border: 0; border-radius: 5px; background: transparent; color: inherit; }
  button:hover, button:focus-visible { background: var(--hover-bg); outline: 1px solid var(--accent); }
  button:disabled { opacity: .45; cursor: default; }
  .text-button { padding: 4px 6px; font-size: 12px; }
  .picker-header button { font-size: 19px; line-height: 18px; }
  .recent { border-bottom: 1px solid var(--border); padding-bottom: 6px; flex-shrink: 0; }
  .section-label { font-size: 11px; color: var(--text-secondary); margin: 0 2px 5px; }
  .emoji-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 3px; }
  .emoji { height: 34px; padding: 0; font: 23px/1 var(--emoji-font); display: flex; align-items: center; justify-content: center; }
  .chosen { background: var(--hover-bg); box-shadow: inset 0 0 0 1px var(--accent); }
  .catalogue { min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: thin; contain: layout paint; }
  .catalogue .section-label { height: 18px; margin: 0 2px; box-sizing: border-box; }
  .virtual-rows { position: relative; overflow-anchor: none; }
  .visible-rows { position: absolute; left: 0; right: 0; }
  .empty { color: var(--text-secondary); font-size: 12px; padding: 9px 2px; }
  .error { font-size: 12px; color: var(--text-primary); overflow-wrap: anywhere; overflow-y: auto; }
  .reset { flex-shrink: 0; text-align: left; }
  .categories { display: flex; gap: 1px; border-top: 1px solid var(--border); padding-top: 7px; flex-shrink: 0; }
  .categories button { flex: 1; min-width: 0; height: 28px; padding: 0; font-size: 17px; }
  .categories .active { background: var(--hover-bg); color: var(--accent); box-shadow: inset 0 -2px var(--accent); }
</style>
