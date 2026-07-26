<script lang="ts">
  import { appState } from "$lib/appState.svelte";
</script>

{#if appState.pendingClose}
  <div class="overlay">
    <div class="dialog">
      {#if appState.pendingClose.missing}
        <p>该文件在其他地方已被删除，是否另存为新文件？</p>
        <div class="actions">
          <button onclick={() => appState.resolvePendingClose("cancel")}>取消</button>
          <button class="danger" onclick={() => appState.resolvePendingClose("discard")}>直接关闭</button>
          <button class="primary" onclick={() => appState.resolvePendingClose("save")}>另存为</button>
        </div>
      {:else}
        <p>文件尚未保存，是否保存更改？</p>
        <div class="actions">
          <button onclick={() => appState.resolvePendingClose("cancel")}>取消</button>
          <button class="danger" onclick={() => appState.resolvePendingClose("discard")}>舍弃</button>
          <button class="primary" onclick={() => appState.resolvePendingClose("save")}>保存</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if appState.pendingDelete}
  <div class="overlay">
    <div class="dialog">
      <p>
        确定要删除{appState.pendingDelete.isDir ? "文件夹" : "文件"} “{appState.pendingDelete.name}”
        吗？此操作不可撤销。
      </p>
      <div class="actions">
        <button onclick={() => appState.resolvePendingDelete(false)}>取消</button>
        <button class="danger" onclick={() => appState.resolvePendingDelete(true)}>删除</button>
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
