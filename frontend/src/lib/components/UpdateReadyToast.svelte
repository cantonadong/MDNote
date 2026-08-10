<script lang="ts">
  let {
    version,
    title = "已准备升级",
    detail = `新版本 ${version} 已下载完成`,
    confirmLabel = "升级并重启",
    laterLabel = "稍后",
    onconfirm,
    onlater,
  }: {
    version: string;
    title?: string;
    detail?: string;
    confirmLabel?: string;
    laterLabel?: string;
    onconfirm?: () => void;
    onlater?: () => void;
  } = $props();
</script>

<div class="update-ready" role="status" aria-live="polite">
  <div class="update-icon" aria-hidden="true">↓</div>
  <div class="update-copy">
    <div class="update-title">{title}</div>
    <div class="update-detail">{detail}</div>
  </div>
  <div class="update-actions">
    <button class="later" onclick={onlater}>{laterLabel}</button>
    <button class="confirm" onclick={onconfirm}>{confirmLabel}</button>
  </div>
</div>

<style>
  .update-ready {
    position: fixed;
    left: 8px;
    bottom: 40px;
    z-index: 3000;
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    width: min(244px, calc(100vw - 16px));
    box-sizing: border-box;
    padding: 11px 12px;
    border: 1px solid var(--border, #dededb);
    border-radius: 8px;
    background: var(--content-bg, #fff);
    color: var(--text-primary, #37352f);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    font-family: Inter, "Microsoft YaHei UI", sans-serif;
    font-size: 13px;
  }
  .update-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: rgba(35, 131, 226, 0.12);
    color: #2383e2;
    font-size: 19px;
    font-weight: 700;
  }
  .update-copy { min-width: 0; }
  .update-title { font-weight: 600; margin-bottom: 2px; }
  .update-detail { color: var(--text-secondary, #787774); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .update-actions { grid-column: 1 / -1; display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
  button { border: none; border-radius: 5px; padding: 6px 9px; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
  button.later { background: var(--hover-bg, #f1f1ef); color: var(--text-primary, #37352f); }
  button.confirm { background: #2383e2; color: #fff; }
  button:hover { filter: brightness(0.96); }
</style>
