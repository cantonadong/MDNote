<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Editor } from "@tiptap/core";
  import { TextSelection } from "@tiptap/pm/state";
  import StarterKit from "@tiptap/starter-kit";
  import { Markdown } from "tiptap-markdown";
  import { Placeholder } from "@tiptap/extensions";
  import { TaskList } from "@tiptap/extension-task-list";
  import { TaskItem } from "@tiptap/extension-task-item";
  import { Table } from "@tiptap/extension-table";
  import { TableRow } from "@tiptap/extension-table-row";
  import { TableHeader } from "@tiptap/extension-table-header";
  import { TableCell } from "@tiptap/extension-table-cell";
  import Icon from "./Icon.svelte";
  import { api } from "$lib/api";
  import { appState, type LinkPick } from "$lib/appState.svelte";
  import { editorBridge } from "$lib/editor/bridge.svelte";
  import { buildOutline } from "$lib/editor/outline";
  import { countWords } from "$lib/wordcount";
  import { SearchHighlight } from "$lib/editor/searchHighlight";
  import { ToggleList, ToggleSummary } from "$lib/editor/nodes/toggleList";
  import { Callout } from "$lib/editor/nodes/callout";
  import { PageLink, FileLink, LinkClickHandler } from "$lib/editor/nodes/links";
  import { SlashTrigger } from "$lib/editor/nodes/slashTrigger";
  import { FullwidthHeadingShortcut } from "$lib/editor/nodes/fullwidthShortcuts";
  import { slashMenuState } from "$lib/editor/slashMenu.svelte";

  let element: HTMLDivElement;
  let wrapperEl: HTMLDivElement;
  let scrollEl: HTMLDivElement;
  let editor: Editor | null = null;
  let switching = false;
  let debounceHandle: ReturnType<typeof setTimeout> | null = null;
  let lastTabId: string | null = null;

  let handleTop = $state<number | null>(null);
  let handleHeight = $state(24);
  let menuOpen = $state(false);
  let slashPos = $state({ top: 0, left: 0 });
  // Icon name for the "+" handle: null (generic plus) for a plain paragraph,
  // or the matching blockTypes icon when the hovered/cursor block already
  // has a real format — see updateHandle(), which keeps this in sync with
  // handleTop/handleHeight.
  let handleFormatIcon = $state<string | null>(null);
  // Ctrl+wheel content zoom, percent — applied to wrapperEl itself
  // (.editor-content-col-wrapper) so its own max-width/padding scale too,
  // genuinely widening the reading column rather than just cramming bigger
  // text into a column pinned at 1000px. The handle-group/block-menu/
  // slash-menu/drop-indicator overlays are also descendants of wrapperEl
  // (needed so they scroll with the content), which has a side effect: CSS
  // zoom rescales every length inside its subtree, so an already-real-pixel
  // top/left computed via getBoundingClientRect() and written as an inline
  // style on one of those overlays would get rescaled a *second* time by
  // the browser, drifting off position as soon as zoom leaves 100%. Every
  // such inline style divides by zoomScale to cancel that out — see the
  // template below.
  let editorZoom = $state(100);
  let zoomScale = $derived(editorZoom / 100);
  const ZOOM_MIN = 50;
  const ZOOM_MAX = 150;
  const ZOOM_STEP = 10;

  function onEditorWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    editorZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, editorZoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)));
  }

  function resetZoom() {
    editorZoom = 100;
  }

  // Ctrl+=/Ctrl+- step the zoom the same as Ctrl+wheel; Ctrl+0 resets. Also
  // prevents WebView2's own page-zoom shortcut from firing on the same keys.
  // Escape also lives here (rather than gated behind the ctrlKey check below)
  // to drop an active margin drag-select.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && multiSelectRange) {
      clearMultiSelect();
      return;
    }
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code === "Equal" || e.code === "NumpadAdd") {
      e.preventDefault();
      editorZoom = Math.min(ZOOM_MAX, editorZoom + ZOOM_STEP);
    } else if (e.code === "Minus" || e.code === "NumpadSubtract") {
      e.preventDefault();
      editorZoom = Math.max(ZOOM_MIN, editorZoom - ZOOM_STEP);
    } else if (e.code === "Digit0" || e.code === "Numpad0") {
      e.preventDefault();
      resetZoom();
    }
  }

  // The block currently under the mouse — drives both handle icons ("+" and
  // the drag grip). Falls back to the text-cursor's block when the mouse
  // isn't over the content area (e.g. handle still visible right after a
  // keyboard-driven cursor move). Plain (non-reactive) since only imperative
  // drag/handle-position code reads it; nothing in the template binds to it
  // directly.
  let hoverBlockPos: number | null = null;
  // The mouse's raw Y, used only to pick which visual line of a tall
  // multi-line block (a long toggle, a table, a code block) the handle
  // should sit next to — see lineRectNear(). Deliberately not a resolved
  // document position: resolving the exact character under the mouse and
  // asking ProseMirror for its rect was the previous approach, but a
  // position with no real text under it (a bullet-list marker sits outside
  // the actual text run) resolves to a boundary text offset whose reported
  // rect can differ by a few px from a same-line mid-text position's rect,
  // making the handle visibly jitter as the mouse moves purely
  // horizontally within what's actually one unchanging line.
  let hoverClientY: number | null = null;

  // Types that need an async pick/create step (file dialog or a new file on
  // disk) before there's anything to insert.
  const ASYNC_KEYS = new Set(["pageLink", "fileLink", "newPage"]);

  const blockTypes = [
    { key: "paragraph", label: "文本", icon: "text", keywords: ["text", "paragraph"] },
    { key: "h1", label: "标题 1", icon: "h1", keywords: ["h1", "heading1", "title1"] },
    { key: "h2", label: "标题 2", icon: "h2", keywords: ["h2", "heading2", "title2"] },
    { key: "h3", label: "标题 3", icon: "h3", keywords: ["h3", "heading3", "title3"] },
    { key: "h4", label: "标题 4", icon: "h4", keywords: ["h4", "heading4", "title4"] },
    { key: "bulletList", label: "项目列表", icon: "list-bullet", keywords: ["bullet", "list", "ul"] },
    { key: "orderedList", label: "编号列表", icon: "list-ordered", keywords: ["number", "ordered", "ol"] },
    { key: "taskList", label: "待办列表", icon: "check-square", keywords: ["todo", "task", "checkbox"] },
    { key: "toggleList", label: "折叠列表", icon: "toggle", keywords: ["toggle", "collapse", "details"] },
    { key: "callout", label: "高亮块", icon: "megaphone", keywords: ["callout", "note", "highlight"] },
    { key: "blockquote", label: "引用", icon: "quote", keywords: ["quote", "blockquote"] },
    { key: "codeBlock", label: "代码块", icon: "code", keywords: ["code", "codeblock"] },
    { key: "table", label: "表格", icon: "table", keywords: ["table"] },
    { key: "horizontalRule", label: "分割线", icon: "minus", keywords: ["hr", "divider", "line"] },
    { key: "newPage", label: "新建页面", icon: "page", keywords: ["page", "newpage"] },
    { key: "pageLink", label: "页面链接", icon: "link", keywords: ["pagelink", "link"] },
    { key: "fileLink", label: "文件链接", icon: "link", keywords: ["filelink", "file"] },
  ];

  // Which blockTypes key a real ProseMirror node corresponds to — null for a
  // plain paragraph, which isn't considered to "have a format" (the handle
  // shows the generic "+" for it, same as always). Used both to pick the
  // handle's icon and to decide whether clicking a menu item should convert
  // the block in place instead of inserting a new one after it.
  function blockTypeKeyFor(node: import("@tiptap/pm/model").Node | null | undefined): string | null {
    if (!node) return null;
    switch (node.type.name) {
      case "heading":
        return `h${node.attrs.level}`;
      case "bulletList":
      case "orderedList":
      case "taskList":
      case "toggleList":
      case "callout":
      case "blockquote":
      case "codeBlock":
      case "table":
      case "horizontalRule":
        return node.type.name;
      default:
        return null;
    }
  }

  let slashItems = $derived.by(() => {
    const q = slashMenuState.query.trim().toLowerCase();
    if (!q) return blockTypes;
    return blockTypes.filter(
      (bt) => bt.label.toLowerCase().includes(q) || bt.keywords.some((k) => k.includes(q)),
    );
  });

  $effect(() => {
    slashMenuState.itemCount = slashItems.length;
  });

  function syncFromEditor() {
    if (!editor) return;
    const md = (editor.storage as any).markdown.getMarkdown();
    appState.updateActiveContent(md);
    refreshDerivedState();
  }

  // Outline/word-count only, without touching tab.content. Used right after
  // loading/switching a tab: re-serializing the freshly-parsed markdown here
  // too would overwrite tab.content with tiptap-markdown's round-tripped
  // text (which can differ from the file's original formatting in minor,
  // harmless ways — list marker style, heading spacing, trailing newlines),
  // making an untouched, just-opened file look dirty against tab.savedContent
  // even though the user hasn't typed anything.
  function refreshDerivedState() {
    if (!editor) return;
    appState.outlineItems = buildOutline(editor);
    appState.wordCount = countWords(editor.getText());
  }

  function scheduleSync() {
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(syncFromEditor, 200);
  }

  function topLevelBlockPos(): number | null {
    if (!editor) return null;
    const { $from: sel } = editor.state.selection;
    if (sel.depth < 1) return null;
    return sel.before(1);
  }

  function updateHandle() {
    if (!editor || !wrapperEl) {
      if (!menuOpen) handleTop = null;
      return;
    }
    // Edits shift/invalidate positions; drop a stale hover target instead of
    // resolving garbage (nodeAt on an out-of-range pos just returns null, but
    // doc.resolve on one throws).
    if (hoverBlockPos !== null) {
      const size = editor.state.doc.content.size;
      if (hoverBlockPos < 0 || hoverBlockPos > size || !editor.state.doc.nodeAt(hoverBlockPos)) {
        hoverBlockPos = null;
        hoverClientY = null;
      }
    }
    const pos = hoverBlockPos !== null ? hoverBlockPos : editor.isFocused ? topLevelBlockPos() : null;
    if (pos === null) {
      if (!menuOpen) handleTop = null;
      return;
    }
    const formatKey = blockTypeKeyFor(editor.state.doc.nodeAt(pos));
    handleFormatIcon = formatKey ? (blockTypes.find((bt) => bt.key === formatKey)?.icon ?? null) : null;
    const lineRect = lineRectNear(pos, hoverClientY);
    if (!lineRect) {
      handleTop = null;
      return;
    }
    const containerRect = wrapperEl.getBoundingClientRect();
    handleTop = lineRect.top - containerRect.top;
    handleHeight = Math.max(24, lineRect.bottom - lineRect.top);
  }

  // Finds the actual rendered line box the handle should sit next to. A
  // Range over the block's DOM content fragments into one client rect per
  // wrapped visual line (unlike Element.getClientRects(), which reports one
  // rect for the whole box); picking whichever rect vertically contains
  // mouseY is what keeps a tall multi-line block's handle next to the
  // hovered line instead of always the block's top. Falls back to the
  // block's own bounding rect for an empty block (no text to fragment) or
  // when mouseY isn't available (keyboard-cursor fallback, or nothing
  // matched — e.g. mouse hovering the block's own bottom margin).
  function lineRectNear(pos: number, mouseY: number | null): { top: number; bottom: number } | null {
    if (!editor) return null;
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!dom) return null;
    const range = document.createRange();
    range.selectNodeContents(dom);
    const rects = Array.from(range.getClientRects());
    if (mouseY !== null) {
      for (const r of rects) {
        if (mouseY >= r.top && mouseY <= r.bottom) return { top: r.top, bottom: r.bottom };
      }
    }
    if (rects.length > 0) {
      const first = rects[0];
      return { top: first.top, bottom: first.bottom };
    }
    if (typeof dom.getBoundingClientRect !== "function") return null;
    const rect = dom.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { top: rect.top, bottom: rect.top + Math.min(rect.height, 24) };
  }

  // -- Block drag-reorder state (read by the hover handlers just below,
  // populated by the drag handlers further down) --
  let dragSource: { from: number; to: number } | null = null;
  let dropTargetPos: number | null = null;
  let dropPosition: "before" | "after" = "after";
  // Full-width blue bar marking exactly where the dragged block will land —
  // wrapper-relative Y, same coordinate space as handleTop. A real
  // absolutely-positioned overlay element (like the handle group) rather
  // than a ::before/::after pseudo-element glued onto the target block's
  // own DOM node: the target can be a <p>, <h2>, <ul>, a table cell, a code
  // block with its own overflow/scroll box, etc., and trusting every one of
  // those element types to render an attached pseudo-element the same way
  // is fragile — this way the indicator's geometry is computed once, the
  // same way for every block type, same as the handle already is.
  let dropIndicatorTop = $state<number | null>(null);
  // The landing row itself, highlighted the same rounded-row way as a
  // margin drag-select (see .row-highlight below and multiSelectRects
  // above) — the thin line alone marks *where* the block will land but not
  // *which existing row* it's landing next to, which is less obvious for a
  // document with many short/blank lines close together.
  let dropTargetRect = $state<{ top: number; height: number } | null>(null);
  // Floating label that follows the pointer during a block drag — the
  // source block itself just dims in place (.block-drag-source), which on
  // its own doesn't read as "something is being carried" once the pointer
  // has moved away from it. Mirrors the sidebar tree's dragGhost.
  let blockDragGhost = $state<{ text: string; x: number; y: number } | null>(null);

  // -- Multi-block selection: drag in the margin to select whole rows --
  //
  // A real ProseMirror TextSelection spanning [from, to) (both always block
  // boundaries), so native Backspace/Delete/Ctrl+C/Ctrl+X already act on the
  // whole range for free — no custom clipboard/delete code needed. The
  // native selection's own visual is hidden (see .multiselect-active
  // ::selection below) since it can't render the rounded per-row highlight
  // the design calls for; multiSelectRects (one rect per covered top-level
  // block, wrapper-relative like handleTop/dropIndicatorTop) drives that
  // instead.
  let multiSelectRange = $state<{ from: number; to: number } | null>(null);
  let multiSelectRects = $state<{ top: number; height: number }[]>([]);
  // True only while a selected group is being dragged to a new spot — dims
  // the row overlays the same way a single dragged block dims itself, so it
  // reads as "picked up" instead of just sitting there unselected-looking.
  let multiSelectDragging = $state(false);
  // Set right before we dispatch our own setTextSelection so the
  // onSelectionUpdate handler below can tell "we just finalized a drag-select"
  // apart from "the user clicked/typed elsewhere", which should clear it.
  let applyingMultiSelectSelection = false;

  // Same clamped posAtCoords→block-position resolution used by
  // updateDropTarget/onContentMouseMove, extracted since the margin-drag
  // selection needs it too and duplicating it a third time invites drift.
  function blockPosAtClientPoint(clientX: number, clientY: number): number | null {
    if (!editor) return null;
    const box = editor.view.dom.getBoundingClientRect();
    const x = Math.min(Math.max(clientX, box.left + 1), box.right - 1);
    const y = Math.min(Math.max(clientY, box.top + 1), box.bottom - 1);
    const result = editor.view.posAtCoords({ left: x, top: y });
    if (!result) return null;
    const resolved = editor.state.doc.resolve(result.pos);
    if (resolved.depth < 1) return null;
    return resolved.before(1);
  }

  function updateMultiSelectRects() {
    if (!editor || !wrapperEl || !multiSelectRange) {
      multiSelectRects = [];
      return;
    }
    const { from, to } = multiSelectRange;
    const containerRect = wrapperEl.getBoundingClientRect();
    const rects: { top: number; height: number }[] = [];
    editor.state.doc.forEach((node, offset) => {
      const nodeTo = offset + node.nodeSize;
      if (nodeTo <= from || offset >= to) return;
      const dom = editor!.view.nodeDOM(offset) as HTMLElement | null;
      if (!dom) return;
      const rect = dom.getBoundingClientRect();
      rects.push({ top: rect.top - containerRect.top, height: rect.height });
    });
    multiSelectRects = rects;
  }

  // anchorPos/currentPos are whichever end of the drag the pointer started
  // and currently sits at — order doesn't matter, the range always spans the
  // full nodes at both ends regardless of drag direction (up or down).
  function setMultiSelectRange(anchorPos: number, currentPos: number) {
    if (!editor) return;
    const lowPos = Math.min(anchorPos, currentPos);
    const highPos = Math.max(anchorPos, currentPos);
    const highNode = editor.state.doc.nodeAt(highPos);
    const to = highNode ? highPos + highNode.nodeSize : highPos;
    multiSelectRange = { from: lowPos, to };
    updateMultiSelectRects();
  }

  function clearMultiSelect() {
    multiSelectRange = null;
    multiSelectRects = [];
    multiSelectDragging = false;
  }

  // Backs the visual selection with a real one so Backspace/Delete/Ctrl+C/
  // Ctrl+X act on the whole group — see the note on multiSelectRange above.
  function finalizeMultiSelect() {
    if (!editor || !multiSelectRange) return;
    applyingMultiSelectSelection = true;
    editor.chain().focus().setTextSelection(multiSelectRange).run();
  }

  function countBlocksInRange(range: { from: number; to: number }): number {
    if (!editor) return 0;
    let count = 0;
    editor.state.doc.forEach((node, offset) => {
      const nodeTo = offset + node.nodeSize;
      if (nodeTo <= range.from || offset >= range.to) return;
      count++;
    });
    return count;
  }

  const MULTISELECT_DRAG_THRESHOLD = 4;

  // Starts a margin drag-select: mousedown anywhere in the wrapper's own
  // padding/margin (not on real content or one of the floating overlays)
  // that moves past a threshold before release selects every whole block
  // the pointer has crossed, Notion-style. A plain click (no movement)
  // instead just clears whatever selection was already showing, matching
  // "click elsewhere to deselect".
  function onMarginPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !editor) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.(".tiptap, .handle-group, .block-menu, .block-drag-ghost, .block-drop-indicator")) return;
    const anchorPos = blockPosAtClientPoint(e.clientX, e.clientY);
    if (anchorPos === null) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    function onMove(ev: PointerEvent) {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < MULTISELECT_DRAG_THRESHOLD) return;
        started = true;
      }
      const currentPos = blockPosAtClientPoint(ev.clientX, ev.clientY);
      if (currentPos === null) return;
      setMultiSelectRange(anchorPos!, currentPos);
      ev.preventDefault();
    }

    function finish() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (started) {
        finalizeMultiSelect();
      } else {
        clearMultiSelect();
      }
    }

    function onUp() {
      finish();
    }

    function onCancel() {
      finish();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  function labelForDraggedBlock(node: import("@tiptap/pm/model").Node): string {
    const text = node.textContent.trim();
    if (text) return text.length > 40 ? `${text.slice(0, 40)}…` : text;
    const key = blockTypeKeyFor(node);
    return blockTypes.find((bt) => bt.key === key)?.label ?? "内容块";
  }

  // -- Hover tracking: which top-level block is the mouse currently over --

  function onContentMouseMove(e: MouseEvent) {
    // While the "+"/format menu is open, freeze the handle (and the menu
    // anchored under it) at whatever block it was opened for — otherwise
    // moving the mouse anywhere in the content area (including toward the
    // menu itself, which sits outside the contenteditable region) keeps
    // re-resolving hoverBlockPos/hoverClientY to wherever the cursor
    // currently is, making the menu visibly drift up/down as updateHandle()
    // recomputes handleTop underneath it.
    if (!editor || dragSource || menuOpen) return;
    const result = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (!result) return;
    const resolved = editor.state.doc.resolve(result.pos);
    if (resolved.depth < 1) return;
    const pos = resolved.before(1);
    hoverClientY = e.clientY;
    if (pos !== hoverBlockPos) {
      hoverBlockPos = pos;
    }
    updateHandle();
  }

  function onContentMouseLeave() {
    if (dragSource) return;
    hoverBlockPos = null;
    hoverClientY = null;
    if (!menuOpen) updateHandle();
  }

  // Double-clicking the wrapper's own margin (its 56px/64px/30vh padding
  // around .editor-content-col, kept clear of the contenteditable itself so
  // clicking near the end of a short doc still lands somewhere) lands on
  // that plain, non-editable div, not on any text: nothing
  // places a cursor there natively, so reaching a specific blank/short line
  // required first clicking somewhere that *did* work and then walking down
  // with Enter (which inserts real newlines just to move the caret — a
  // destructive workaround for what should be plain navigation). Reuses the
  // same clamped posAtCoords trick as the block-drag drop target so a click
  // anywhere in the margin resolves to the nearest real row instead of null.
  function onWrapperDblClick(e: MouseEvent) {
    if (!editor) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.(".tiptap, .handle-group, .block-menu, .block-drag-ghost, .block-drop-indicator")) return;
    const box = editor.view.dom.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX, box.left + 1), box.right - 1);
    const y = Math.min(Math.max(e.clientY, box.top + 1), box.bottom - 1);
    const result = editor.view.posAtCoords({ left: x, top: y });
    if (!result) return;
    placeCursorNear(result.pos);
  }

  // -- Block drag-reorder: grab via the "⋮⋮" handle, drop above/below another block --
  //
  // Built on plain pointer events rather than native HTML5 Drag and Drop, for
  // the same reason as the sidebar tree's row reordering (see
  // dragController.ts): WebView2 has a long-standing platform bug where
  // dragstart/dragover/drop simply never fire for in-page drags.

  function updateDropTarget(clientX: number, clientY: number) {
    if (!editor || !dragSource) return;
    // posAtCoords returns null once the pointer leaves the contenteditable's
    // own bounding box — which is only as tall/wide as its rendered content,
    // not the padded wrapper around it. Dragging below the last line (a
    // common gesture: the wrapper has ~30vh of bottom padding so clicking
    // there normally places the cursor at the end) or a hair outside the
    // left/right text column would otherwise silently stop updating the
    // drop target for the rest of the drag. Clamping into the box first
    // makes those resolve to the nearest real position instead.
    const box = editor.view.dom.getBoundingClientRect();
    const x = Math.min(Math.max(clientX, box.left + 1), box.right - 1);
    const y = Math.min(Math.max(clientY, box.top + 1), box.bottom - 1);
    const result = editor.view.posAtCoords({ left: x, top: y });
    if (!result) return;
    const resolved = editor.state.doc.resolve(result.pos);
    if (resolved.depth < 1) return;
    const blockPos = resolved.before(1);
    if (blockPos >= dragSource.from && blockPos < dragSource.to) {
      // Hovering over the dragged block's own (former) range — no-op target.
      dropTargetPos = null;
      dropIndicatorTop = null;
      dropTargetRect = null;
      return;
    }
    const dom = editor.view.nodeDOM(blockPos) as HTMLElement | null;
    if (!dom || !wrapperEl) {
      dropTargetPos = null;
      dropIndicatorTop = null;
      dropTargetRect = null;
      return;
    }
    const rect = dom.getBoundingClientRect();
    const position: "before" | "after" = clientY < rect.top + rect.height / 2 ? "before" : "after";
    const containerRect = wrapperEl.getBoundingClientRect();
    dropTargetPos = blockPos;
    dropPosition = position;
    dropIndicatorTop = (position === "before" ? rect.top : rect.bottom) - containerRect.top;
    dropTargetRect = { top: rect.top - containerRect.top, height: rect.height };
  }

  function commitBlockMove() {
    if (!editor || !dragSource) return;
    const source = dragSource;
    const targetPos = dropTargetPos;
    const position = dropPosition;
    const dom = editor.view.nodeDOM(source.from) as HTMLElement | null;
    dom?.classList.remove("block-drag-source");
    dropIndicatorTop = null;
    dropTargetRect = null;
    dragSource = null;
    dropTargetPos = null;
    clearMultiSelect();
    if (targetPos === null) return;
    const targetNode = editor.state.doc.nodeAt(targetPos);
    if (!targetNode) return;
    // doc.slice rather than a single doc.nodeAt(source.from): source can now
    // be either one block (the "⋮⋮" handle) or a whole multi-select range
    // (dragging a group by one of its members' handles) — both are just a
    // [from, to) span of whole top-level nodes, so the same move works for
    // either without the caller needing to special-case which one it is.
    const slice = editor.state.doc.slice(source.from, source.to);
    if (slice.content.size === 0) return;
    let insertPos = position === "before" ? targetPos : targetPos + targetNode.nodeSize;
    let tr = editor.state.tr.delete(source.from, source.to);
    // Deleting the source shifts every position after it; correct the
    // target position for that before inserting there.
    if (insertPos > source.to) {
      insertPos -= source.to - source.from;
    } else if (insertPos > source.from) {
      insertPos = source.from;
    }
    tr = tr.insert(insertPos, slice.content);
    editor.view.dispatch(tr);
    updateHandle();
    scheduleSync();
  }

  const BLOCK_DRAG_THRESHOLD = 4;

  function onDragHandlePointerDown(e: PointerEvent) {
    if (e.button !== 0 || !editor) return;
    // The handle can be showing via the keyboard/cursor fallback (the mouse
    // hasn't moved over the content since a click/keyboard nav placed the
    // cursor, so hoverBlockPos is still null) — grabbing it in that state
    // must act on the cursor's block instead of silently doing nothing.
    const pos = hoverBlockPos ?? topLevelBlockPos();
    if (pos === null) return;
    // Grabbing a handle that belongs to an already-selected group drags the
    // whole group, not just that one row — same gesture, bigger source range.
    const isGroupDrag = !!multiSelectRange && pos >= multiSelectRange.from && pos < multiSelectRange.to;
    let source: { from: number; to: number };
    let ghostLabel: string;
    if (isGroupDrag) {
      source = multiSelectRange!;
      ghostLabel = `${countBlocksInRange(source)} 个内容块`;
    } else {
      // Grabbing an unselected block's handle while a different group is
      // still highlighted implicitly abandons that old selection.
      clearMultiSelect();
      const node = editor.state.doc.nodeAt(pos);
      if (!node) return;
      source = { from: pos, to: pos + node.nodeSize };
      ghostLabel = labelForDraggedBlock(node);
    }
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    function onMove(ev: PointerEvent) {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < BLOCK_DRAG_THRESHOLD) return;
        started = true;
        dragSource = source;
        if (isGroupDrag) {
          multiSelectDragging = true;
        } else {
          const dom = editor!.view.nodeDOM(source.from) as HTMLElement | null;
          dom?.classList.add("block-drag-source");
        }
        blockDragGhost = { text: ghostLabel, x: ev.clientX, y: ev.clientY };
        // Same reasoning as the sidebar tree's drag (dragController.ts): the
        // handle's own CSS cursor only applies while hovering the handle
        // itself, not for the rest of the drag as the pointer moves over
        // the document.
        document.body.style.cursor = "grabbing";
      } else if (blockDragGhost) {
        blockDragGhost = { ...blockDragGhost, x: ev.clientX, y: ev.clientY };
      }
      ev.preventDefault();
      updateDropTarget(ev.clientX, ev.clientY);
    }

    function finish() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.body.style.cursor = "";
      blockDragGhost = null;
      if (started) {
        commitBlockMove();
      } else {
        dragSource = null;
        dropTargetPos = null;
      }
    }

    function onUp() {
      finish();
    }

    function onCancel() {
      finish();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  // -- Slash menu: detect "/" typed in text, keep the filter query synced --

  function positionSlashMenu(pos: number) {
    if (!editor || !wrapperEl) return;
    const coords = editor.view.coordsAtPos(pos);
    const containerRect = wrapperEl.getBoundingClientRect();
    slashPos = { top: coords.bottom - containerRect.top + 4, left: coords.left - containerRect.left };
  }

  function detectSlashOpen() {
    if (!editor || slashMenuState.open) return;
    const { $from: cursor, empty } = editor.state.selection;
    if (!empty) return;
    const offset = cursor.parentOffset;
    if (offset < 1) return;
    const text = cursor.parent.textContent;
    // Also accept the fullwidth "／" (U+FF0F) — see fullwidthShortcuts.ts
    // for why a Chinese IME can produce this instead of the ASCII "/".
    if (text[offset - 1] !== "/" && text[offset - 1] !== "／") return;
    const charBefore = offset >= 2 ? text[offset - 2] : "";
    if (offset !== 1 && !/\s/.test(charBefore)) return;
    slashMenuState.openAt(cursor.pos);
    menuOpen = false;
    positionSlashMenu(cursor.pos);
  }

  function refreshSlashQuery() {
    if (!editor || !slashMenuState.open) return;
    const { $from: cursor, empty } = editor.state.selection;
    if (!empty || cursor.pos < slashMenuState.from) {
      slashMenuState.close();
      return;
    }
    const blockStart = cursor.before(1);
    const blockEnd = cursor.after(1);
    if (slashMenuState.from < blockStart || slashMenuState.from > blockEnd) {
      slashMenuState.close();
      return;
    }
    const query = editor.state.doc.textBetween(slashMenuState.from, cursor.pos, "\n");
    if (/\s/.test(query)) {
      slashMenuState.close();
      return;
    }
    slashMenuState.query = query;
    positionSlashMenu(cursor.pos);
  }

  function updateSlash() {
    detectSlashOpen();
    refreshSlashQuery();
  }

  // -- Shared block-content construction for both the "+" handle menu and the slash menu --

  function buildBlockContent(key: string, extra?: LinkPick): Record<string, unknown> | Record<string, unknown>[] {
    switch (key) {
      case "h1":
        return { type: "heading", attrs: { level: 1 } };
      case "h2":
        return { type: "heading", attrs: { level: 2 } };
      case "h3":
        return { type: "heading", attrs: { level: 3 } };
      case "h4":
        return { type: "heading", attrs: { level: 4 } };
      case "bulletList":
        return { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] };
      case "orderedList":
        return { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] };
      case "taskList":
        return {
          type: "taskList",
          content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }],
        };
      case "toggleList":
        return { type: "toggleList", content: [{ type: "toggleSummary", content: [] }, { type: "paragraph" }] };
      case "callout":
        return { type: "callout", content: [{ type: "paragraph" }] };
      case "blockquote":
        return { type: "blockquote", content: [{ type: "paragraph" }] };
      case "codeBlock":
        return { type: "codeBlock" };
      case "table":
        return {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [0, 1, 2].map(() => ({ type: "tableHeader", content: [{ type: "paragraph" }] })),
            },
            {
              type: "tableRow",
              content: [0, 1, 2].map(() => ({ type: "tableCell", content: [{ type: "paragraph" }] })),
            },
            {
              type: "tableRow",
              content: [0, 1, 2].map(() => ({ type: "tableCell", content: [{ type: "paragraph" }] })),
            },
          ],
        };
      case "horizontalRule":
        // A bare horizontalRule is an atom with no inner text position at
        // all — landing the cursor "inside" it after insertion isn't
        // possible, which is what left the selection in a broken state
        // (space wouldn't open the slash menu afterward: its condition
        // checks the selection is a collapsed cursor inside an empty
        // paragraph, which no longer held once setTextSelection silently
        // failed and left whatever selection insertContentAt happened to
        // produce). Always pairing it with a fresh empty paragraph gives
        // the cursor somewhere real to land, right after the rule.
        return [{ type: "horizontalRule" }, { type: "paragraph" }];
      case "pageLink":
      case "fileLink":
        return {
          type: "paragraph",
          content: extra ? [{ type: key, attrs: { path: extra.path, title: extra.title } }] : [],
        };
      default:
        return { type: "paragraph" };
    }
  }

  // Keys buildConvertedContent below knows how to rebuild around preserved
  // inline content. The rest (table/horizontalRule/newPage/pageLink/
  // fileLink) are structurally too different from a block of running text
  // for a content-preserving "turn into" to make sense — those stay on the
  // regular insert-a-new-block-after path in insertBlock.
  const CONVERTIBLE_KEYS = new Set([
    "paragraph",
    "h1",
    "h2",
    "h3",
    "h4",
    "bulletList",
    "orderedList",
    "taskList",
    "toggleList",
    "callout",
    "blockquote",
    "codeBlock",
  ]);

  // Flattens a block's text into a single run of inline content (text nodes
  // with their marks, plus inline atoms), discarding whatever structural
  // wrapper it was sitting in (listItem, paragraph, toggleSummary, table
  // cells, ...) — so "turn into" can drop the same words into a
  // differently-shaped target (e.g. a bullet list item's paragraph text
  // becoming a heading's direct inline content) without the caller needing
  // to know each schema's nesting.
  function extractInlineContent(node: import("@tiptap/pm/model").Node): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    node.forEach((child) => {
      if (child.isText || child.isInline) {
        out.push(child.toJSON());
      } else if (child.isBlock) {
        out.push(...extractInlineContent(child));
      }
    });
    return out;
  }

  // Mirrors buildBlockContent's shapes but slots preserved inline content
  // into whichever child position actually holds text for that type, for
  // the "turn into" flow (CONVERTIBLE_KEYS only — the caller never passes
  // anything outside that set).
  function buildConvertedContent(key: string, inline: Record<string, unknown>[]): Record<string, unknown> {
    switch (key) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
        return { type: "heading", attrs: { level: Number(key[1]) }, content: inline };
      case "bulletList":
      case "orderedList":
        return { type: key, content: [{ type: "listItem", content: [{ type: "paragraph", content: inline }] }] };
      case "taskList":
        return {
          type: "taskList",
          content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: inline }] }],
        };
      case "toggleList":
        return { type: "toggleList", content: [{ type: "toggleSummary", content: inline }, { type: "paragraph" }] };
      case "callout":
        return { type: "callout", content: [{ type: "paragraph", content: inline }] };
      case "blockquote":
        return { type: "blockquote", content: [{ type: "paragraph", content: inline }] };
      case "codeBlock": {
        // Code blocks don't support marks/inline atoms — collapse to plain text.
        const text = inline.map((n) => (typeof n.text === "string" ? n.text : "")).join("");
        return { type: "codeBlock", content: text ? [{ type: "text", text }] : [] };
      }
      default:
        return { type: "paragraph", content: inline };
    }
  }

  async function resolveAsyncExtra(key: string): Promise<LinkPick | null> {
    if (key === "pageLink") return appState.pickPageLink();
    if (key === "fileLink") return appState.pickFileLink();
    if (key === "newPage") return appState.createNewPageNear(appState.activeTab?.path ?? null);
    return null;
  }

  // Places the cursor at the nearest valid text position at-or-after pos,
  // robustly skipping over atoms (horizontalRule, pageLink, fileLink) that
  // have no text position of their own — unlike a plain setTextSelection(pos),
  // which throws for exactly those cases and, if left uncaught/ignored,
  // leaves the selection wherever insertContentAt happened to put it (which
  // was the root cause of the horizontalRule bug: a non-empty-paragraph
  // selection left the slash-menu's space trigger unable to recognize it).
  function placeCursorNear(pos: number) {
    if (!editor) return;
    const size = editor.state.doc.content.size;
    const resolved = editor.state.doc.resolve(Math.max(0, Math.min(pos, size)));
    const selection = TextSelection.near(resolved, 1);
    editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
    editor.commands.focus();
  }

  const SCROLL_ANIM_MS = 320;

  // Animates el.scrollTop over a fixed duration with an ease-out curve —
  // used instead of the native scrollEl.scrollTo({behavior:"smooth"}), which
  // has no duration/easing controls of its own: Chromium picks its own
  // timing based on distance, and for the short distances this is used for
  // (see scrollToPos below) that rendered too quickly to read as an
  // intentional slide. A fixed, explicit duration makes it reliably visible
  // without dragging on.
  function animateScrollTop(el: HTMLElement, target: number, duration: number) {
    const start = el.scrollTop;
    const distance = target - start;
    if (Math.abs(distance) < 1) return;
    const startTime = performance.now();
    function ease(t: number) {
      return 1 - (1 - t) ** 3;
    }
    function step(now: number) {
      const t = Math.min(1, (now - startTime) / duration);
      el.scrollTop = start + distance * ease(t);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // Jumps to a document position (the outline's "click a heading" gesture)
  // with a bounded slide-into-view instead of ProseMirror's own
  // scrollIntoView() (an instant teleport) or a plain smooth-scroll across
  // the whole gap (for a heading far below the fold, that animates a fast
  // scroll through a lot of unrelated content in between, which reads as
  // chaotic rather than helpful). Snaps most of the way there instantly —
  // landing just half a screen short of the target — so only a short,
  // consistent "slide the last bit" is ever actually animated, regardless
  // of how far away the heading is.
  // Shared by scrollToPos/scrollToRange below: slides scrollEl so the given
  // viewport-space `top` coordinate lands just under some headroom, snapping
  // most of the way there instantly for far-off targets so only a short,
  // consistent "slide the last bit" is ever animated.
  function slideScrollTo(top: number) {
    if (!scrollEl) return;
    const containerRect = scrollEl.getBoundingClientRect();
    const HEADROOM = 48;
    const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    const target = Math.min(Math.max(top - containerRect.top + scrollEl.scrollTop - HEADROOM, 0), maxScroll);
    const distance = target - scrollEl.scrollTop;
    const halfScreen = scrollEl.clientHeight / 2;
    if (Math.abs(distance) > halfScreen) {
      const snapTo = Math.min(Math.max(target - Math.sign(distance) * halfScreen, 0), maxScroll);
      scrollEl.scrollTop = snapTo;
    }
    animateScrollTop(scrollEl, target, SCROLL_ANIM_MS);
  }

  // Jumps to a document position (the outline's "click a heading" gesture).
  function scrollToPos(pos: number) {
    if (!editor || !scrollEl) return;
    editor.chain().focus().setTextSelection(pos + 1).run();
    try {
      slideScrollTo(editor.view.coordsAtPos(pos + 1).top);
    } catch {
      /* pos not currently rendered (e.g. inside a collapsed toggle) */
    }
  }

  // Same slide-into-view for a find/replace match's [from, to) range, minus
  // scrollToPos's focus()/setTextSelection — the caller (FindReplace.svelte)
  // wants keyboard focus to stay in its own input, not jump to the editor.
  function scrollToRange(from: number, _to: number) {
    if (!editor || !scrollEl) return;
    try {
      slideScrollTo(editor.view.coordsAtPos(from).top);
    } catch {
      /* match not currently rendered */
    }
  }

  // "+" handle menu: acts on whichever block the handle is currently showing
  // for (the hovered block, or the cursor's block as a keyboard-only
  // fallback) — not necessarily wherever the text selection happens to be,
  // since hovering a different block than the cursor is the whole point of
  // a hover-driven handle.
  //
  // Three outcomes, in priority order:
  //  1. The block already has a real format (heading/list/quote/...) and a
  //     target that can hold text was picked — "turn into": the block's own
  //     text is preserved and reshaped into the new type in place. This is
  //     the handleFormatIcon path: the handle already looked like the
  //     current format, so clicking it reads as "change this", not "add a
  //     new block".
  //  2. The block is empty (the common "just clicked + on a blank line"
  //     case) — converted in place, no new line appears below it.
  //  3. Otherwise (plain paragraph with text, or a non-text-shaped target
  //     like a table) — a new block is inserted after it, so existing text
  //     is never silently discarded.
  async function insertBlock(key: string) {
    if (!editor) return;
    const pos = hoverBlockPos ?? topLevelBlockPos();
    if (pos === null) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const isEmpty = node.content.size === 0;
    const currentFormatKey = blockTypeKeyFor(node);
    const blockEnd = pos + node.nodeSize;

    let effectiveKey = key;
    let extra: LinkPick | undefined;
    if (ASYNC_KEYS.has(key)) {
      menuOpen = false;
      const picked = await resolveAsyncExtra(key);
      if (!picked || !editor) return;
      extra = picked;
      effectiveKey = "pageLink";
    }
    if (!editor) return;

    if (currentFormatKey && !isEmpty && CONVERTIBLE_KEYS.has(effectiveKey)) {
      const inline = extractInlineContent(node);
      const content = buildConvertedContent(effectiveKey, inline);
      editor.chain().focus().insertContentAt({ from: pos, to: blockEnd }, content).run();
      placeCursorNear(pos);
    } else {
      const content = buildBlockContent(effectiveKey, extra);
      if (isEmpty) {
        editor.chain().focus().insertContentAt({ from: pos, to: blockEnd }, content).run();
        placeCursorNear(pos);
      } else {
        editor.chain().focus().insertContentAt(blockEnd, content).run();
        placeCursorNear(blockEnd);
      }
    }
    menuOpen = false;
    updateHandle();
  }

  // Slash menu: replaces the current (empty, trigger-only) top-level block in place.
  async function applySlash(key: string) {
    if (!editor) return;
    const { $from: cursor } = editor.state.selection;
    const blockStart = cursor.before(1);
    const blockEnd = cursor.after(1);
    slashMenuState.close();

    let effectiveKey = key;
    let extra: LinkPick | undefined;
    if (ASYNC_KEYS.has(key)) {
      const picked = await resolveAsyncExtra(key);
      if (!picked || !editor) return;
      extra = picked;
      effectiveKey = "pageLink";
    }
    if (!editor) return;
    const content = buildBlockContent(effectiveKey, extra);
    editor.chain().focus().insertContentAt({ from: blockStart, to: blockEnd }, content).run();
    placeCursorNear(blockStart);
    updateHandle();
  }

  function toggleMenu() {
    menuOpen = !menuOpen;
    if (menuOpen) slashMenuState.close();
  }

  function closeMenu() {
    menuOpen = false;
  }

  // Buttons that live outside the contenteditable region blur the editor on
  // mousedown (before their click handler runs), which would otherwise wipe
  // handleTop/menuOpen (or the slash selection) before the click is even
  // processed. Suppressing the default mousedown behavior keeps focus in
  // the editor so the click lands.
  function preventBlur(e: MouseEvent) {
    e.preventDefault();
  }

  function syncUndoRedo() {
    if (!editor) return;
    editorBridge.canUndo = editor.can().undo();
    editorBridge.canRedo = editor.can().redo();
  }

  onMount(() => {
    slashMenuState.onSelect = () => {
      const item = slashItems[slashMenuState.highlight];
      if (item) void applySlash(item.key);
    };

    editor = new Editor({
      element,
      extensions: [
        SlashTrigger,
        StarterKit.configure({
          // Its default click-to-open just calls window.open, which inside
          // WebView2 spawns another embedded webview rather than the
          // user's actual browser — LinkClickHandler (links.ts) handles
          // opening via the system default browser instead.
          link: { openOnClick: false },
        }),
        FullwidthHeadingShortcut,
        Markdown.configure({ html: true, transformPastedText: true }),
        SearchHighlight,
        TaskList,
        TaskItem,
        Table,
        TableRow,
        TableHeader,
        TableCell,
        ToggleList,
        ToggleSummary,
        Callout,
        PageLink,
        FileLink,
        LinkClickHandler,
        Placeholder.configure({
          placeholder: "按 / 快速插入格式",
        }),
      ],
      content: appState.activeTab?.content ?? "",
      autofocus: true,
      onUpdate: () => {
        if (switching) return;
        scheduleSync();
        updateHandle();
        updateSlash();
      },
      onSelectionUpdate: () => {
        // Any selection change we didn't just make ourselves (a click, a
        // keyboard cursor move, typing) means the user has moved on from the
        // drag-selected group — drop its highlight. See finalizeMultiSelect.
        if (multiSelectRange) {
          if (applyingMultiSelectSelection) {
            applyingMultiSelectSelection = false;
          } else {
            clearMultiSelect();
          }
        }
        updateHandle();
        updateSlash();
      },
      onFocus: () => updateHandle(),
      onBlur: () => {
        if (!menuOpen && hoverBlockPos === null) handleTop = null;
        slashMenuState.close();
      },
      onTransaction: () => syncUndoRedo(),
    });
    editorBridge.instance = editor;
    editorBridge.scrollToPos = scrollToPos;
    editorBridge.scrollToRange = scrollToRange;
    editorBridge.resetZoom = resetZoom;
    lastTabId = appState.activeTabId;
    refreshDerivedState();
    syncUndoRedo();
    scrollEl?.addEventListener("scroll", updateHandle, { passive: true });
  });

  onDestroy(() => {
    if (debounceHandle) clearTimeout(debounceHandle);
    scrollEl?.removeEventListener("scroll", updateHandle);
    slashMenuState.onSelect = null;
    slashMenuState.close();
    editor?.destroy();
    editorBridge.instance = null;
    editorBridge.scrollToPos = null;
    editorBridge.scrollToRange = null;
    editorBridge.resetZoom = null;
  });

  $effect(() => {
    editorBridge.zoom = editorZoom;
  });

  $effect(() => {
    const tab = appState.activeTab;
    const id = appState.activeTabId;
    if (!editor || id === lastTabId) return;
    lastTabId = id;
    switching = true;
    clearMultiSelect();
    // Chained so the addToHistory meta lands on the same transaction as the
    // content replacement: otherwise every tab switch/open pushed a
    // whole-document replace onto the undo stack, and a couple of undos
    // after opening a file could wipe everything just typed.
    editor.chain().setMeta("addToHistory", false).setContent(tab?.content ?? "", { emitUpdate: false }).run();
    switching = false;
    refreshDerivedState();
    updateHandle();
    syncUndoRedo();
  });
</script>

<svelte:window
  onclick={() => {
    if (menuOpen) closeMenu();
    if (slashMenuState.open) slashMenuState.close();
  }}
  onkeydown={onWindowKeydown}
/>

<div class="editor-scroll" bind:this={scrollEl} onwheel={onEditorWheel}>
  <div
    class="editor-content-col-wrapper"
    class:multiselect-active={multiSelectRange !== null}
    bind:this={wrapperEl}
    onmousemove={onContentMouseMove}
    onmouseleave={onContentMouseLeave}
    ondblclick={onWrapperDblClick}
    onpointerdown={onMarginPointerDown}
    role="presentation"
    style={`zoom:${editorZoom}%`}
  >
    {#each multiSelectRects as r, i (i)}
      <div
        class="row-highlight"
        class:dragging={multiSelectDragging}
        style={`top:${r.top / zoomScale}px; height:${r.height / zoomScale}px`}
      ></div>
    {/each}
    {#if dropTargetRect}
      <div
        class="row-highlight"
        style={`top:${dropTargetRect.top / zoomScale}px; height:${dropTargetRect.height / zoomScale}px`}
      ></div>
    {/if}
    {#if handleTop !== null}
      <div class="handle-group" style={`top:${handleTop / zoomScale}px; height:${handleHeight / zoomScale}px`}>
        <button
          class="block-handle"
          title={handleFormatIcon ? "更改格式" : "添加"}
          aria-label={handleFormatIcon ? "更改格式" : "添加"}
          onmousedown={preventBlur}
          onclick={(e) => {
            e.stopPropagation();
            toggleMenu();
          }}
        >
          <Icon name={handleFormatIcon ?? "plus"} size={19} />
        </button>
        <button
          class="drag-handle"
          title="拖拽移动"
          aria-label="拖拽移动"
          onmousedown={preventBlur}
          onpointerdown={onDragHandlePointerDown}
        >
          <Icon name="grip" size={18} />
        </button>
      </div>
      {#if menuOpen}
        <div class="block-menu" style={`top:${(handleTop + handleHeight + 2) / zoomScale}px`}>
          {#each blockTypes as bt (bt.key)}
            <button onmousedown={preventBlur} onclick={() => insertBlock(bt.key)}>
              <Icon name={bt.icon} size={14} />
              <span>{bt.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
    {#if dropIndicatorTop !== null}
      <div class="block-drop-indicator" style={`top:${dropIndicatorTop / zoomScale}px`}></div>
    {/if}
    {#if slashMenuState.open}
      <div
        class="block-menu slash-menu"
        style={`top:${slashPos.top / zoomScale}px; left:${slashPos.left / zoomScale}px`}
      >
        {#if slashItems.length === 0}
          <div class="slash-empty">无匹配格式</div>
        {:else}
          {#each slashItems as bt, i (bt.key)}
            <button
              class:highlight={i === slashMenuState.highlight}
              onmousedown={preventBlur}
              onmouseenter={() => (slashMenuState.highlight = i)}
              onclick={() => applySlash(bt.key)}
            >
              <Icon name={bt.icon} size={14} />
              <span>{bt.label}</span>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
    <div class="editor-content-col" bind:this={element}></div>
  </div>
</div>
{#if blockDragGhost}
  <div class="block-drag-ghost" style={`left:${blockDragGhost.x}px; top:${blockDragGhost.y}px`}>
    {blockDragGhost.text}
  </div>
{/if}

<style>
  .editor-scroll {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    background: var(--content-bg);
  }

  .editor-content-col-wrapper {
    position: relative;
    max-width: 1000px;
    margin: 0 auto;
    padding: 56px 64px 30vh;
    min-height: 100%;
  }

  .handle-group {
    position: absolute;
    left: 2px;
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .block-handle,
  .drag-handle {
    /* Sized to roughly match the line-height of body text (16px font,
       1.6 line-height ≈ 26px) rather than a small fixed icon button — at
       the old 22px/14-15px icon size these were fiddly to hit precisely. */
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .drag-handle {
    cursor: grab;
  }
  .drag-handle:active {
    cursor: grabbing;
  }
  .block-handle:hover,
  .drag-handle:hover {
    background: var(--hover-bg-strong);
    color: var(--text-primary);
  }

  .block-menu {
    position: absolute;
    left: 4px;
    z-index: 500;
    background: var(--content-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    padding: 4px;
    min-width: 160px;
    max-height: 320px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .slash-menu {
    left: unset;
  }
  .slash-empty {
    padding: 8px 10px;
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .block-menu button {
    display: flex;
    align-items: center;
    gap: 10px;
    border: none;
    background: none;
    text-align: left;
    padding: 7px 10px;
    font-size: 13px;
    color: var(--text-primary);
    border-radius: 5px;
    cursor: pointer;
  }
  .block-menu button:hover,
  .block-menu button.highlight {
    background: var(--hover-bg);
  }
  .block-menu :global(svg) {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .editor-content-col :global(.tiptap) {
    outline: none;
    color: var(--text-primary);
    font-size: 16px;
    line-height: 1.6;
  }

  .editor-content-col :global(.tiptap h1) {
    font-size: 1.9em;
    font-weight: 700;
    margin: 1.2em 0 0.3em;
  }
  .editor-content-col :global(.tiptap h2) {
    font-size: 1.5em;
    font-weight: 700;
    margin: 1.1em 0 0.3em;
  }
  .editor-content-col :global(.tiptap h3) {
    font-size: 1.25em;
    font-weight: 600;
    margin: 1em 0 0.3em;
  }
  .editor-content-col :global(.tiptap h4),
  .editor-content-col :global(.tiptap h5),
  .editor-content-col :global(.tiptap h6) {
    font-size: 1.05em;
    font-weight: 600;
    margin: 1em 0 0.3em;
  }
  .editor-content-col :global(.tiptap p) {
    margin: 0.4em 0;
  }
  .editor-content-col :global(.tiptap ul),
  .editor-content-col :global(.tiptap ol) {
    padding-left: 1.4em;
    margin: 0.3em 0;
  }
  .editor-content-col :global(.tiptap li) {
    margin: 0.15em 0;
  }
  .editor-content-col :global(.tiptap ul[data-type="taskList"]) {
    list-style: none;
    padding-left: 0.2em;
  }
  .editor-content-col :global(.tiptap ul[data-type="taskList"] li) {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .editor-content-col :global(.tiptap ul[data-type="taskList"] li > label) {
    margin-top: 0.35em;
    user-select: none;
  }
  .editor-content-col :global(.tiptap ul[data-type="taskList"] li > div) {
    flex: 1;
  }
  .editor-content-col :global(.tiptap ul[data-type="taskList"] li[data-checked="true"] > div) {
    color: var(--text-secondary);
    text-decoration: line-through;
  }
  .editor-content-col :global(.tiptap blockquote) {
    border-left: 3px solid var(--border);
    margin: 0.6em 0;
    padding: 0.1em 1em;
    color: var(--text-secondary);
  }
  .editor-content-col :global(.tiptap pre) {
    background: var(--code-bg);
    border-radius: 6px;
    padding: 12px 14px;
    overflow-x: auto;
    font-family: "Cascadia Code", "Consolas", ui-monospace, monospace;
    font-size: 0.9em;
  }
  .editor-content-col :global(.tiptap code) {
    background: var(--code-bg);
    border-radius: 3px;
    /* Kept small on purpose: double-clicking a word inside this pill
       selects its whole text content, and the browser paints the
       selection highlight across this padding too — wider padding here
       reads as "extra unrelated content got selected" even though the
       actual selected text is exactly the word. */
    padding: 0.1em 0.15em;
    font-family: "Cascadia Code", "Consolas", ui-monospace, monospace;
    font-size: 0.9em;
  }
  .editor-content-col :global(.tiptap pre code) {
    background: none;
    padding: 0;
  }
  .editor-content-col :global(.tiptap hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1.5em 0;
  }
  .editor-content-col :global(.tiptap table) {
    border-collapse: collapse;
    margin: 0.6em 0;
    width: 100%;
  }
  .editor-content-col :global(.tiptap th),
  .editor-content-col :global(.tiptap td) {
    border: 1px solid var(--border);
    padding: 6px 10px;
    min-width: 80px;
    vertical-align: top;
  }
  .editor-content-col :global(.tiptap th) {
    background: var(--sidebar-bg);
    font-weight: 600;
    text-align: left;
  }
  .editor-content-col :global(.tiptap table p) {
    margin: 0;
  }
  .editor-content-col :global(.tiptap details.toggle-list) {
    margin: 0.4em 0;
  }
  .editor-content-col :global(.tiptap details.toggle-list > summary) {
    cursor: pointer;
    font-weight: 500;
  }
  .editor-content-col :global(.tiptap details.toggle-list > summary::marker) {
    color: var(--text-secondary);
  }
  .editor-content-col :global(.tiptap details.toggle-list[open] > summary) {
    margin-bottom: 0.2em;
  }
  .editor-content-col :global(.tiptap details.toggle-list > :not(summary)) {
    padding-left: 1.2em;
  }
  .editor-content-col :global(.tiptap div[data-type="callout"]) {
    display: flex;
    gap: 10px;
    background: var(--hover-bg);
    border-radius: 6px;
    padding: 12px 14px;
    margin: 0.6em 0;
  }
  .editor-content-col :global(.tiptap div[data-type="callout"]::before) {
    content: "\1F4A1";
    flex-shrink: 0;
  }
  .editor-content-col :global(.tiptap div[data-type="callout"] p) {
    margin: 0;
  }
  .editor-content-col :global(.tiptap a.link-chip) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 8px 1px 4px;
    border-radius: 4px;
    background: var(--hover-bg);
    color: var(--text-primary);
    text-decoration: none;
    border: 1px solid var(--border);
    font-size: 0.92em;
    cursor: pointer;
  }
  .editor-content-col :global(.tiptap a.link-chip:hover) {
    background: var(--hover-bg-strong);
  }
  /* Plain hyperlinks (StarterKit's Link mark — typed/pasted URLs, or
     [text](url) markdown), as opposed to the page/file "chip" links above.
     Opened via the system browser — see LinkClickHandler in links.ts. */
  .editor-content-col :global(.tiptap a:not(.link-chip)) {
    position: relative;
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  /* Full-URL tooltip on hover, pure CSS (attr(href) needs no JS) — helps
     tell an unfamiliar link's real destination apart from its display text. */
  .editor-content-col :global(.tiptap a:not(.link-chip):hover::after) {
    content: attr(href);
    position: absolute;
    left: 0;
    top: 100%;
    margin-top: 4px;
    padding: 3px 8px;
    border-radius: 6px;
    background: var(--content-bg);
    border: 1px solid var(--border);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 12px;
    font-weight: normal;
    font-style: normal;
    text-decoration: none;
    white-space: nowrap;
    max-width: 480px;
    overflow: hidden;
    text-overflow: ellipsis;
    z-index: 50;
    pointer-events: none;
  }
  .editor-content-col :global(.tiptap .search-match) {
    background: rgba(255, 212, 0, 0.4);
    border-radius: 2px;
  }
  .editor-content-col :global(.tiptap .search-match-active) {
    background: rgba(255, 145, 0, 0.65);
  }
  .editor-content-col :global(.tiptap .is-empty::before) {
    content: attr(data-placeholder);
    float: left;
    color: var(--text-secondary);
    opacity: 0.55;
    pointer-events: none;
    height: 0;
  }
  /* Block drag-reorder: the block being dragged dims in place. */
  .editor-content-col :global(.tiptap .block-drag-source) {
    background: var(--hover-bg-strong);
    border-radius: 4px;
    opacity: 0.6;
  }
  /* Full-width bar marking exactly where the block will land — an overlay
     element positioned from JS (dropIndicatorTop), not a pseudo-element
     glued onto the target block's own DOM node: the target can be a <p>,
     <h2>, <ul>, a table cell, a code block with its own scroll box, etc.,
     and this way its geometry is computed the same way regardless of which
     one it is. */
  .block-drop-indicator {
    position: absolute;
    left: 0;
    right: 0;
    height: 4px;
    margin-top: -2px;
    background: var(--accent);
    border-radius: 2px;
    pointer-events: none;
  }
  /* One rounded overlay per row that should read as "highlighted" — either
     a whole block covered by a margin drag-select (multiSelectRects) or the
     block a drag-reorder is currently hovering as its landing spot
     (dropTargetRect), sharing one visual so both read as the same kind of
     "this whole row" emphasis. A real absolutely-positioned element rather
     than a background on the block's own DOM node, same reasoning as
     .block-drop-indicator above: geometry computed once, works identically
     regardless of the block's own element type. */
  .row-highlight {
    position: absolute;
    left: -8px;
    right: -8px;
    background: rgba(35, 131, 226, 0.13);
    border-radius: 6px;
    pointer-events: none;
  }
  .row-highlight.dragging {
    opacity: 0.55;
  }
  /* The real DOM selection backing the drag-select (see finalizeMultiSelect)
     stays functional for Backspace/Delete/Ctrl+C/Ctrl+X, but its own
     rectangular highlight can't reproduce the rounded per-row look above —
     hidden so only .row-highlight is visible while one is active. */
  .editor-content-col-wrapper.multiselect-active :global(.tiptap ::selection) {
    background: transparent;
  }
  /* Follows the pointer during a block drag — see blockDragGhost. Same
     recipe as the sidebar tree's .drag-ghost in +page.svelte. */
  .block-drag-ghost {
    position: fixed;
    z-index: 2000;
    pointer-events: none;
    transform: translate(12px, 12px);
    max-width: 320px;
    padding: 5px 10px;
    border-radius: 6px;
    background: var(--content-bg);
    border: 1px solid var(--border);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    font-size: 13px;
    color: var(--text-primary);
    opacity: 0.85;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
