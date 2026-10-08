<script lang="ts">
  import { emojiSprite } from "$lib/emoji/sprites";
  let { emoji, revision = 0 }: { emoji: string; revision?: number } = $props();
  let sprite = $derived.by(() => { revision; return emojiSprite(emoji); });
</script>

{#if sprite}
  <span class="sprite" aria-hidden="true" style={`background-image:url("${sprite.url}");background-position:${sprite.x}px ${sprite.y}px;background-size:${sprite.width}px ${sprite.height}px`}></span>
{:else}
  <span aria-hidden="true">{emoji}</span>
{/if}

<style>
  .sprite { display: block; width: 32px; height: 32px; flex: 0 0 32px; background-repeat: no-repeat; pointer-events: none; }
</style>
