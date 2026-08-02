<script lang="ts">
  import Icon from "./Icon.svelte";
  import { GRAYSCALE_ROW, COLOR_ROWS } from "$lib/editor/highlightPalette";
  import { t } from "$lib/i18n.svelte";

  let {
    x,
    y,
    current = null,
    onPick,
  }: {
    x: number;
    y: number;
    current: string | null;
    onPick: (color: string | null) => void;
  } = $props();

  let customInput: HTMLInputElement = $state()!;

  function onCustomChange(e: Event) {
    onPick((e.target as HTMLInputElement).value);
  }
</script>

<div
  class="highlight-picker"
  style={`left:${x}px; top:${y}px;`}
  onclick={(e) => e.stopPropagation()}
  role="presentation"
>
  <button class="none-row" class:active={current === null} onclick={() => onPick(null)}>
    <Icon name="ban" size={15} />
    <span>{t("editor.highlightNone")}</span>
  </button>
  <div class="swatch-row">
    {#each GRAYSCALE_ROW as color (color)}
      <button
        class="swatch"
        class:active={current === color}
        style={`background:${color}`}
        title={color}
        aria-label={color}
        onclick={() => onPick(color)}
      ></button>
    {/each}
  </div>
  {#each COLOR_ROWS as row, i (i)}
    <div class="swatch-row">
      {#each row as color (color)}
        <button
          class="swatch"
          class:active={current === color}
          style={`background:${color}`}
          title={color}
          aria-label={color}
          onclick={() => onPick(color)}
        ></button>
      {/each}
    </div>
  {/each}
  <div class="custom-row">
    <span class="custom-label">{t("editor.highlightCustom")}</span>
    <button class="custom-btn" onclick={() => customInput?.click()} title={t("editor.highlightCustom")}>
      <Icon name="plus" size={14} />
    </button>
    <input
      type="color"
      bind:this={customInput}
      class="native-color-input"
      value={current ?? "#ffff00"}
      onchange={onCustomChange}
    />
  </div>
</div>

<style>
  .highlight-picker {
    position: fixed;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    background: var(--content-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  }
  .none-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text-primary);
    font-size: 13px;
    cursor: pointer;
    margin-bottom: 2px;
  }
  .none-row:hover,
  .none-row.active {
    background: var(--hover-bg);
  }
  .swatch-row {
    display: flex;
    gap: 4px;
  }
  .swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.1);
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
  }
  .swatch:hover {
    transform: scale(1.15);
  }
  .swatch.active {
    box-shadow: 0 0 0 2px var(--content-bg), 0 0 0 4px var(--accent);
  }
  .custom-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  .custom-label {
    font-size: 12.5px;
    color: var(--text-secondary);
    flex: 1;
  }
  .custom-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .custom-btn:hover {
    background: var(--hover-bg);
    color: var(--text-primary);
  }
  .native-color-input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
</style>
