<script lang="ts">
  import { onMount } from "svelte";
  import { Editor } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";
  import { Table, TableCell, TableHeader } from "$lib/editor/nodes/table";
  import { TableRow } from "@tiptap/extension-table-row";
  type Cell = { row: number; col: number; value: string; kind?: "link" };
  type Point = { row: number; col: number };

  const rows: Cell[][] = [
    [
      { row: 0, col: 0, value: "短文本" },
      { row: 0, col: 1, value: "一段很长的内容，用来验证内容区只跟随文字宽度，而不会占满整个单元格" },
      { row: 0, col: 2, value: "链接", kind: "link" },
    ],
    [
      { row: 1, col: 0, value: "第一行\n第二行" },
      { row: 1, col: 1, value: "" },
      { row: 1, col: 2, value: "22" },
    ],
    [
      { row: 2, col: 0, value: "31" },
      { row: 2, col: 1, value: "2133333333333333333333333333333" },
      { row: 2, col: 2, value: "32" },
    ],
  ];

  let table: HTMLTableElement;
  let anchor = $state<Point | null>(null);
  let head = $state<Point | null>(null);
  let dragging = $state(false);
  let debug = $state(true);
  let outline = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  let actualEditor: HTMLElement;
  let editableLineCount = $state(0);

  onMount(() => {
    const editor = new Editor({
      element: actualEditor,
      extensions: [StarterKit, Table, TableRow, TableHeader, TableCell],
      content: {
        type: "doc",
        content: [{
          type: "table",
          content: [
            ["11", "12", "13"], ["21", "22", "23"], ["31", "32", "33"],
          ].map((values, row) => ({
            type: "tableRow",
            content: values.map((value) => ({
              type: row === 0 ? "tableHeader" : "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
            })),
          })),
        }],
      },
    });
    requestAnimationFrame(() => {
      editableLineCount = actualEditor.querySelectorAll("td p, th p").length;
    });
    return () => editor.destroy();
  });

  function insideSelection(row: number, col: number) {
    if (!anchor || !head) return false;
    return row >= Math.min(anchor.row, head.row) && row <= Math.max(anchor.row, head.row)
      && col >= Math.min(anchor.col, head.col) && col <= Math.max(anchor.col, head.col);
  }

  function pointOf(cell: Element | null): Point | null {
    const td = cell?.closest?.("td") as HTMLTableCellElement | null;
    if (!td || !table.contains(td)) return null;
    return { row: Number(td.dataset.row), col: Number(td.dataset.col) };
  }

  function updateOutline() {
    requestAnimationFrame(() => {
      const selected = Array.from(table?.querySelectorAll<HTMLTableCellElement>("td.selected") ?? []);
      if (!selected.length) return void (outline = null);
      const host = table.parentElement!.getBoundingClientRect();
      const rects = selected.map((cell) => cell.getBoundingClientRect());
      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      outline = { left: left - host.left, top: top - host.top, width: right - left, height: bottom - top };
    });
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    // Content owns the complete gesture. Do not prevent the native caret or
    // text selection, and do not start cell selection later on pointermove.
    if (target.closest(".cell-content")) return;
    const point = pointOf(target);
    if (!point) return;
    event.preventDefault();
    anchor = point;
    head = point;
    dragging = true;
    table.setPointerCapture(event.pointerId);
    updateOutline();
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    const point = pointOf(document.elementFromPoint(event.clientX, event.clientY));
    if (!point || (head?.row === point.row && head?.col === point.col)) return;
    head = point;
    updateOutline();
  }

  function finishPointer(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    if (table.hasPointerCapture(event.pointerId)) table.releasePointerCapture(event.pointerId);
    updateOutline();
  }
</script>

<svelte:head><title>表格单元格命中区域 Preview</title></svelte:head>

