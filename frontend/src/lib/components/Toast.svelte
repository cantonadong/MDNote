<script lang="ts">
  import { appState } from "$lib/appState.svelte";
</script>

{#if appState.toast}
  <div class="toast">{appState.toast}</div>
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
</style>
