<script lang="ts">
  import UpdateReadyToast from "$lib/components/UpdateReadyToast.svelte";
  let visible = $state(true);
</script>

<svelte:head><title>自动更新提示 Preview</title></svelte:head>

<main>
  <h1>自动更新提示 Preview</h1>
  <p>模拟后台下载已完成。提示固定在窗口左下角、状态栏上方。</p>
  <button onclick={() => (visible = true)}>重新显示提示</button>
  <div class="mock-editor">
    <aside>MDNote<br /><span>笔记目录</span></aside>
    <article><h2>示例笔记</h2><p>后台下载期间界面不显示进度，也不阻塞编辑。</p></article>
  </div>
</main>

{#if visible}
  <UpdateReadyToast
    version="1.6"
    onconfirm={() => alert("确认：生产版将退出、替换 exe 并重启")}
    onlater={() => (visible = false)}
  />
{/if}

<style>
  :global(body) { margin: 0; background: #fff; color: #37352f; font-family: Inter, "Microsoft YaHei UI", sans-serif; }
  main { padding: 34px; }
  h1 { margin: 0 0 8px; font-size: 24px; }
  p { color: #787774; }
  main > button { border: 1px solid #dededb; border-radius: 6px; background: #fff; padding: 7px 12px; cursor: pointer; }
  .mock-editor { display: flex; height: 520px; margin-top: 24px; border: 1px solid #dededb; }
  aside { width: 220px; padding: 18px; background: #f7f7f5; border-right: 1px solid #dededb; font-weight: 600; }
  aside span { display: block; margin-top: 18px; color: #787774; font-size: 13px; font-weight: 400; }
  article { flex: 1; padding: 44px; }
  article h2 { margin-top: 0; }
</style>