<main>
  <header>
    <div>
      <h1>表格内容区 / 边缘区 Preview</h1>
      <p>文字上是 I 型光标，可编辑和选择；单元格其余留白是箭头，可点击或拖动选择单元格。</p>
    </div>
    <label><input type="checkbox" bind:checked={debug} /> 显示命中区域</label>
  </header>

  <div class="legend">
    <span><i class="content-swatch"></i>内容区</span>
    <span><i class="edge-swatch"></i>边缘区</span>
    <span><i class="selection-swatch"></i>单元格选区</span>
  </div>

  <section class:debug>
    <table bind:this={table} onpointerdown={onPointerDown} onpointermove={onPointerMove} onpointerup={finishPointer} onpointercancel={finishPointer}>
      <tbody>
        {#each rows as row}
          <tr>
            {#each row as cell}
              <td data-row={cell.row} data-col={cell.col} class:selected={insideSelection(cell.row, cell.col)}>
                {#if cell.kind === "link"}
                  <a class="cell-content" href="#preview" onclick={(e) => e.preventDefault()}>{cell.value}</a>
                {:else}
                  <span class="cell-content" class:empty={!cell.value} contenteditable="true">{cell.value}</span>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if outline}<div class="selection-outline" style={`left:${outline.left}px;top:${outline.top}px;width:${outline.width}px;height:${outline.height}px`}></div>{/if}
  </section>

  <aside>
    <strong>请重点验证：</strong>长文本内拖选不会变成单元格选择；空白处按下后横向、纵向、斜向拖动均形成矩形选区；空单元格中央的小内容区仍能放置光标。
  </aside>

  <h2>真实 Tiptap Table 扩展</h2>
  <p class="actual-status">实际可编辑行数量：<strong>{editableLineCount}</strong>（应为 9）</p>
  <section class="actual-editor" bind:this={actualEditor}></section>
</main>

<style>
  :global(body) { margin: 0; background: #f7f7f5; color: #37352f; font-family: Inter, "Microsoft YaHei UI", sans-serif; }
  main { max-width: 1080px; margin: 0 auto; padding: 34px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  h1 { margin: 0 0 8px; font-size: 24px; }
  p { margin: 0; color: #787774; font-size: 14px; }
  label { white-space: nowrap; font-size: 13px; }
  .legend { display: flex; gap: 20px; margin: 24px 0 10px; font-size: 13px; color: #666; }
  .legend span { display: flex; align-items: center; gap: 6px; }
  .legend i { width: 16px; height: 12px; border-radius: 2px; }
  .content-swatch { background: rgba(245, 159, 0, .18); border: 1px dashed #e67700; }
  .edge-swatch { background: white; border: 1px solid #ddd; }
  .selection-swatch { background: rgba(35, 131, 226, .13); border: 2px solid #2383e2; }
  section { position: relative; background: white; overflow: auto; border: 1px solid #dededb; }
  table { width: 100%; min-width: 840px; border-collapse: collapse; table-layout: fixed; user-select: none; }
  td { position: relative; height: 82px; padding: 14px 16px; border: 1px solid #dededb; vertical-align: top; cursor: default; box-sizing: border-box; }
  td.selected { background: rgba(35, 131, 226, .13); }
  .cell-content { display: inline; white-space: pre-wrap; line-height: 28px; font-size: 18px; cursor: text; user-select: text; outline: none; }
  /* An empty cell has no glyph rectangle to hit, so its full inner line is
     the editable region; only the padding around that line is edge area. */
  .cell-content.empty { display: block; width: 100%; min-height: 28px; }
  a.cell-content { color: #2383e2; text-decoration: underline; }
  .debug .cell-content { background: rgba(245, 159, 0, .14); outline: 1px dashed #e67700; }
  .selection-outline { position: absolute; z-index: 3; box-sizing: border-box; border: 2px solid #2383e2; pointer-events: none; }
  aside { margin-top: 18px; padding: 14px 16px; border-radius: 6px; background: white; border: 1px solid #dededb; font-size: 13px; line-height: 1.7; }
  h2 { margin: 34px 0 6px; font-size: 18px; }
  .actual-status { margin-bottom: 10px; }
  .actual-editor { padding: 0; }
  .actual-editor :global(.ProseMirror) { outline: none; }
  .actual-editor :global(table) { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .actual-editor :global(td), .actual-editor :global(th) { height: 56px; padding: 6px 10px; border: 1px solid #dededb; cursor: default; vertical-align: top; }
  .actual-editor :global(p) { margin: .4em 0; }
  .actual-editor :global(td p), .actual-editor :global(th p) { cursor: text; background: rgba(245, 159, 0, .14); outline: 1px dashed #e67700; }
  .actual-editor :global(.selectedCell) { background: rgba(35, 131, 226, .13); }
</style>
