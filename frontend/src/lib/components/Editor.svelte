<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Editor } from "@tiptap/core";
  import { TextSelection } from "@tiptap/pm/state";
  import { CellSelection, TableMap, deleteCellSelection } from "@tiptap/pm/tables";
  import { DOMParser as PMDOMParser, Fragment, type Node as PMNode } from "@tiptap/pm/model";
  import StarterKit from "@tiptap/starter-kit";
  import { Markdown } from "tiptap-markdown";
  import { Placeholder } from "@tiptap/extensions";
  import { TaskList } from "@tiptap/extension-task-list";
  import { TaskItem } from "@tiptap/extension-task-item";
  import { Highlight } from "@tiptap/extension-highlight";
  import HighlightColorPicker from "./HighlightColorPicker.svelte";
  import { Table, TableCell, TableHeader } from "$lib/editor/nodes/table";
  import { TableRow } from "@tiptap/extension-table-row";
  import Icon from "./Icon.svelte";
  import RasterIcon from "./RasterIcon.svelte";
  import { api } from "$lib/api";
  import { appState, type LinkPick } from "$lib/appState.svelte";
  import { t } from "$lib/i18n.svelte";
  import { editorBridge } from "$lib/editor/bridge.svelte";
  import { buildOutline } from "$lib/editor/outline";
  import { countWords } from "$lib/wordcount";
  import { SearchHighlight } from "$lib/editor/searchHighlight";
  import { GrammarCheck, setGrammarCheckEnabled, recomputeGrammarDecorations } from "$lib/editor/grammarCheck";
  import {
    peekSpeller,
    setCustomDictionary,
    addCustomDictionaryWord,
    findDictionaryCaseMatch,
  } from "$lib/editor/grammar/spellCheck";
  import { WavyUnderline, DotUnderline } from "$lib/editor/nodes/wavyUnderline";
  import { TextColor, UnderlineColor } from "$lib/editor/nodes/inlineColor";
  import { Mention } from "$lib/editor/nodes/mention";
  import { JoinAdjacentLists } from "$lib/editor/nodes/joinAdjacentLists";
  import { EmptyListItemDelete } from "$lib/editor/nodes/emptyListItemDelete";
  import { ToggleList, ToggleSummary } from "$lib/editor/nodes/toggleList";
  import { Callout } from "$lib/editor/nodes/callout";
  import { Columns, Column } from "$lib/editor/nodes/columns";
  import { PageLink, FileLink, LinkClickHandler } from "$lib/editor/nodes/links";
  import { MdImage } from "$lib/editor/nodes/image";
  import { SlashTrigger } from "$lib/editor/nodes/slashTrigger";
  import { FullwidthHeadingShortcut } from "$lib/editor/nodes/fullwidthShortcuts";
  import { CodeBlock } from "$lib/editor/nodes/codeBlock";
  import { slashMenuState } from "$lib/editor/slashMenu.svelte";
  import {
    type TableRef,
    findTable,
    rowCount,
    colCount,
    addRow as tableAddRow,
    moveRow as tableMoveRow,
    addColumn as tableAddColumn,
    moveColumn as tableMoveColumn,
    addRows as tableAddRows,
    removeRows as tableRemoveRows,
    deleteRow as tableDeleteRow,
    addColumns as tableAddColumns,
    addCheckboxColumn as tableAddCheckboxColumn,
    removeColumns as tableRemoveColumns,
    deleteColumn as tableDeleteColumn,
    deleteSelectedRowsAndColumns as tableDeleteSelectedRowsAndColumns,
    deleteTable as tableDeleteTable,
    setShowIndexColumn,
    setColumnWidths,
    setPhysicalColumnWidths,
    trailingEmptyRowCount,
    trailingEmptyColumnCount,
    setTableHeaderAttrs,
    slotIndex,
    slotToTargetIndex,
  } from "$lib/editor/tableOps";

  let element: HTMLDivElement;
  let wrapperEl: HTMLDivElement;
  let scrollEl: HTMLDivElement;
  let editor: Editor | null = null;
  let switching = false;
  let debounceHandle: ReturnType<typeof setTimeout> | null = null;
  let lastTabId: string | null = null;

  let handleTop = $state<number | null>(null);
  let handleLeft = $state(2);
  let handleHeight = $state(24);
  // Highlights the block a click on its drag handle (⠿, not the "+" button)
  // just acted on — a plain click opens either the "change" block-type menu
  // or, for a table, the table-wide header menu, and the highlight shows the
  // user exactly what those subsequent clicks apply to. Reuses the same
  // rgba(35,131,226,0.13) look as multiSelectRects' .row-highlight. Cleared
  // in the svelte:window onclick below (whatever closes the menus) and the
  // instant a real drag starts (onDragHandlePointerDown's onMove).
  let selectedBlockRect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
  // 30x30 reads better than the old fixed 28x28, but only when the hovered
  // row is tall enough to fit it (headings render much taller than plain
  // text, e.g.) — falls back to 28x28 for a normal-height text row rather
  // than visibly overflowing it.
  let handleBtnSize = $derived(handleHeight >= 30 ? 30 : 28);
  let menuOpen = $state(false);
  // Which button opened the block-type menu — determines what clicking an
  // item in it actually does (see insertBlock's mode parameter): "add" (the
  // "+" button) inserts a new block after the current line; "change" (the
  // ⠿ drag handle, clicked rather than dragged) converts the current line
  // in place.
  let menuMode = $state<"add" | "actions">("add");
  let slashPos = $state({ top: 0, left: 0 });
  // Icon name for the "+" handle: null (generic plus) for a plain paragraph,
  // or the matching blockTypes icon when the hovered/cursor block already
  // has a real format — see updateHandle(), which keeps this in sync with
  // handleTop/handleHeight.
  let handleFormatIcon = $state<string | null>(null);
  // Whether the hovered/cursor block is empty — drives the "+" button's
  // tooltip (and nothing else; insertBlock recomputes emptiness itself at
  // click time rather than trusting this cached copy).
  let handleIsEmpty = $state(true);
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
    if (e.key === "Escape" && highlightPickerOpen) {
      highlightPickerOpen = false;
      return;
    }
    if (e.key === "Escape" && grammarMenu) {
      grammarMenu = null;
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
  // The mouse's raw Y, used only to pick which hard-break-delimited "line"
  // of a block the handle should sit next to — see lineRectNear(). A block
  // that just word-wraps (no real Enter/backslash-newline inside it) is
  // still one logical line no matter how many visual rows it wraps to, so
  // that case ignores this and always pins to the block's first visual
  // row. But a block containing actual hardBreak nodes (an explicit Enter
  // the user typed, or a markdown hard line break) reads as several
  // distinct lines even though it's one ProseMirror node — mouseY is what
  // lets the handle follow which of those it's currently over.
  let hoverClientY: number | null = null;

  // -- Table row/column add/delete/drag gutters --

  interface TableGutter {
    tablePos: number;
    tableTop: number;
    tableBottom: number;
    tableLeft: number;
    tableRight: number;
    tableViewportLeft: number;
    tableViewportRight: number;
    tableViewportTop: number;
    tableViewportBottom: number;
    visibleColCount: number;
    // Container(wrapperEl)-relative rects, in the same "zoomed" pixel space
    // as everything else computed via getBoundingClientRect() in this file
    // (see the editorZoom comment near the top) — divided by zoomScale only
    // at render time in the template.
    rows: { top: number; bottom: number }[];
    cols: { left: number; right: number }[];
    rowHeights: number[];
    colWidths: number[];
    contentColWidths: number[];
    resizeBoundaries: { x: number; top: number; bottom: number; index: number }[];
  }
  let tableGutter = $state<TableGutter | null>(null);
  // Set while a row/column grip is being dragged; used only to stop
  // onContentMouseMove/onContentMouseLeave from clearing tableGutter out
  // from under an in-progress drag.
  let tableDragActive = false;
  let tableDropRowY = $state<number | null>(null);
  let tableDropColX = $state<number | null>(null);
  // Live preview while dragging the add-row/add-col button: how many
  // rows/columns would be added (removing:false) or removed (removing:true)
  // if the pointer were released right now. Purely visual — addRows/
  // removeRows etc. only ever run once, from the pointerup handler.
  let tableRowAdjust = $state<{ count: number; removing: boolean } | null>(null);
  let tableColAdjust = $state<{ count: number; removing: boolean } | null>(null);
  let tableDimensionLabel = $state<{ text: string; left: number; top: number } | null>(null);
  let hoveredTableResizeBoundary = $state<{ x: number; top: number; bottom: number; index: number } | null>(null);
  let tableColResize = $state<{ x: number; top: number; bottom: number } | null>(null);
  let tableAddDragAxis = $state<"row" | "col" | null>(null);
  // Which single row/column grip to actually render — only the one under
  // the cursor, not every row/column at once, so the gutter doesn't turn
  // into a wall of grips the instant the table is hovered at all.
  let hoveredRowIndex = $state<number | null>(null);
  let hoveredColIndex = $state<number | null>(null);
  let imageMenu = $state<{ pos: number; x: number; y: number; centered: boolean; widthPercent: number; src: string } | null>(null);
  let tableCellSelectionRect = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  let tableSelectionToolbarVisible = $state(false);
  let cellTextEditingToolbar = $state(false);
  let tableSelectionToolbarPinned = false;
  let tableSelectionToolbarHideTimer: ReturnType<typeof setTimeout> | null = null;
  let imageResizeActive = $state(false);
  let imageResizeSession: { apply: (clientX: number) => void; finish: (commit: boolean, clientX?: number) => void } | null = null;
  let suppressImageClickUntil = 0;
  const IMAGE_MENU_WIDTH = 180;
  const IMAGE_MENU_HEIGHT = 104;
  const IMAGE_MENU_GAP = 8;

  // Right-click menu on the whole-table drag handle (the generic
  // .drag-handle from the block handle-group, shown whenever the hovered/
  // cursor block is a table) — table-wide header row/column display toggles
  // (see tableOps.setTableHeaderAttrs). Carries its own showHeaderRow/
  // showHeaderColumn snapshot (rather than re-deriving from editor.state on
  // every read) because `editor` is a plain variable, not $state — a
  // $derived reading editor.state.doc would never notice a transaction and
  // go stale the instant a toggle fired. Reassigning this object on each
  // toggle keeps it correct with plain Svelte reactivity.
  let tableHeaderMenu = $state<{
    x: number;
    y: number;
    tablePos: number;
    showHeaderRow: boolean;
    showHeaderColumn: boolean;
    showIndexColumn: boolean;
  } | null>(null);

  // Opened from a plain (no-drag) left-click on a table's drag handle — see
  // onDragHandlePointerDown's finish(). Used to live behind a right-click
  // (oncontextmenu) instead; moved to left-click so it's reachable the same
  // way as every other handle-click menu in this file, no secondary gesture
  // to discover.
  function openTableHeaderMenu(coords: { clientX: number; clientY: number }, pos: number, node: PMNode) {
    // Only one table popup open at a time — opening this one closes any
    // row/column grip menu left open from before.
    tableRowMenu = null;
    tableColMenu = null;
    tableHeaderMenu = {
      x: coords.clientX,
      y: coords.clientY,
      tablePos: pos,
      showHeaderRow: !!node.attrs.showHeaderRow,
      showHeaderColumn: !!node.attrs.showHeaderColumn,
      showIndexColumn: !!node.attrs.showIndexColumn,
    };
  }

  function deleteTableFromMenu() {
    if (!editor || !tableHeaderMenu) return;
    const node = editor.state.doc.nodeAt(tableHeaderMenu.tablePos);
    if (!node || node.type.name !== "table") return;
    tableDeleteTable(editor, { node, pos: tableHeaderMenu.tablePos });
    tableHeaderMenu = null;
    selectedBlockRect = null;
  }

  function toggleTableHeaderRow() {
    if (!editor || !tableHeaderMenu) return;
    const node = editor.state.doc.nodeAt(tableHeaderMenu.tablePos);
    if (!node || node.type.name !== "table") return;
    const next = !tableHeaderMenu.showHeaderRow;
    setTableHeaderAttrs(editor, { node, pos: tableHeaderMenu.tablePos }, { showHeaderRow: next });
    tableHeaderMenu = { ...tableHeaderMenu, showHeaderRow: next };
    // Belt-and-suspenders alongside the onTransaction-driven call: apply the
    // DOM/style update here too, synchronously, in the same click handler,
    // rather than only trusting the next onTransaction round-trip.
    syncTableHeaderAttrs();
  }

  function toggleTableHeaderColumn() {
    if (!editor || !tableHeaderMenu) return;
    const node = editor.state.doc.nodeAt(tableHeaderMenu.tablePos);
    if (!node || node.type.name !== "table") return;
    const next = !tableHeaderMenu.showHeaderColumn;
    setTableHeaderAttrs(editor, { node, pos: tableHeaderMenu.tablePos }, { showHeaderColumn: next });
    tableHeaderMenu = { ...tableHeaderMenu, showHeaderColumn: next };
    syncTableHeaderAttrs();
  }

  // Moved here from the first column's grip menu — this is the whole
  // table's left-click menu, same place showHeaderRow/showHeaderColumn/
  // delete-table live, rather than a separate gesture on a specific column.
  function toggleTableIndexColumn() {
    if (!editor || !tableHeaderMenu) return;
    const node = editor.state.doc.nodeAt(tableHeaderMenu.tablePos);
    if (!node || node.type.name !== "table") return;
    const next = !tableHeaderMenu.showIndexColumn;
    setShowIndexColumn(editor, { node, pos: tableHeaderMenu.tablePos }, next);
    tableHeaderMenu = { ...tableHeaderMenu, showIndexColumn: next };
  }

  // Matches @tiptap/extension-table's own default cellMinWidth (this app
  // never configures Table.configure({ cellMinWidth: ... }), so that
  // default is what TableView actually renders with) — a floor so "evenly
  // distribute" on a table with many columns can't shrink one below what
  // the table view itself would already clamp it to.
  const TABLE_CELL_MIN_WIDTH = 25;
  const TABLE_INDEX_MIN_WIDTH = 40;
  const TABLE_CONTENT_MIN_WIDTH = 50;
  const TABLE_NEW_COLUMN_WIDTH = 200;
  const TABLE_NEW_ROW_HEIGHT = 32;
  const TABLE_ADD_ADJUST_DEADZONE = 12;
  const TABLE_ADD_COL_GUTTER = 36;

  function currentTableFitTargetWidth() {
    return Math.max(240, Math.floor(element?.getBoundingClientRect().width || 872));
  }

  function addTableCheckboxColumn() {
    if (!editor || !tableHeaderMenu) return;
    const node = editor.state.doc.nodeAt(tableHeaderMenu.tablePos);
    if (!node || node.type.name !== "table") return;
    tableAddCheckboxColumn(editor, { node, pos: tableHeaderMenu.tablePos });
    tableHeaderMenu = null;
  }

  function defaultTableColumnWidths() {
    const total = currentTableFitTargetWidth();
    const base = Math.floor(total / 3);
    return [base + (total % 3 > 0 ? 1 : 0), base + (total % 3 > 1 ? 1 : 0), base];
  }

  function physicalColCount(node: PMNode): number {
    return node.childCount > 0 ? node.child(0).childCount : 0;
  }

  function tableDimensionText(node: PMNode, rowDelta: number, colDelta: number): string {
    return `${Math.max(1, physicalColCount(node) + colDelta)} × ${Math.max(1, rowCount(node) + rowDelta)}`;
  }

  function minWidthForPhysicalColumn(node: PMNode, index: number): number {
    return node.attrs.showIndexColumn && index === 0 ? TABLE_INDEX_MIN_WIDTH : TABLE_CONTENT_MIN_WIDTH;
  }

  function measureCellNaturalWidth(cell: HTMLElement): number {
    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    const tr = document.createElement("tr");
    const clone = cell.cloneNode(true) as HTMLElement;
    const style = getComputedStyle(cell);
    for (const prop of [
      "font",
      "font-family",
      "font-size",
      "font-weight",
      "letter-spacing",
      "padding-left",
      "padding-right",
      "border-left-width",
      "border-right-width",
      "box-sizing",
      "white-space",
    ]) {
      clone.style.setProperty(prop, style.getPropertyValue(prop));
    }
    table.style.position = "fixed";
    table.style.left = "-10000px";
    table.style.top = "0";
    table.style.width = "max-content";
    table.style.minWidth = "0";
    table.style.tableLayout = "auto";
    table.style.visibility = "hidden";
    clone.style.width = "max-content";
    clone.style.minWidth = "0";
    clone.style.maxWidth = "none";
    tr.appendChild(clone);
    tbody.appendChild(tr);
    table.appendChild(tbody);
    document.body.appendChild(table);
    const width = Math.ceil(clone.getBoundingClientRect().width);
    table.remove();
    return width;
  }

  function measureContentColumnWidths(tableEl: HTMLTableElement, node: PMNode): number[] {
    const off = node.attrs.showIndexColumn ? 1 : 0;
    const widths = Array.from({ length: colCount(node) }, () => TABLE_CONTENT_MIN_WIDTH);
    Array.from(tableEl.rows).forEach((row) => {
      Array.from(row.cells)
        .slice(off)
        .forEach((cell, i) => {
          if (i < widths.length) widths[i] = Math.max(widths[i], measureCellNaturalWidth(cell as HTMLElement));
        });
    });
    return widths;
  }

  function measurePhysicalColumnContentWidth(tableEl: HTMLTableElement, node: PMNode, index: number): number {
    let width = minWidthForPhysicalColumn(node, index);
    Array.from(tableEl.rows).forEach((row) => {
      const cell = row.cells[index] as HTMLElement | undefined;
      if (cell) width = Math.max(width, measureCellNaturalWidth(cell));
    });
    return width;
  }

  function maxVisibleTableContentWidth(tableEl: HTMLTableElement, node: PMNode): number {
    const wrapper = tableEl.closest(".tableWrapper") as HTMLElement | null;
    const rect = wrapper?.getBoundingClientRect() ?? element?.getBoundingClientRect() ?? tableEl.getBoundingClientRect();
    const style = wrapper ? getComputedStyle(wrapper) : null;
    const paddingLeft = style ? Number.parseFloat(style.paddingLeft) || 0 : 0;
    const paddingRight = style ? Number.parseFloat(style.paddingRight) || 0 : 0;
    const addColGutter = wrapper?.classList.contains("wide-table-wrapper") ? TABLE_ADD_COL_GUTTER : 0;
    const indexWidth = node.attrs.showIndexColumn ? TABLE_INDEX_MIN_WIDTH : 0;
    return Math.max(TABLE_CONTENT_MIN_WIDTH, Math.floor(rect.width - paddingLeft - paddingRight - addColGutter - indexWidth));
  }

  function fitColumnWidthsToVisibleTarget(widths: number[], target: number): number[] {
    if (widths.length === 0) return widths;
    const mins = Array.from({ length: widths.length }, () => TABLE_CONTENT_MIN_WIDTH);
    const minTotal = sumSizes(mins);
    const measuredTotal = sumSizes(widths);
    if (measuredTotal <= 0) return mins;
    const goal = Math.max(minTotal, target);
    const scaled = widths.map((w, i) => Math.max(mins[i], Math.floor((w / measuredTotal) * goal)));
    let remaining = goal - sumSizes(scaled);
    for (let i = 0; remaining > 0; i = (i + 1) % scaled.length) {
      scaled[i]++;
      remaining--;
    }
    return scaled;
  }

  function currentPhysicalColumnWidths(tableEl: HTMLTableElement, node: PMNode): number[] {
    const cells = tableEl.rows[0] ? Array.from(tableEl.rows[0].cells) : [];
    return Array.from({ length: physicalColCount(node) }, (_, i) =>
      Math.max(minWidthForPhysicalColumn(node, i), Math.round(cells[i]?.getBoundingClientRect().width ?? TABLE_CONTENT_MIN_WIDTH)),
    );
  }

  function applyLivePhysicalColumnWidths(tableEl: HTMLTableElement, widths: number[]) {
    tableEl.querySelectorAll("colgroup col").forEach((col, i) => {
      (col as HTMLElement).style.width = widths[i] ? `${widths[i]}px` : "";
    });
    tableEl.style.width = `${widths.reduce((sum, w) => sum + w, 0)}px`;
  }

  function distributeColumnsEvenlyAction() {
    if (!editor || !tableHeaderMenu) return;
    const node = editor.state.doc.nodeAt(tableHeaderMenu.tablePos);
    if (!node || node.type.name !== "table") return;
    const cols = colCount(node);
    if (cols <= 0) return;
    const tableEl = tableElAt(tableHeaderMenu.tablePos);
    if (!tableEl) return;
    const indexColWidth = node.attrs.showIndexColumn ? 40 : 0; // matches the index column's own fixed CSS width
    const totalWidth = tableEl.getBoundingClientRect().width - indexColWidth;
    const perCol = Math.max(TABLE_CELL_MIN_WIDTH, Math.floor(totalWidth / cols));
    setColumnWidths(editor, { node, pos: tableHeaderMenu.tablePos }, Array(cols).fill(perCol));
    tableHeaderMenu = null;
    selectedBlockRect = null;
  }

  function fitColumnsToContentAction() {
    if (!editor || !tableHeaderMenu) return;
    const node = editor.state.doc.nodeAt(tableHeaderMenu.tablePos);
    if (!node || node.type.name !== "table") return;
    const cols = colCount(node);
    if (cols <= 0) return;
    const tablePos = tableHeaderMenu.tablePos;
    // Clearing colwidth (see setColumnWidths) isn't itself "size to
    // content" — it's "stop overriding size, fall back to the browser's
    // own table layout", which sizes each column from its content's
    // natural width. There's no explicit "measure content" step because
    // that's exactly what a colwidth-less <table> layout already does.
    const tableEl = tableElAt(tablePos);
    if (!tableEl) return;
    setColumnWidths(editor, { node, pos: tablePos }, measureContentColumnWidths(tableEl, node));
    // TableView's own updateColumns (@tiptap/extension-table) sets
    // min-width once a column's colwidth clears, but never removes a
    // *previously* fixed `width` (e.g. from "evenly distribute" run
    // earlier) — without this, that stale width silently keeps winning and
    // "fit to content" visibly does nothing. <col> elements live in the
    // table's colgroup, a sibling of (not inside) the NodeView's
    // contentDOM, so mutating them directly is safe the same way
    // syncTableHeaderAttrs's table-level attribute writes are: ProseMirror's
    // mutation observer only watches contentDOM.
    tableHeaderMenu = null;
    selectedBlockRect = null;
  }

  function fitTableToWidthAction() {
    if (!editor || !tableHeaderMenu) return;
    const node = editor.state.doc.nodeAt(tableHeaderMenu.tablePos);
    if (!node || node.type.name !== "table") return;
    const cols = colCount(node);
    if (cols <= 0) return;
    const tablePos = tableHeaderMenu.tablePos;
    const tableEl = tableElAt(tablePos);
    if (!tableEl) return;
    const contentTarget = maxVisibleTableContentWidth(tableEl, node);
    const contentWidths = measureContentColumnWidths(tableEl, node);
    setColumnWidths(editor, { node, pos: tablePos }, fitColumnWidthsToVisibleTarget(contentWidths, contentTarget));
    tableHeaderMenu = null;
    selectedBlockRect = null;
  }

  // Popover opened by a plain click (no drag) on a row/column grip — insert
  // above/below (or left/right) and delete-this-row/column actions, so any
  // row or column is reachable without having to drag it to an edge first.
  // rowCount/colCount are snapshotted at open time (same reasoning as
  // tableHeaderMenu's showHeaderRow/Column above) purely to grey out the
  // delete action once a table is down to its last row/column. The grip
  // buttons themselves stopPropagation() on click (see the template) — a
  // plain click still fires a native "click" right after the pointerup that
  // opens this menu, which would otherwise bubble to svelte:window's onclick
  // and close the menu in the same tick it opened.
  let tableRowMenu = $state<{ x: number; y: number; tablePos: number; index: number; rowCount: number } | null>(null);
  let tableColMenu = $state<{
    x: number;
    y: number;
    tablePos: number;
    index: number;
    colCount: number;
  } | null>(null);

  function tableRowMenuRef(): TableRef | null {
    if (!editor || !tableRowMenu) return null;
    const node = editor.state.doc.nodeAt(tableRowMenu.tablePos);
    if (!node || node.type.name !== "table") return null;
    return { node, pos: tableRowMenu.tablePos };
  }

  function tableColMenuRef(): TableRef | null {
    if (!editor || !tableColMenu) return null;
    const node = editor.state.doc.nodeAt(tableColMenu.tablePos);
    if (!node || node.type.name !== "table") return null;
    return { node, pos: tableColMenu.tablePos };
  }

  function insertRowAboveAction() {
    const ref = tableRowMenuRef();
    if (!editor || !ref || !tableRowMenu) return;
    tableAddRow(editor, ref, tableRowMenu.index);
    tableRowMenu = null;
  }

  function insertRowBelowAction() {
    const ref = tableRowMenuRef();
    if (!editor || !ref || !tableRowMenu) return;
    tableAddRow(editor, ref, tableRowMenu.index + 1);
    tableRowMenu = null;
  }

  function deleteRowAction() {
    const ref = tableRowMenuRef();
    if (!editor || !ref || !tableRowMenu || tableRowMenu.rowCount <= 1) return;
    tableDeleteRow(editor, ref, tableRowMenu.index);
    tableRowMenu = null;
  }

  function insertColLeftAction() {
    const ref = tableColMenuRef();
    if (!editor || !ref || !tableColMenu) return;
    tableAddColumn(editor, ref, tableColMenu.index);
    tableColMenu = null;
  }

  function insertColRightAction() {
    const ref = tableColMenuRef();
    if (!editor || !ref || !tableColMenu) return;
    tableAddColumn(editor, ref, tableColMenu.index + 1);
    tableColMenu = null;
  }

  function deleteColAction() {
    const ref = tableColMenuRef();
    if (!editor || !ref || !tableColMenu || tableColMenu.colCount <= 1) return;
    tableDeleteColumn(editor, ref, tableColMenu.index);
    tableColMenu = null;
  }

  function clampMenuCoords(x: number, y: number, width = 190, height = 150) {
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    };
  }

  function visibleColGripCenter(gutter: TableGutter, index: number): { x: number; y: number } | null {
    const col = gutter.cols[index];
    if (!col || !wrapperEl) return null;
    const visible = tableVisibleRect(gutter);
    const left = Math.max(col.left, visible.left);
    const right = Math.min(col.right, visible.right);
    if (right <= left) return null;
    const rect = wrapperEl.getBoundingClientRect();
    return {
      x: rect.left + (left + right) / 2,
      y: rect.top + gutter.tableTop,
    };
  }

  function updateHoveredGrip(clientX: number, clientY: number) {
    if (!tableGutter || !wrapperEl) {
      hoveredRowIndex = null;
      hoveredColIndex = null;
      return;
    }
    const containerRect = wrapperEl.getBoundingClientRect();
    const localY = clientY - containerRect.top;
    const localX = clientX - containerRect.left;
    const rowIdx = tableGutter.rows.findIndex((r) => localY >= r.top && localY <= r.bottom);
    const visible = tableVisibleRect(tableGutter);
    const colIdx = tableGutter.cols.findIndex((c) => {
      const left = Math.max(c.left, visible.left);
      const right = Math.min(c.right, visible.right);
      return right - left >= 24 && localX >= left && localX <= right;
    });
    const boundary =
      tableGutter.resizeBoundaries.find((b) => localY >= b.top && localY <= b.bottom && Math.abs(localX - b.x) <= 5) ?? null;
    hoveredRowIndex = rowIdx === -1 ? null : rowIdx;
    hoveredColIndex = colIdx === -1 ? null : colIdx;
    hoveredTableResizeBoundary = boundary;
  }
  // Floating label that follows the pointer while dragging a row/column
  // grip, naming which row/column is being moved — same recipe as
  // blockDragGhost, since a bare blue insertion line alone doesn't say
  // *what* is about to land there.
  let tableDragLabel = $state<{ text: string; x: number; y: number } | null>(null);

  // nodeDOM(pos) for a table node returns prosemirror-tables' own scroll
  // wrapper <div> (what it registers as the table node's view DOM), not the
  // <table> element nested inside it — drill down one level when needed.
  function tableElAt(pos: number): HTMLTableElement | null {
    const dom = editor?.view.nodeDOM(pos) as HTMLElement | null;
    if (!dom) return null;
    return dom instanceof HTMLTableElement ? dom : dom.querySelector("table");
  }

  // prosemirror-tables renders every table node through its own TableView
  // (see the Table extension's `View` option) rather than Tiptap's usual
  // renderHTML/mergeAttributes pipeline — that NodeView builds the <table>
  // DOM itself and never looks at a node's other attrs, so showHeaderRow/
  // showHeaderColumn (see editor/nodes/table.ts) never reach the live
  // element on their own. Mirroring them onto the DOM by hand after every
  // transaction is what makes the CSS in the .tiptap table[data-show-*]
  // rules below actually apply while editing (markdown/HTML serialization
  // is unaffected — that path uses the schema's DOMSerializer directly, not
  // this NodeView, so it already reflects the attrs correctly).
  //
  // Only ever touch attributes on `tableEl` itself here, never anything
  // inside it (a cell, a row, ...): TableView's ignoreMutation only ignores
  // mutations to the table/colgroup wrapper — anything inside its
  // `contentDOM` (the <tbody>, i.e. every row and cell) is exactly what
  // ProseMirror's own DOM-mutation observer watches for real edits. An
  // earlier version of this function set inline styles directly on header
  // cells, which — despite doing nothing conceptually different from a CSS
  // rule — triggered that observer on every call, which reconciles by
  // reading the DOM back into the document, which re-fires onTransaction,
  // which called this function again: a real infinite toggle loop, caught
  // via a debug log flooding with alternating true/false. CSS attribute
  // selectors sidestep this entirely since nothing inside contentDOM is
  // ever touched.
  function syncTableHeaderAttrs() {
    if (!editor) return;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "table") return;
      const tableEl = tableElAt(pos);
      if (!tableEl) return;
      tableEl.toggleAttribute("data-show-header-row", !!node.attrs.showHeaderRow);
      tableEl.toggleAttribute("data-show-header-column", !!node.attrs.showHeaderColumn);
      tableEl.toggleAttribute("data-show-index-column", !!node.attrs.showIndexColumn);
    });
  }

  function syncActiveTableCell() {
    if (!editor) return;
    editor.view.dom.querySelectorAll(".active-table-cell").forEach((el) => el.classList.remove("active-table-cell"));
    // A rectangular cell selection has its own single outer outline. Do
    // not also draw the editing-cell inset border inside that rectangle.
    if (editor.state.selection instanceof CellSelection) return;
    const from = editor.state.selection.$from;
    for (let depth = from.depth; depth > 0; depth--) {
      const node = from.node(depth);
      if (node.type.name !== "tableCell" && node.type.name !== "tableHeader") continue;
      const dom = editor.view.nodeDOM(from.before(depth)) as HTMLElement | null;
      dom?.classList.add("active-table-cell");
      return;
    }
  }

  function syncTableCellSelectionRect() {
    if (!editor || !wrapperEl || !(editor.state.selection instanceof CellSelection)) {
      tableCellSelectionRect = null;
      tableSelectionToolbarVisible = false;
      cellTextEditingToolbar = false;
      return;
    }
    requestAnimationFrame(() => {
      if (!editor || !wrapperEl || !(editor.state.selection instanceof CellSelection)) {
        tableCellSelectionRect = null;
        tableSelectionToolbarVisible = false;
        return;
      }
      const cells = Array.from(editor.view.dom.querySelectorAll<HTMLElement>("td.selectedCell, th.selectedCell"));
      if (!cells.length) {
        tableCellSelectionRect = null;
        tableSelectionToolbarVisible = false;
        return;
      }
      const wrapper = wrapperEl.getBoundingClientRect();
      const rects = cells.map((cell) => cell.getBoundingClientRect());
      const left = Math.min(...rects.map((rect) => rect.left));
      const right = Math.max(...rects.map((rect) => rect.right));
      const top = Math.min(...rects.map((rect) => rect.top));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      tableCellSelectionRect = {
        left: left - wrapper.left,
        top: top - wrapper.top,
        width: right - left,
        height: bottom - top,
      };
      // A text drag that crosses into a second cell becomes a CellSelection.
      // Put the regular text-formatting toolbar above the rectangle's center.
      if (cellTextEditingToolbar) {
        selectionToolbar = {
          top: top - wrapper.top,
          left: (left + right) / 2 - wrapper.left,
        };
      }
    });
  }

  function showTableSelectionToolbar() {
    if (tableSelectionToolbarHideTimer) clearTimeout(tableSelectionToolbarHideTimer);
    tableSelectionToolbarHideTimer = null;
    tableSelectionToolbarVisible = true;
  }

  function scheduleHideTableSelectionToolbar() {
    if (tableSelectionToolbarHideTimer) clearTimeout(tableSelectionToolbarHideTimer);
    tableSelectionToolbarHideTimer = setTimeout(() => {
      tableSelectionToolbarVisible = false;
      tableSelectionToolbarPinned = false;
      tableSelectionToolbarHideTimer = null;
    }, 180);
  }

  function onTableCellSelectionFinished() {
    cellTextEditingToolbar = false;
    selectionToolbar = null;
    syncTableCellSelectionRect();
    tableSelectionToolbarPinned = true;
    showTableSelectionToolbar();
  }

  function pointInsideTableSelectionUI(clientX: number, clientY: number): boolean {
    if (!editor) return false;
    const cells = Array.from(editor.view.dom.querySelectorAll<HTMLElement>("td.selectedCell, th.selectedCell"));
    if (cells.some((cell) => {
      const rect = cell.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    })) return true;
    const toolbar = wrapperEl?.querySelector<HTMLElement>(".table-cell-selection-toolbar");
    if (!toolbar) return false;
    const rect = toolbar.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function onWindowTableSelectionMouseMove(e: MouseEvent) {
    if (!tableCellSelectionRect) return;
    if (pointInsideTableSelectionUI(e.clientX, e.clientY)) {
      showTableSelectionToolbar();
      tableSelectionToolbarPinned = false;
    } else if (tableSelectionToolbarPinned) {
      tableSelectionToolbarPinned = false;
    } else if (tableSelectionToolbarVisible) {
      scheduleHideTableSelectionToolbar();
    }
  }

  function syncWideTableWrappers() {
    if (!editor) return;
    editor.view.dom.querySelectorAll(".tableWrapper").forEach((wrapper) => {
      const table = wrapper.querySelector("table") as HTMLTableElement | null;
      const tableWidth = table?.getBoundingClientRect().width ?? 0;
      wrapper.classList.toggle("wide-table-wrapper", tableWidth > 1000);
    });
  }

  function queueTableWrapperSync() {
    requestAnimationFrame(syncWideTableWrappers);
  }

  function labelForTableRow(index: number): string {
    const table = tableGutter ? tableElAt(tableGutter.tablePos) : null;
    const row = table?.rows[index];
    const text = row
      ? Array.from(row.cells)
          .map((c) => c.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" · ")
      : "";
    if (text) return text.length > 40 ? `${text.slice(0, 40)}…` : text;
    return t("table.rowLabel", { n: String(index + 1) });
  }

  // The index column (see tableOps.ts's setShowIndexColumn), when present,
  // is always physical grid column 0 — everywhere in this file that reads
  // real DOM <tr>.cells by a "logical" column index (the index the col-grip
  // UI and tableOps.ts's own logical-column API use) has to add this back
  // in to land on the right physical cell.
  function tableColDomOffset(tablePos: number): number {
    const node = editor?.state.doc.nodeAt(tablePos);
    return node?.attrs.showIndexColumn ? 1 : 0;
  }

  function labelForTableCol(index: number): string {
    const table = tableGutter ? tableElAt(tableGutter.tablePos) : null;
    const off = tableGutter ? tableColDomOffset(tableGutter.tablePos) : 0;
    const text = table
      ? Array.from(table.rows)
          .slice(0, 3)
          .map((r) => r.cells[index + off]?.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" · ")
      : "";
    if (text) return text.length > 40 ? `${text.slice(0, 40)}…` : text;
    return t("table.colLabel", { n: String(index + 1) });
  }

  function updateTableGutter(tableEl: HTMLTableElement) {
    if (!editor || !wrapperEl) return;
    let ref: ReturnType<typeof findTable> = null;
    try {
      const pos = editor.view.posAtDOM(tableEl, 0);
      ref = findTable(editor, pos);
    } catch {
      ref = null;
    }
    if (!ref) {
      tableGutter = null;
      return;
    }
    const containerRect = wrapperEl.getBoundingClientRect();
    const tableRect = tableEl.getBoundingClientRect();
    const tableWrapperEl = tableEl.closest(".tableWrapper") as HTMLElement | null;
    const tableWrapperRect = tableWrapperEl?.getBoundingClientRect() ?? tableRect;
    const tableWrapperStyle = tableWrapperEl ? getComputedStyle(tableWrapperEl) : null;
    const scrollRect = scrollEl?.getBoundingClientRect() ?? containerRect;
    const tableViewportLeft = tableWrapperRect.left - containerRect.left;
    const tableViewportRight =
      tableWrapperRect.right -
      containerRect.left -
      (tableWrapperStyle ? Number.parseFloat(tableWrapperStyle.paddingRight) || (tableWrapperEl?.classList.contains("wide-table-wrapper") ? TABLE_ADD_COL_GUTTER : 0) : 0);
    const tableViewportTop = scrollRect.top - containerRect.top;
    const tableViewportBottom = scrollRect.bottom - containerRect.top;
    const rowEls = Array.from(tableEl.rows);
    const rows = rowEls.map((r) => {
      const rect = r.getBoundingClientRect();
      return { top: rect.top - containerRect.top, bottom: rect.bottom - containerRect.top };
    });
    const rowHeights = rows.map((r) => r.bottom - r.top);
    const firstRowCells = rowEls[0] ? Array.from(rowEls[0].cells) : [];
    const colWidths = firstRowCells.map((c) => c.getBoundingClientRect().width);
    // Drop the index column (if any) from the gutter's own column list —
    // it's not draggable/insertable/deletable like a real column, so the
    // col-grip UI (and everything downstream keyed off this array's
    // indices) should never see it at all.
    const contentCells = firstRowCells.slice(tableColDomOffset(ref.pos));
    const cols = contentCells.map((c) => {
      const rect = c.getBoundingClientRect();
      return { left: rect.left - containerRect.left, right: rect.right - containerRect.left };
    });
    const contentColWidths = cols.map((c) => c.right - c.left);
    const resizeBoundaries = firstRowCells.slice(tableColDomOffset(ref.pos)).map((c, i) => {
      const rect = c.getBoundingClientRect();
      const physicalIndex = i + tableColDomOffset(ref.pos);
      return {
        x: rect.right - containerRect.left,
        top: tableRect.top - containerRect.top,
        bottom: tableRect.bottom - containerRect.top,
        index: physicalIndex,
      };
    });
    tableGutter = {
      tablePos: ref.pos,
      tableTop: tableRect.top - containerRect.top,
      tableBottom: tableRect.bottom - containerRect.top,
      tableLeft: tableRect.left - containerRect.left,
      tableRight: tableRect.right - containerRect.left,
      tableViewportLeft,
      tableViewportRight,
      tableViewportTop,
      tableViewportBottom,
      visibleColCount: firstRowCells.length,
      rows,
      cols,
      rowHeights,
      colWidths,
      contentColWidths,
      resizeBoundaries,
    };
  }

  // findTable() walks *up* from a position inside a table to find its
  // enclosing table node — the right tool for updateTableGutter(), which
  // starts from posAtDOM (a position inside the table's DOM). But
  // tableGutter.tablePos already *is* the table's own start position (that's
  // what TableRef.pos means), not a position inside it — re-running
  // findTable() on it resolves one level too shallow (into the table's
  // *parent*) and never matches, so every add/delete/move here would
  // silently no-op. Reading the node directly at that exact position is the
  // correct way to re-derive the same TableRef later.
  function currentTableRef() {
    if (!editor || !tableGutter) return null;
    const node = editor.state.doc.nodeAt(tableGutter.tablePos);
    if (!node || node.type.name !== "table") return null;
    return { node, pos: tableGutter.tablePos };
  }

  function sumSizes(sizes: number[]): number {
    return sizes.reduce((sum, size) => sum + size, 0);
  }

  function tableRowStripRect(gutter: TableGutter) {
    const visible = tableVisibleRect(gutter);
    return { left: visible.left, width: visible.width };
  }

  function tableVisibleRect(gutter: TableGutter) {
    const left = Math.max(gutter.tableLeft, gutter.tableViewportLeft);
    const right = Math.min(gutter.tableRight, gutter.tableViewportRight);
    const width = Math.max(0, right - left);
    return { left, right: left + width, width };
  }

  // Keep each grip centred on an actual visible grid line. When a wide table
  // is horizontally scrolled, its original left edge can be off-screen; the
  // same applies to the top edge of a tall table after vertical scrolling.
  function tableRowGripLeft(gutter: TableGutter) {
    const firstVisibleColumnLine = [gutter.tableLeft, ...gutter.cols.map((col) => col.left)]
      .filter((x) => x >= gutter.tableViewportLeft && x <= gutter.tableViewportRight)
      .sort((a, b) => a - b)[0] ?? gutter.tableViewportLeft;
    return firstVisibleColumnLine - 15 * zoomScale;
  }

  function tableColGripTop(gutter: TableGutter) {
    const firstVisibleRowLine = [gutter.tableTop, ...gutter.rows.map((row) => row.top)]
      .filter((y) => y >= gutter.tableViewportTop && y <= gutter.tableViewportBottom)
      .sort((a, b) => a - b)[0] ?? gutter.tableViewportTop;
    return firstVisibleRowLine - 15 * zoomScale;
  }

  function visibleColumnOffsets(gutter: TableGutter, visible: { left: number; width: number }) {
    return internalOffsets(gutter.colWidths)
      .map((x) => gutter.tableLeft + x - visible.left)
      .filter((x) => x >= 0 && x <= visible.width);
  }

  function internalOffsets(sizes: number[]): number[] {
    const offsets: number[] = [];
    let x = 0;
    for (let i = 0; i < sizes.length - 1; i++) {
      x += sizes[i];
      offsets.push(x);
    }
    return offsets;
  }

  function repeatedSize(sizes: number[], count: number, fallback: number): number[] {
    const size = sizes.length > 0 ? sizes[sizes.length - 1] : fallback;
    return Array.from({ length: count }, () => size);
  }

  function rowPreviewHeights(gutter: TableGutter, adjust: { count: number; removing: boolean }): number[] {
    return adjust.removing
      ? gutter.rowHeights.slice(Math.max(0, gutter.rowHeights.length - adjust.count))
      : repeatedSize([TABLE_NEW_ROW_HEIGHT], adjust.count, TABLE_NEW_ROW_HEIGHT);
  }

  function colPreviewWidths(gutter: TableGutter, adjust: { count: number; removing: boolean }): number[] {
    return adjust.removing
      ? gutter.contentColWidths.slice(Math.max(0, gutter.contentColWidths.length - adjust.count))
      : repeatedSize([TABLE_NEW_COLUMN_WIDTH], adjust.count, TABLE_NEW_COLUMN_WIDTH);
  }

  function colRemovalPreviewRect(gutter: TableGutter, count: number) {
    const selected = gutter.cols.slice(Math.max(0, gutter.cols.length - count));
    const visible = tableVisibleRect(gutter);
    if (!selected.length) return { left: visible.right, width: 0, offsets: [] as number[] };
    const left = Math.max(visible.left, selected[0].left);
    const right = Math.min(visible.right, selected[selected.length - 1].right);
    const offsets = selected
      .slice(0, -1)
      .map((col) => col.right - left)
      .filter((x) => x > 0 && x < right - left);
    return { left, width: Math.max(0, right - left), offsets };
  }

  function trailingWidthStepCount(widths: number[], distance: number, cap: number) {
    if (distance <= 0 || cap <= 0) return 0;
    let total = 0;
    let count = 0;
    for (let i = widths.length - 1; i >= 0 && count < cap; i--) {
      total += widths[i] || TABLE_NEW_COLUMN_WIDTH;
      count++;
      if (distance <= total) return count;
    }
    return count;
  }

  // Drag the add-row strip up/down: down previews adding N rows, up previews
  // removing the trailing N rows (capped at rowCount-1) — nothing is
  // actually added/removed until pointerup, and a plain click (no real
  // movement) falls back to the original "add one row" behavior.
  function onAddRowPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !editor || !wrapperEl || !tableGutter) return;
    const gutter = tableGutter;
    const startY = e.clientY;
    const previousCursor = document.body.style.cursor;
    let started = false;
    tableAddDragAxis = "row";
    hoveredTableResizeBoundary = null;
    document.body.style.cursor = "ns-resize";
    document.documentElement.classList.add("table-row-resizing");

    function onMove(ev: PointerEvent) {
      ev.preventDefault();
      if (!started) {
        started = true;
        tableDragActive = true;
      }
      const delta = ev.clientY - startY;
      if (delta > TABLE_ADD_ADJUST_DEADZONE) {
        const count = Math.max(1, Math.ceil(delta / TABLE_NEW_ROW_HEIGHT));
        tableRowAdjust = { count, removing: false };
      } else if (delta < -TABLE_ADD_ADJUST_DEADZONE) {
        // Only rows that are already empty can be dragged away — a run of
        // content-filled rows at the bottom stops the preview from growing
        // any further, the same limit removeRows() itself enforces.
        const ref = currentTableRef();
        const cap = ref ? Math.min(gutter.rows.length - 1, trailingEmptyRowCount(ref.node)) : 0;
        const rowH = gutter.rows.length > 0 ? (gutter.tableBottom - gutter.tableTop) / gutter.rows.length : TABLE_NEW_ROW_HEIGHT;
        const count = Math.min(Math.max(1, Math.ceil(-delta / rowH)), cap);
        tableRowAdjust = count > 0 ? { count, removing: true } : null;
      } else {
        tableRowAdjust = null;
      }
      const ref = currentTableRef();
      const adjust = tableRowAdjust;
      const strip = tableRowStripRect(gutter);
      tableDimensionLabel =
        ref && adjust
          ? {
              text: tableDimensionText(ref.node, adjust.removing ? -adjust.count : adjust.count, 0),
              left: strip.left + strip.width / 2,
              top: gutter.tableBottom + 28,
            }
          : null;
    }

    function finish() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      tableDragActive = false;
      tableAddDragAxis = null;
      document.body.style.cursor = previousCursor;
      document.documentElement.classList.remove("table-row-resizing");
      const adjust = tableRowAdjust;
      tableRowAdjust = null;
      tableDimensionLabel = null;
      const ref = currentTableRef();
      if (ref) {
        if (!adjust) tableAddRows(editor!, ref, rowCount(ref.node), 1);
        else if (adjust.removing) tableRemoveRows(editor!, ref, rowCount(ref.node) - adjust.count, adjust.count);
        else tableAddRows(editor!, ref, rowCount(ref.node), adjust.count);
      }
      tableGutter = null;
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

  // Same gesture as onAddRowPointerDown, dragging left/right along the
  // add-column strip instead.
  function onAddColPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !editor || !wrapperEl || !tableGutter) return;
    const gutter = tableGutter;
    const startX = e.clientX;
    const previousCursor = document.body.style.cursor;
    let started = false;
    tableAddDragAxis = "col";
    hoveredTableResizeBoundary = null;
    document.body.style.cursor = "ew-resize";
    document.documentElement.classList.add("table-col-adding");

    function onMove(ev: PointerEvent) {
      ev.preventDefault();
      if (!started) {
        started = true;
        tableDragActive = true;
      }
      const delta = ev.clientX - startX;
      if (delta > TABLE_ADD_ADJUST_DEADZONE) {
        const count = Math.max(1, Math.ceil(delta / TABLE_NEW_COLUMN_WIDTH));
        tableColAdjust = { count, removing: false };
      } else if (delta < -TABLE_ADD_ADJUST_DEADZONE) {
        const ref = currentTableRef();
        const cap = ref ? Math.min(gutter.cols.length - 1, trailingEmptyColumnCount(ref.node)) : 0;
        const count = trailingWidthStepCount(gutter.contentColWidths, -delta, cap);
        tableColAdjust = count > 0 ? { count, removing: true } : null;
      } else {
        tableColAdjust = null;
      }
      const ref = currentTableRef();
      const adjust = tableColAdjust;
      const visible = tableVisibleRect(gutter);
      tableDimensionLabel =
        ref && adjust
          ? {
              text: tableDimensionText(ref.node, 0, adjust.removing ? -adjust.count : adjust.count),
              left: visible.right + 34,
              top: (gutter.tableTop + gutter.tableBottom) / 2,
            }
          : null;
    }

    function finish() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      tableDragActive = false;
      tableAddDragAxis = null;
      document.body.style.cursor = previousCursor;
      document.documentElement.classList.remove("table-col-adding");
      const adjust = tableColAdjust;
      tableColAdjust = null;
      tableDimensionLabel = null;
      const ref = currentTableRef();
      if (ref) {
        if (!adjust) tableAddColumns(editor!, ref, colCount(ref.node), 1);
        else if (adjust.removing) tableRemoveColumns(editor!, ref, colCount(ref.node) - adjust.count, adjust.count);
        else tableAddColumns(editor!, ref, colCount(ref.node), adjust.count);
      }
      tableGutter = null;
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

  function onTableColResizePointerDown(e: PointerEvent, boundary: { x: number; top: number; bottom: number; index: number }) {
    if (e.button !== 0 || !editor || !wrapperEl || !tableGutter) return;
    e.preventDefault();
    e.stopPropagation();
    const gutter = tableGutter;
    const ref = currentTableRef();
    const tableEl = ref ? tableElAt(ref.pos) : null;
    if (!ref || !tableEl) return;
    const startX = e.clientX;
    const startWidths = currentPhysicalColumnWidths(tableEl, ref.node);
    let nextWidths = [...startWidths];
    let moved = false;
    const previousCursor = document.body.style.cursor;
    tableDragActive = true;
    tableColResize = { x: boundary.x, top: boundary.top, bottom: boundary.bottom };
    document.body.style.cursor = "col-resize";
    document.documentElement.classList.add("table-col-resizing");

    function onMove(ev: PointerEvent) {
      ev.preventDefault();
      const leftIndex = boundary.index;
      const rightIndex = boundary.index + 1;
      const leftMin = minWidthForPhysicalColumn(ref!.node, leftIndex);
      const rawDelta = ev.clientX - startX;
      if (Math.abs(rawDelta) > 3) moved = true;
      nextWidths = [...startWidths];
      let delta: number;
      if (rightIndex < startWidths.length) {
        const rightMin = minWidthForPhysicalColumn(ref!.node, rightIndex);
        delta = Math.max(leftMin - startWidths[leftIndex], Math.min(rawDelta, startWidths[rightIndex] - rightMin));
        nextWidths[rightIndex] = Math.round(startWidths[rightIndex] - delta);
      } else {
        delta = Math.max(leftMin - startWidths[leftIndex], rawDelta);
      }
      nextWidths[leftIndex] = Math.round(startWidths[leftIndex] + delta);
      applyLivePhysicalColumnWidths(tableEl!, nextWidths);
      tableColResize = { x: boundary.x + delta, top: boundary.top, bottom: boundary.bottom };
    }

    function finish(commit: boolean) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      tableDragActive = false;
      tableColResize = null;
      hoveredTableResizeBoundary = null;
      document.body.style.cursor = previousCursor;
      document.documentElement.classList.remove("table-col-resizing");
      if (!commit) applyLivePhysicalColumnWidths(tableEl!, startWidths);
      if (commit) {
        if (moved) {
          setPhysicalColumnWidths(editor!, ref!, nextWidths);
        } else {
          applyLivePhysicalColumnWidths(tableEl!, startWidths);
          const fitted = [...startWidths];
          fitted[boundary.index] = measurePhysicalColumnContentWidth(tableEl!, ref!.node, boundary.index);
          setPhysicalColumnWidths(editor!, ref!, fitted);
        }
      }
      tableGutter = null;
    }

    function onUp() {
      finish(true);
    }
    function onCancel() {
      finish(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  const TABLE_GRIP_DRAG_THRESHOLD = 4;

  function onRowGripPointerDown(e: PointerEvent, index: number) {
    if (e.button !== 0 || !editor || !wrapperEl || !tableGutter) return;
    e.preventDefault();
    e.stopPropagation();
    const gutter = tableGutter;
    const mids = gutter.rows.map((r) => (r.top + r.bottom) / 2);
    const containerTop = wrapperEl.getBoundingClientRect().top;
    const previousCursor = document.body.style.cursor;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    let slot = index;
    document.body.style.cursor = "grabbing";
    document.documentElement.classList.add("table-grip-dragging");

    function onMove(ev: PointerEvent) {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < TABLE_GRIP_DRAG_THRESHOLD) return;
        started = true;
        tableDragActive = true;
        tableDragLabel = { text: labelForTableRow(index), x: ev.clientX, y: ev.clientY };
      } else if (tableDragLabel) {
        tableDragLabel = { ...tableDragLabel, x: ev.clientX, y: ev.clientY };
      }
      ev.preventDefault();
      // Both containerTop and ev.clientY are raw viewport coordinates,
      // already reflecting whatever CSS zoom is applied — same "screen
      // delta" space gutter.rows/cols were captured in, so no zoomScale
      // conversion is needed here (only the *rendered* indicator position
      // below needs dividing by zoomScale, same reasoning as handleTop).
      const localY = ev.clientY - containerTop;
      slot = slotIndex(mids, localY);
      const boundaryY =
        slot === 0 ? gutter.rows[0].top : slot === gutter.rows.length ? gutter.rows[gutter.rows.length - 1].bottom : (gutter.rows[slot - 1].bottom + gutter.rows[slot].top) / 2;
      tableDropRowY = boundaryY;
    }

    function finish() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      tableDragActive = false;
      tableDropRowY = null;
      tableDragLabel = null;
      document.body.style.cursor = previousCursor;
      document.documentElement.classList.remove("table-grip-dragging");
      if (started) {
        const ref = currentTableRef();
        if (ref) tableMoveRow(editor!, ref, index, slotToTargetIndex(slot, index));
        tableGutter = null;
      } else {
        // Plain click, no drag: open the insert/delete menu for this row.
        // Only one table popup open at a time.
        const ref = currentTableRef();
        if (ref) {
          tableHeaderMenu = null;
          tableColMenu = null;
          selectedBlockRect = null;
          tableRowMenu = { x: e.clientX, y: e.clientY, tablePos: ref.pos, index, rowCount: rowCount(ref.node) };
        }
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

  function onColGripPointerDown(e: PointerEvent, index: number) {
    if (e.button !== 0 || !editor || !wrapperEl || !tableGutter) return;
    e.preventDefault();
    e.stopPropagation();
    const gutter = tableGutter;
    const mids = gutter.cols.map((c) => (c.left + c.right) / 2);
    const containerLeft = wrapperEl.getBoundingClientRect().left;
    const previousCursor = document.body.style.cursor;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    let slot = index;
    document.body.style.cursor = "grabbing";
    document.documentElement.classList.add("table-grip-dragging");

    function onMove(ev: PointerEvent) {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < TABLE_GRIP_DRAG_THRESHOLD) return;
        started = true;
        tableDragActive = true;
        tableDragLabel = { text: labelForTableCol(index), x: ev.clientX, y: ev.clientY };
      } else if (tableDragLabel) {
        tableDragLabel = { ...tableDragLabel, x: ev.clientX, y: ev.clientY };
      }
      ev.preventDefault();
      const localX = ev.clientX - containerLeft;
      slot = slotIndex(mids, localX);
      const boundaryX =
        slot === 0 ? gutter.cols[0].left : slot === gutter.cols.length ? gutter.cols[gutter.cols.length - 1].right : (gutter.cols[slot - 1].right + gutter.cols[slot].left) / 2;
      tableDropColX = boundaryX;
    }

    function finish() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      tableDragActive = false;
      tableDropColX = null;
      tableDragLabel = null;
      document.body.style.cursor = previousCursor;
      document.documentElement.classList.remove("table-grip-dragging");
      if (started) {
        const ref = currentTableRef();
        if (ref) tableMoveColumn(editor!, ref, index, slotToTargetIndex(slot, index));
        tableGutter = null;
      } else {
        // Plain click, no drag: open the insert/delete menu for this
        // column. Only one table popup open at a time.
        const ref = currentTableRef();
        if (ref) {
          tableHeaderMenu = null;
          tableRowMenu = null;
          selectedBlockRect = null;
          const grip = visibleColGripCenter(gutter, index);
          const menu = clampMenuCoords(grip?.x ?? e.clientX, (grip?.y ?? e.clientY) + 18);
          tableColMenu = {
            x: menu.x,
            y: menu.y,
            tablePos: ref.pos,
            index,
            colCount: colCount(ref.node),
          };
        }
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

  // Types that need an async pick/create step (file dialog or a new file on
  // disk) before there's anything to insert.
  const ASYNC_KEYS = new Set(["fileLink", "newPage", "webLink"]);

  let blockTypes = $derived([
    { key: "paragraph", label: t("block.paragraph"), icon: "text", keywords: ["text", "paragraph"] },
    { key: "h1", label: t("block.h1"), icon: "h1", keywords: ["h1", "heading1", "title1"] },
    { key: "h2", label: t("block.h2"), icon: "h2", keywords: ["h2", "heading2", "title2"] },
    { key: "h3", label: t("block.h3"), icon: "h3", keywords: ["h3", "heading3", "title3"] },
    { key: "h4", label: t("block.h4"), icon: "h4", keywords: ["h4", "heading4", "title4"] },
    { key: "h5", label: t("block.h5"), icon: "h5", keywords: ["h5", "heading5", "title5"] },
    { key: "h6", label: t("block.h6"), icon: "h6", keywords: ["h6", "heading6", "title6"] },
    { key: "bulletList", label: t("block.bulletList"), icon: "list-bullet", keywords: ["bullet", "list", "ul"] },
    { key: "orderedList", label: t("block.orderedList"), icon: "list-ordered", keywords: ["number", "ordered", "ol"] },
    { key: "taskList", label: t("block.taskList"), icon: "check-square", keywords: ["todo", "task", "checkbox"] },
    { key: "toggleList", label: t("block.toggleList"), icon: "toggle", keywords: ["toggle", "collapse", "details"] },
    { key: "callout", label: t("block.callout"), icon: "megaphone", keywords: ["callout", "note", "highlight"] },
    { key: "blockquote", label: t("block.blockquote"), icon: "quote", keywords: ["quote", "blockquote"] },
    { key: "codeBlock", label: t("block.codeBlock"), icon: "code", keywords: ["code", "codeblock"] },
    { key: "table", label: t("block.table"), icon: "table", keywords: ["table"] },
    { key: "columns2", label: t("block.columns2"), icon: "columns", keywords: ["column", "columns", "分列", "分栏"] },
    { key: "columns3", label: t("block.columns3"), icon: "columns", keywords: ["column", "columns", "分列", "分栏"] },
    { key: "columns4", label: t("block.columns4"), icon: "columns", keywords: ["column", "columns", "分列", "分栏"] },
    { key: "columns5", label: t("block.columns5"), icon: "columns", keywords: ["column", "columns", "分列", "分栏"] },
    { key: "horizontalRule", label: t("block.horizontalRule"), icon: "minus", keywords: ["hr", "divider", "line"] },
    { key: "webLink", label: t("block.webLink"), icon: "globe", keywords: ["weblink", "link", "url", "http", "网址"] },
    { key: "newPage", label: t("block.newPage"), icon: "page", keywords: ["page", "newpage"] },
    { key: "fileLink", label: t("block.fileLink"), icon: "link", keywords: ["filelink", "file"] },
  ]);

  // Which blockTypes key a real ProseMirror node corresponds to — null for a
  // plain paragraph, which isn't considered to "have a format" (the handle
  // shows the generic "+" for it, same as always). Used both to pick the
  // handle's icon and to decide whether clicking a menu item should convert
  // the block in place instead of inserting a new one after it.
  // parentTypeName disambiguates listItem, which by itself doesn't say
  // whether it's sitting in a bulletList or an orderedList.
  function blockTypeKeyFor(
    node: import("@tiptap/pm/model").Node | null | undefined,
    parentTypeName?: string,
  ): string | null {
    if (!node) return null;
    switch (node.type.name) {
      case "heading":
        return `h${node.attrs.level}`;
      case "columns":
        return `columns${node.attrs.count}`;
      case "listItem":
        return parentTypeName === "orderedList" ? "orderedList" : "bulletList";
      case "taskItem":
        return "taskList";
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

  // The list-item-shaped node's containing list — needed to split that list
  // around just this one item when converting/dragging it (a listItem can't
  // just be replaced in place with a non-listItem: bulletList/orderedList/
  // taskList's schema only allows listItem/taskItem children directly).
  interface ListItemContext {
    listPos: number;
    listNode: import("@tiptap/pm/model").Node;
    itemIndex: number;
  }
  function listContextAt(pos: number): ListItemContext | null {
    if (!editor) return null;
    const resolved = editor.state.doc.resolve(pos);
    const parent = resolved.parent;
    if (parent.type.name !== "bulletList" && parent.type.name !== "orderedList" && parent.type.name !== "taskList") {
      return null;
    }
    return { listPos: resolved.before(resolved.depth), listNode: parent, itemIndex: resolved.index(resolved.depth) };
  }

  // The smallest "row" the handle/drag UI should treat pos as belonging to.
  // For a bulletList/orderedList/taskList, every item shares one top-level
  // block, so resolving to depth 1 (as everything else does — a paragraph,
  // heading, table, etc. is already its own top-level block) would make
  // every single item in a 10-item list resolve to the *same* position: the
  // whole list. Hovering/clicking line 2 of a list would then act on line 1
  // (the list's start). Stopping at the nearest listItem/taskItem ancestor
  // instead makes each item independently addressable.
  function effectiveBlockPos(resolved: import("@tiptap/pm/model").ResolvedPos): number {
    for (let d = resolved.depth; d > 0; d--) {
      const name = resolved.node(d).type.name;
      if (name === "listItem" || name === "taskItem") return resolved.before(d);
      // A coordinate landing exactly on the pixel boundary between two <li>
      // rows resolves to a position that sits directly inside the list
      // itself (between its children), one depth shallower than either
      // item — so the loop above never matches "listItem" and used to fall
      // through all the way to resolved.before(1), i.e. the position right
      // before the *whole list* (item 1), regardless of which two items the
      // mouse was actually between. That made the handle flicker back to
      // item 1 on every row crossing while scanning down a list. Snap to
      // whichever item starts right after this point instead (or, at the
      // list's own end, the item ending right before it) so a boundary
      // always resolves to one of its real neighbors.
      if (name === "bulletList" || name === "orderedList" || name === "taskList") {
        if (resolved.nodeAfter) return resolved.pos;
        if (resolved.nodeBefore) return resolved.pos - resolved.nodeBefore.nodeSize;
      }
    }
    return resolved.before(1);
  }

  // "Empty" for the purposes of deciding whether the "+" button replaces
  // this line in place vs. inserts a fresh one after it. Plain
  // node.content.size === 0 only works for a bare paragraph/heading — a
  // blockquote/callout/toggle/list-item always wraps at least one paragraph,
  // so its content.size is never literally 0 even when that inner paragraph
  // has no text. Tables/horizontalRule are never treated as "empty" here:
  // replacing either of those in place via "+" would be surprising.
  function isEffectivelyEmpty(node: import("@tiptap/pm/model").Node): boolean {
    if (node.type.name === "table" || node.type.name === "horizontalRule") return false;
    if (node.textContent.length > 0) return false;
    let hasAtom = false;
    node.descendants((child) => {
      if (child.isAtom && !child.isText) hasAtom = true;
    });
    return !hasAtom;
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

  function syncContentFromEditor() {
    if (!editor) return;
    const md = (editor.storage as any).markdown.getMarkdown();
    appState.updateActiveContent(md);
  }

  function syncFromEditor() {
    syncContentFromEditor();
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
    return effectiveBlockPos(sel);
  }

  // The whole node's own rect (unlike lineRectNear, which for a table only
  // returns the hovered row) — what a drag-handle click's menu (table-header
  // menu or the "change" block-type menu) actually acts on is always the
  // entire block, so that's what selectedBlockRect highlights.
  function blockRectAt(pos: number): { top: number; left: number; width: number; height: number } | null {
    if (!editor || !wrapperEl) return null;
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!dom) return null;
    const containerRect = wrapperEl.getBoundingClientRect();
    const rect = dom.getBoundingClientRect();
    const contentRect = element?.getBoundingClientRect() ?? rect;
    return {
      top: rect.top - containerRect.top - 4,
      left: contentRect.left - containerRect.left - 8,
      width: contentRect.width + 16,
      height: rect.height + 8,
    };
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
    const cursorBlockPos = editor.isFocused ? topLevelBlockPos() : null;
    const cursorBlock = cursorBlockPos !== null ? editor.state.doc.nodeAt(cursorBlockPos) : null;
    const pos = hoverBlockPos !== null ? hoverBlockPos : cursorBlock?.type.name === "table" ? null : cursorBlockPos;
    if (pos === null) {
      if (!menuOpen) handleTop = null;
      return;
    }
    const hoveredNode = editor.state.doc.nodeAt(pos);
    const listContext = listContextAt(pos);
    const formatKey = blockTypeKeyFor(hoveredNode, listContext?.listNode.type.name);
    handleFormatIcon = formatKey ? (blockTypes.find((bt) => bt.key === formatKey)?.icon ?? null) : null;
    handleIsEmpty = hoveredNode ? isEffectivelyEmpty(hoveredNode) : true;
    const lineRect = lineRectNear(pos, hoverClientY);
    if (!lineRect) {
      handleTop = null;
      return;
    }
    const containerRect = wrapperEl.getBoundingClientRect();
    handleTop = lineRect.top - containerRect.top;
    handleHeight = Math.max(24, lineRect.bottom - lineRect.top);
    if (hoveredNode?.type.name === "table") {
      const tableEl = tableElAt(pos);
      const rect = tableEl?.getBoundingClientRect();
      const tableLeft = rect ? rect.left - containerRect.left : 64;
      handleLeft = tableLeft - handleBtnSize * 2 - 12;
    } else {
      handleLeft = 2;
    }
  }

  function hideTableBlockHandle() {
    if (handleFormatIcon !== "table") return;
    hoverBlockPos = null;
    hoverClientY = null;
    handleTop = null;
    handleFormatIcon = null;
  }

  function targetKeepsTableHandle(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    return !!el?.closest?.(
      ".handle-group, .table-header-menu, .table-action-menu, .table-gutter-btn, .table-gutter-add, .table-col-resize-hit",
    );
  }

  function onWindowClick(e: MouseEvent) {
    if (menuOpen) closeMenu();
    if (slashMenuState.open) slashMenuState.close();
    if (tableHeaderMenu) tableHeaderMenu = null;
    if (tableRowMenu) tableRowMenu = null;
    if (tableColMenu) tableColMenu = null;
    if (imageMenu) imageMenu = null;
    if (highlightPickerOpen) highlightPickerOpen = false;
    if (grammarMenu) grammarMenu = null;
    if (selectedBlockRect) selectedBlockRect = null;
    if (!targetKeepsTableHandle(e.target)) hideTableBlockHandle();
  }

  function onWindowPointerDown(e: PointerEvent) {
    const el = e.target as HTMLElement | null;
    if (tableHeaderMenu && !el?.closest?.(".table-header-menu")) {
      tableHeaderMenu = null;
      selectedBlockRect = null;
    }
    if (tableRowMenu && !el?.closest?.(".table-action-menu")) tableRowMenu = null;
    if (tableColMenu && !el?.closest?.(".table-action-menu")) tableColMenu = null;
    if (imageMenu && !el?.closest?.(".image-menu")) imageMenu = null;
    if (!targetKeepsTableHandle(e.target)) hideTableBlockHandle();
  }

  function isImagePath(path: string): boolean {
    return /\.(apng|avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(path);
  }

  function looksLikeImageSrc(text: string): boolean {
    const trimmed = text.trim();
    return /^(https?:|file:|data:image\/)/i.test(trimmed) ? isImagePath(trimmed) || /^data:image\//i.test(trimmed) : isImagePath(trimmed);
  }

  async function imageSrcForPath(path: string): Promise<string> {
    return api.saveImageAssetFromPath(path);
  }

  function insertImageSrc(src: string) {
    if (!editor || !src) return;
    editor.chain().focus().insertContent({ type: "mdImage", attrs: { src } }).run();
  }

  function placeCursorAtClientPoint(x: number, y: number) {
    if (!editor) return;
    const rect = editor.view.dom.getBoundingClientRect();
    const left = Math.min(Math.max(x, rect.left + 1), rect.right - 1);
    const top = Math.min(Math.max(y, rect.top + 1), rect.bottom - 1);
    const result = editor.view.posAtCoords({ left, top });
    if (result) placeCursorNear(result.pos);
  }

  async function insertImagesFromPaths(paths: string[], coords?: { x: number; y: number }) {
    if (coords) placeCursorAtClientPoint(coords.x, coords.y);
    for (const path of paths.filter(isImagePath)) {
      try {
        insertImageSrc(await imageSrcForPath(path));
      } catch (e) {
        appState.showToast(`${t("toast.insertImageFailed")}: ${e}`);
      }
    }
  }

  function fileToDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("read image failed"));
      reader.readAsDataURL(file);
    });
  }

  async function insertImageFiles(files: File[], coords?: { x: number; y: number }) {
    if (coords) placeCursorAtClientPoint(coords.x, coords.y);
    for (const file of files.filter((f) => f.type.startsWith("image/"))) {
      try {
        const data = await fileToDataURL(file);
        insertImageSrc(await api.saveImageAssetFromData(data, file.type));
      } catch (e) {
        appState.showToast(`${t("toast.insertImageFailed")}: ${e}`);
      }
    }
  }

  function onEditorPaste(e: ClipboardEvent) {
    const clipboardText = e.clipboardData?.getData("text/plain") ?? "";
    const notionCallout = clipboardText.match(/^\s*<aside(?:\s[^>]*)?>\s*([\s\S]*?)\s*<\/aside>\s*$/i);
    if (notionCallout && editor) {
      const calloutMarkdown = notionCallout[1].replace(/^\s*💡\s*/, "");
      const calloutHTML = (editor.storage as any).markdown.parser.parse(calloutMarkdown);
      const container = document.createElement("div");
      container.innerHTML = calloutHTML;
      const content = PMDOMParser.fromSchema(editor.schema).parse(container).content;
      const callout = editor.schema.nodes.callout.createAndFill(null, content);
      e.preventDefault();
      if (callout) {
        editor.view.dispatch(editor.state.tr.replaceSelectionWith(callout).scrollIntoView());
      }
      return;
    }
    const mdnoteTable = e.clipboardData?.getData("application/x-mdnote-table") ?? "";
    if (mdnoteTable && editor) {
      e.preventDefault();
      editor.view.pasteHTML(mdnoteTable, e);
      return;
    }
    // Excel exposes a copied range as both an HTML table and an image file
    // (the latter is only a visual preview of the same cells). Prefer the
    // structured representation so the preview is not inserted after the
    // table as an extra image.
    const html = e.clipboardData?.getData("text/html") ?? "";
    if (/<table(?:\s|>)/i.test(html)) return;
    const plainText = e.clipboardData?.getData("text/plain") ?? "";
    if (plainText.includes("\t") && editor) {
      const table = document.createElement("table");
      const tbody = document.createElement("tbody");
      for (const [rowIndex, line] of plainText.replace(/\r\n?/g, "\n").split("\n").entries()) {
        if (rowIndex === plainText.split(/\r\n?|\n/).length - 1 && line === "") continue;
        const tr = document.createElement("tr");
        for (const value of line.split("\t")) {
          const cell = document.createElement(rowIndex === 0 ? "th" : "td");
          cell.textContent = value;
          tr.append(cell);
        }
        tbody.append(tr);
      }
      table.append(tbody);
      e.preventDefault();
      editor.view.pasteHTML(table.outerHTML, e);
      return;
    }
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) {
      e.preventDefault();
      void insertImageFiles(files);
      return;
    }
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (looksLikeImageSrc(text)) {
      e.preventDefault();
      void imageSrcForPath(text.trim()).then(insertImageSrc).catch((err) => appState.showToast(`${t("toast.insertImageFailed")}: ${err}`));
    }
  }

  function onEditorDrop(e: DragEvent) {
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();
    void insertImageFiles(files, { x: e.clientX, y: e.clientY });
  }

  function onEditorClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (Date.now() < suppressImageClickUntil || target?.closest?.(".image-resize-handle")) {
      e.stopPropagation();
      return;
    }
    const clickedImageSurface = target?.matches?.("img, figcaption[data-role='missing']") ? target : null;
    if (!clickedImageSurface) {
      if (imageMenu) imageMenu = null;
      return;
    }
    const figure = clickedImageSurface.closest?.('figure[data-type="mdnote-image"]') as HTMLElement | null;
    if (!figure || !editor || !wrapperEl) return;
    e.stopPropagation();
    const pos = editor.view.posAtDOM(figure, 0);
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "mdImage") return;
    showImageMenuForFigure(figure, pos, node);
  }

  function onEditorImageContextMenu(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    const surface = target?.matches?.("img, figcaption[data-role='missing']") ? target : null;
    const figure = surface?.closest?.('figure[data-type="mdnote-image"]') as HTMLElement | null;
    if (!figure || !editor) return false;
    e.preventDefault();
    e.stopPropagation();
    const pos = editor.view.posAtDOM(figure, 0);
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "mdImage") return false;
    showImageMenuForFigure(figure, pos, node);
    return true;
  }

  function showImageMenuForFigure(figure: HTMLElement, pos: number, node: PMNode) {
    if (!wrapperEl) return;
    const surface = figure.matches('[data-invalid="true"]')
      ? (figure.querySelector("figcaption[data-role='missing']") as HTMLElement | null)
      : (figure.querySelector("img") as HTMLElement | null);
    const rect = (surface ?? figure).getBoundingClientRect();
    const containerRect = wrapperEl.getBoundingClientRect();
    imageMenu = {
      pos,
      x: rect.left + rect.width / 2 - containerRect.left,
      y: Math.max(0, rect.top - containerRect.top - IMAGE_MENU_GAP - IMAGE_MENU_HEIGHT),
      centered: !!node.attrs.centered,
      widthPercent: Number(node.attrs.widthPercent) || 100,
      src: String(node.attrs.src || ""),
    };
  }

  function toggleImageCentered() {
    if (!editor || !imageMenu) return;
    const node = editor.state.doc.nodeAt(imageMenu.pos);
    if (!node || node.type.name !== "mdImage") {
      imageMenu = null;
      return;
    }
    const centered = !node.attrs.centered;
    editor.view.dispatch(editor.state.tr.setNodeAttribute(imageMenu.pos, "centered", centered));
    imageMenu = { ...imageMenu, centered };
  }

  function syncImageMenuTarget() {
    if (!editor || !imageMenu) return;
    const node = editor.state.doc.nodeAt(imageMenu.pos);
    if (!node || node.type.name !== "mdImage") {
      imageMenu = null;
    }
  }

  function resetImageSize(e: MouseEvent) {
    e.stopPropagation();
    if (!editor || !imageMenu) return;
    const node = editor.state.doc.nodeAt(imageMenu.pos);
    if (!node || node.type.name !== "mdImage") {
      imageMenu = null;
      return;
    }
    editor.view.dispatch(editor.state.tr.setNodeAttribute(imageMenu.pos, "widthPercent", 100));
    imageMenu = { ...imageMenu, widthPercent: 100 };
  }

  function onTableCellTextSelectionStarted() {
    cellTextEditingToolbar = true;
    tableSelectionToolbarVisible = false;
    syncTableCellSelectionRect();
  }

  function deleteImage(e: MouseEvent) {
    e.stopPropagation();
    if (!editor || !imageMenu) return;
    const node = editor.state.doc.nodeAt(imageMenu.pos);
    if (!node || node.type.name !== "mdImage") {
      imageMenu = null;
      return;
    }
    const from = imageMenu.pos;
    editor.view.dispatch(editor.state.tr.delete(from, from + node.nodeSize));
    imageMenu = null;
  }

  async function saveImageAs(e: MouseEvent) {
    e.stopPropagation();
    if (!imageMenu) return;
    try {
      await api.saveImageAs(imageMenu.src);
    } catch (err) {
      appState.showToast(`${t("toast.saveImageFailed")}: ${err}`);
    }
  }

  async function revealImageInExplorer(e: MouseEvent) {
    e.stopPropagation();
    if (!imageMenu) return;
    const path = imageMenu.src.replace(/^file:\/\/\//i, "").replace(/\//g, "\\");
    try {
      await api.revealInExplorer(path);
    } catch (err) {
      appState.showToast(`${t("toast.revealFailed")}: ${err}`);
    }
  }

  function onWrapperPointerDown(e: PointerEvent) {
    onImageResizePointerDown(e);
  }

  function onWrapperMouseDown(e: MouseEvent) {
    if (onImageResizeMouseDown(e)) return;
  }

  function onImageResizePointerDown(e: PointerEvent) {
    const handle = (e.target as HTMLElement | null)?.closest?.(".image-resize-handle") as HTMLElement | null;
    if (!handle || imageResizeActive) return false;
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture?.(e.pointerId);
    startImageResize(handle, e.clientX, e.pointerId);
    return true;
  }

  function onImageResizeMouseDown(e: MouseEvent) {
    const handle = (e.target as HTMLElement | null)?.closest?.(".image-resize-handle") as HTMLElement | null;
    if (!handle || imageResizeActive) return false;
    e.preventDefault();
    e.stopPropagation();
    startImageResize(handle, e.clientX);
    return true;
  }

  function onImageResizeOverlayMove(e: MouseEvent | PointerEvent) {
    if (!imageResizeSession) return;
    e.preventDefault();
    e.stopPropagation();
    imageResizeSession.apply(e.clientX);
  }

  function onImageResizeOverlayUp(e: MouseEvent | PointerEvent) {
    if (!imageResizeSession) return;
    e.preventDefault();
    e.stopPropagation();
    imageResizeSession.finish(true, e.clientX);
  }

  function startImageResize(handle: HTMLElement, clientX: number, pointerId?: number) {
    if (!editor || !wrapperEl) return;
    const handleEl = handle;
    const figure = handle.closest('figure[data-type="mdnote-image"]') as HTMLElement | null;
    const frame = figure?.querySelector(".mdnote-image-frame") as HTMLElement | null;
    if (!figure || !frame) return;
    const figureEl = figure;
    const frameEl = frame;
    const pos = editor.view.posAtDOM(figure, 0);
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "mdImage") return;
    imageResizeActive = true;
    suppressImageClickUntil = Date.now() + 800;
    imageMenu = null;
    const side = handle.dataset.side === "left" ? "left" : "right";
    const startX = clientX;
    const startRect = frameEl.getBoundingClientRect();
    const startWidth = startRect.width;
    const contentWidth = Math.max(120, editor.view.dom.getBoundingClientRect().width);
    const viewportRect = scrollEl?.getBoundingClientRect() ?? wrapperEl.getBoundingClientRect();
    const edgePad = 24;
    const maxWidth =
      side === "right"
        ? Math.max(contentWidth, viewportRect.right - edgePad - startRect.left)
        : Math.max(contentWidth, startRect.right - viewportRect.left - edgePad);
    const minWidth = Math.min(96, contentWidth);
    let nextPercent = Number(node.attrs.widthPercent) || 100;
    const previousCursor = document.body.style.cursor;
    let finished = false;
    document.body.style.cursor = "ew-resize";
    document.documentElement.classList.add("image-resizing");
    figureEl.setAttribute("data-resizing", "true");

    function applyResize(clientX: number) {
      const delta = (clientX - startX) * (side === "right" ? 1 : -1);
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
      nextPercent = Math.round((nextWidth / contentWidth) * 1000) / 10;
      if (nextPercent === 100) {
        frameEl.style.width = "";
        figureEl.removeAttribute("data-width-percent");
      } else {
        frameEl.style.width = `${nextPercent}%`;
        figureEl.setAttribute("data-width-percent", String(nextPercent));
      }
    }

    function onPointerMove(ev: PointerEvent) {
      ev.preventDefault();
      applyResize(ev.clientX);
    }

    function onMouseMove(ev: MouseEvent) {
      ev.preventDefault();
      applyResize(ev.clientX);
    }

    function preventNativeDrag(ev: Event) {
      ev.preventDefault();
      ev.stopPropagation();
    }

    function finish(commit: boolean) {
      if (finished) return;
      finished = true;
      imageResizeSession = null;
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("dragstart", preventNativeDrag, true);
      document.removeEventListener("selectstart", preventNativeDrag, true);
      document.body.style.cursor = previousCursor;
      document.documentElement.classList.remove("image-resizing");
      figureEl.removeAttribute("data-resizing");
      imageResizeActive = false;
      suppressImageClickUntil = Date.now() + 800;
      try {
        if (pointerId !== undefined) handleEl.releasePointerCapture?.(pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
      if (commit) {
        const widthPercent = Math.abs(nextPercent - 100) < 1 ? 100 : nextPercent;
        editor!.view.dispatch(editor!.state.tr.setNodeAttribute(pos, "widthPercent", widthPercent));
      }
    }

    imageResizeSession = {
      apply: applyResize,
      finish(commit, clientX) {
        if (clientX !== undefined) applyResize(clientX);
        finish(commit);
      },
    };

    function onPointerUp(ev: PointerEvent) {
      ev.preventDefault();
      imageResizeSession?.finish(true, ev.clientX);
    }

    function onMouseUp(ev: MouseEvent) {
      ev.preventDefault();
      imageResizeSession?.finish(true, ev.clientX);
    }

    function onPointerCancel(ev: PointerEvent) {
      ev.preventDefault();
    }

    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("dragstart", preventNativeDrag, true);
    document.addEventListener("selectstart", preventNativeDrag, true);
  }

  // Finds the actual rendered line box the handle should sit next to.
  // First splits the block's DOM into "segments" at each real hardBreak
  // (an explicit Enter/backslash-newline the user or source markdown put
  // inside this one node) — see the segments comment below — then, within
  // whichever segment mouseY falls in, anchors to that segment's *first*
  // visual-line rect (a Range fragments into one client rect per wrapped
  // line, unlike Element.getClientRects() which reports one rect for the
  // whole box). A segment that itself word-wraps across several visual
  // rows is still one logical line, so the handle stays pinned to its
  // first row instead of chasing the cursor down through the wrap — but
  // moving into a *different* hardBreak segment of the same block does
  // move the handle, since each such segment reads as its own line to the
  // user even though ProseMirror stores it as one node. Falls back to the
  // block's own bounding rect for an empty block (no text to fragment) or
  // when mouseY isn't available (keyboard-cursor fallback).
  // A Range's getClientRects() only fragments per wrapped visual line when
  // its boundary points sit among actual text/inline content — if instead
  // the range spans whole child *elements* (e.g. selecting an <li>'s
  // contents when that <li> just wraps a single inner <p>), each such
  // child contributes one opaque rect for its *entire* box, wrapped lines
  // and all. That's why a wrapped bullet/task list item used to report a
  // single rect spanning both its visual lines (the handle would land
  // between them) — nodeDOM(pos) for a listItem returns the <li>, one level
  // above where its text actually lives. Descending through single-element
  // wrapper chains (<li> → <p>, a toggle/callout's own single-paragraph
  // wrapper, etc.) until reaching the level that directly holds text/inline
  // content/<br> gets the Range boundaries down to where line-fragmenting
  // actually happens.
  function deepestLineContainer(el: HTMLElement): HTMLElement {
    let cur = el;
    for (;;) {
      let hasInline = false;
      const elementChildren: HTMLElement[] = [];
      for (const node of Array.from(cur.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          if ((node.textContent ?? "").trim().length > 0) hasInline = true;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const child = node as HTMLElement;
          if (child.tagName === "BR" || getComputedStyle(child).display.startsWith("inline")) {
            hasInline = true;
          } else {
            elementChildren.push(child);
          }
        }
      }
      if (hasInline || elementChildren.length !== 1) return cur;
      cur = elementChildren[0];
    }
  }

  function lineRectNear(pos: number, mouseY: number | null): { top: number; bottom: number } | null {
    if (!editor) return null;
    const outer = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!outer) return null;

    // A table is one ProseMirror top-level node (effectiveBlockPos never
    // descends into it — see its own comment), but visually many rows —
    // without this, deepestLineContainer below stops at the tableWrapper
    // div @tiptap/extension-table's TableView renders (nodeDOM(pos) for a
    // table returns that wrapper, not the <table> itself — it has exactly
    // one element child, so deepestLineContainer would otherwise descend
    // *into* the <table>, which itself has 2+ children (colgroup + tbody)
    // and stops there) and the segment logic further down treats the whole
    // table as one "line", pinning the handle-group to the table's own
    // bounding box for its entire height instead of tracking which row the
    // mouse is actually over. Anchoring to the hovered <tr> instead
    // (falling back to the first row when there's no mouseY, e.g. the
    // keyboard-cursor fallback) matches how the row/col grips in the table
    // gutter already track the hovered row.
    const tableEl = outer instanceof HTMLTableElement ? outer : outer.querySelector("table");
    if (tableEl) {
      const rows = Array.from(tableEl.rows);
      if (rows.length === 0) return null;
      if (mouseY !== null) {
        for (const row of rows) {
          const rect = row.getBoundingClientRect();
          if (mouseY >= rect.top && mouseY <= rect.bottom) return { top: rect.top, bottom: rect.bottom };
        }
      }
      const first = rows[0].getBoundingClientRect();
      return { top: first.top, bottom: first.bottom };
    }

    const dom = deepestLineContainer(outer);

    // ProseMirror auto-appends a `.ProseMirror-trailingBreak` <br> to keep
    // an empty trailing line rendered/clickable — that's a rendering aid,
    // not a line break the user authored, so it must not itself split off
    // an extra (empty, non-rendering) segment at the end.
    const breaks = Array.from(dom.querySelectorAll("br")).filter(
      (br) => !br.classList.contains("ProseMirror-trailingBreak"),
    );

    const segments: Range[] = [];
    if (breaks.length === 0) {
      const whole = document.createRange();
      whole.selectNodeContents(dom);
      segments.push(whole);
    } else {
      let startNode: Node = dom;
      let startOffset = 0;
      for (const br of breaks) {
        const seg = document.createRange();
        seg.setStart(startNode, startOffset);
        seg.setEndBefore(br);
        segments.push(seg);
        const parent = br.parentNode!;
        startNode = parent;
        startOffset = Array.prototype.indexOf.call(parent.childNodes, br) + 1;
      }
      const last = document.createRange();
      last.setStart(startNode, startOffset);
      last.setEnd(dom, dom.childNodes.length);
      segments.push(last);
    }

    if (mouseY !== null) {
      for (const seg of segments) {
        const rects = Array.from(seg.getClientRects());
        if (rects.some((r) => mouseY >= r.top && mouseY <= r.bottom)) {
          const first = rects[0];
          return { top: first.top, bottom: first.bottom };
        }
      }
    }
    for (const seg of segments) {
      const rects = Array.from(seg.getClientRects());
      if (rects.length > 0) return { top: rects[0].top, bottom: rects[0].bottom };
    }
    if (typeof dom.getBoundingClientRect !== "function") return null;
    const rect = dom.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    // Center rather than anchor at the top: a horizontalRule's own box (see
    // the .tiptap hr rule) is mostly padding around a 1px line, so anchoring
    // a 24px handle at rect.top would leave it floating well above the
    // visible rule instead of next to it.
    const height = Math.min(rect.height, 24);
    const top = rect.top + (rect.height - height) / 2;
    return { top, bottom: top + height };
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
  // The translucent drag marquee shown while the pointer is held in the
  // left gutter. Block highlights remain separate so the final selection
  // keeps the rounded, one-overlay-per-block treatment.
  let multiSelectMarquee = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  // True only while a selected group is being dragged to a new spot — dims
  // the row overlays the same way a single dragged block dims itself, so it
  // reads as "picked up" instead of just sitting there unselected-looking.
  let multiSelectDragging = $state(false);
  // Set right before we dispatch our own setTextSelection so the
  // onSelectionUpdate handler below can tell "we just finalized a drag-select"
  // apart from "the user clicked/typed elsewhere", which should clear it.
  let applyingMultiSelectSelection = false;

  // -- Selection toolbar: floating "highlight color" button shown above any
  // non-empty text selection, opening a color-grid picker (Notion/office-
  // suite style). Positioned from the live DOM selection's own bounding
  // rect (window.getSelection()) rather than re-deriving it from ProseMirror
  // coordinates — simpler and exactly matches what's visually selected.
  let selectionToolbar = $state<{ top: number; left: number } | null>(null);
  let highlightPickerOpen = $state(false);
  let highlightPickerKind = $state<"highlight" | "text" | "underline">("highlight");
  let highlightPickerPos = $state({ x: 0, y: 0 });
  let highlightCurrentColor = $state<string | null>(null);
  // Snapshot of the selection at the moment the toolbar's button is
  // clicked — applying a color later (especially via the native
  // <input type="color"> dialog, which can steal focus for a while) re-
  // selects this exact range first rather than trusting whatever the
  // "current" selection happens to be by then.
  let pendingHighlightRange: { ranges: { from: number; to: number }[] } | null = null;

  function updateSelectionToolbar() {
    if (!editor || !wrapperEl) {
      selectionToolbar = null;
      return;
    }
    const { selection } = editor.state;
    // CellSelection positioning is derived from the selected cell DOM rects
    // in syncTableCellSelectionRect(), after ProseMirror has painted them.
    if (selection instanceof CellSelection) return;
    if (!editor.isFocused || selection.empty || !(selection instanceof TextSelection)) {
      selectionToolbar = null;
      return;
    }
    const domSel = window.getSelection();
    if (!domSel || domSel.rangeCount === 0) {
      selectionToolbar = null;
      return;
    }
    const rect = domSel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) {
      selectionToolbar = null;
      return;
    }
    // Stored raw (container-relative, not yet divided by zoomScale) — same
    // convention as handleTop/dropIndicatorTop: the division happens once,
    // in the template, at render time.
    const containerRect = wrapperEl.getBoundingClientRect();
    selectionToolbar = {
      top: rect.top - containerRect.top,
      left: rect.left + rect.width / 2 - containerRect.left,
    };
  }

  function openHighlightPicker(e: MouseEvent, kind: "highlight" | "text" | "underline" = "highlight") {
    if (!editor) return;
    e.stopPropagation();
    pendingHighlightRange = {
      ranges: editor.state.selection.ranges.map((range) => ({ from: range.$from.pos, to: range.$to.pos })),
    };
    highlightPickerKind = kind;
    if (kind === "highlight") {
      highlightCurrentColor = editor.isActive("highlight") ? ((editor.getAttributes("highlight").color as string) ?? null) : null;
    } else if (kind === "text") {
      highlightCurrentColor = editor.isActive("textColor") ? ((editor.getAttributes("textColor").color as string) ?? null) : null;
    } else {
      highlightCurrentColor = editor.isActive("underlineColor") ? ((editor.getAttributes("underlineColor").color as string) ?? null) : null;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    highlightPickerPos = { x: rect.left, y: rect.bottom + 6 };
    highlightPickerOpen = true;
  }

  function rangesHaveMark(markName: string, ranges: { from: number; to: number }[]) {
    if (!editor) return false;
    const markType = editor.state.schema.marks[markName];
    if (!markType) return false;
    let found = false;
    for (const { from, to } of ranges) {
      editor.state.doc.nodesBetween(from, to, (node) => {
        if (found) return false;
        if (node.isText && markType.isInSet(node.marks)) found = true;
      });
      if (found) break;
    }
    return found;
  }

  function applyHighlightColor(color: string | null) {
    highlightPickerOpen = false;
    if (!editor || !pendingHighlightRange) return;
    const { ranges } = pendingHighlightRange;
    const hasUnderline = rangesHaveMark("underline", ranges);
    const hasWavyUnderline = rangesHaveMark("wavyUnderline", ranges);
    const hasDotUnderline = rangesHaveMark("dotUnderline", ranges);
    // Do not recreate this as a TextSelection. For a range spanning table
    // cells, `from`/`to` can sit on cell boundaries; coercing those boundary
    // positions into a TextSelection makes tableEditing repair the grid and
    // can materialize an extra leading column in a separate, non-obvious
    // transaction. Marks can be applied directly across the document range
    // without changing either the selection or the table structure.
    const tr = editor.state.tr;
    const applyMark = (name: string, attrs?: Record<string, unknown>) => {
      const type = editor!.state.schema.marks[name];
      if (type) for (const { from, to } of ranges) tr.addMark(from, to, type.create(attrs));
    };
    const removeMark = (name: string) => {
      const type = editor!.state.schema.marks[name];
      if (type) for (const { from, to } of ranges) tr.removeMark(from, to, type);
    };
    if (highlightPickerKind === "highlight") {
      if (color) applyMark("highlight", { color });
      else removeMark("highlight");
    } else if (highlightPickerKind === "text") {
      if (color) applyMark("textColor", { color });
      else removeMark("textColor");
    } else {
      if (color) {
        applyMark("underlineColor", { color });
        if (!hasUnderline && !hasWavyUnderline && !hasDotUnderline) applyMark("wavyUnderline");
      }
      else removeMark("underlineColor");
    }
    if (tr.docChanged) editor.view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
    pendingHighlightRange = null;
  }

  // -- Grammar-error right-click menu: shown when grammar check is on and
  // the user right-clicks a word carrying the "grammar-error" decoration
  // (see grammarCheck.ts's buildDecorations — a plain inline <span>, not a
  // mark, so its range is derived from the DOM node's own text rather than
  // getMarkRange). Offers nspell's spelling suggestions plus "add to
  // dictionary".
  let grammarMenu = $state<{ x: number; y: number; from: number; to: number; word: string; suggestions: string[] } | null>(
    null,
  );

  function onEditorContextMenu(e: MouseEvent) {
    if (!editor || !appState.settings.grammarCheckEnabled) return;
    const target = (e.target as HTMLElement | null)?.closest?.(".grammar-error") as HTMLElement | null;
    if (!target) return;
    const word = target.textContent ?? "";
    if (!word) return;
    const from = editor.view.posAtDOM(target, 0);
    const to = from + word.length;
    const speller = peekSpeller();
    const nspellSuggestions = speller ? speller.suggest(word) : [];
    // A dictionary entry differing only by case is a stronger, already-
    // approved suggestion — put it first, ahead of nspell's own guesses.
    const dictMatch = findDictionaryCaseMatch(word);
    const suggestions = (dictMatch ? [dictMatch, ...nspellSuggestions.filter((s) => s !== dictMatch)] : nspellSuggestions).slice(
      0,
      5,
    );
    e.preventDefault();
    grammarMenu = { x: e.clientX, y: e.clientY, from, to, word, suggestions };
  }

  function applyGrammarSuggestion(suggestion: string) {
    if (!editor || !grammarMenu) return;
    const { from, to } = grammarMenu;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.insertText(suggestion, from, to);
        return true;
      })
      .run();
    grammarMenu = null;
  }

  async function addGrammarWordToDictionary() {
    if (!grammarMenu) return;
    const word = grammarMenu.word;
    grammarMenu = null;
    addCustomDictionaryWord(word);
    if (editor) recomputeGrammarDecorations(editor.view);
    await appState.addDictionaryWord(word);
  }

  function toggleInlineFormat(e: MouseEvent, format: "bold" | "italic" | "strike" | "underline" | "wavyUnderline" | "dotUnderline") {
    e.stopPropagation();
    if (!editor) return;
    const chain = editor.chain().focus();
    if (format === "bold") chain.toggleBold();
    else if (format === "italic") chain.toggleItalic();
    else if (format === "strike") chain.toggleStrike();
    else if (format === "underline") {
      if (editor.isActive("underline")) chain.unsetUnderline();
      else chain.unsetMark("wavyUnderline").unsetMark("dotUnderline").setUnderline();
    } else if (format === "wavyUnderline") {
      if (editor.isActive("wavyUnderline")) chain.unsetMark("wavyUnderline");
      else chain.unsetUnderline().unsetMark("dotUnderline").setMark("wavyUnderline");
    } else {
      if (editor.isActive("dotUnderline")) chain.unsetMark("dotUnderline");
      else chain.unsetUnderline().unsetMark("wavyUnderline").setMark("dotUnderline");
    }
    chain.run();
  }

  function clearSelectedTableCells() {
    if (!editor || !(editor.state.selection instanceof CellSelection)) return;
    deleteCellSelection(editor.state, editor.view.dispatch);
  }

  function selectedTableClipboard(): { text: string; html: string } | null {
    if (!editor || !(editor.state.selection instanceof CellSelection)) return null;
    // Explicitly provide both clipboard representations. ProseMirror's
    // generic CellSelection text serializer can flatten complex cell
    // content without row/column separators; TSV keeps the same structure
    // users get when copying a range from Excel into a plain-text field.
    const selected = Array.from(editor.view.dom.querySelectorAll<HTMLElement>("td.selectedCell, th.selectedCell"));
    const rows = selected.reduce((result, cell) => {
      const sourceRow = cell.closest("tr") as HTMLTableRowElement | null;
      if (!sourceRow) return result;
      const last = result.at(-1);
      if (!last || last.source !== sourceRow) result.push({ source: sourceRow, cells: [] });
      result.at(-1)!.cells.push(cell);
      return result;
    }, [] as { source: HTMLTableRowElement; cells: HTMLElement[] }[]);
    const cleanText = (cell: HTMLElement) => (cell.innerText || cell.textContent || "")
      .replace(/\r?\n|\t/g, " ")
      .trim();
    const text = rows.map((row) => row.cells.map(cleanText).join("\t")).join("\r\n");
    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const cell of row.cells) {
        const cleanCell = document.createElement(cell.tagName.toLowerCase());
        for (const attr of ["rowspan", "colspan"]) {
          const value = cell.getAttribute(attr);
          if (value) cleanCell.setAttribute(attr, value);
        }
        cleanCell.textContent = cleanText(cell);
        tr.append(cleanCell);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    return { text, html: excelClipboardHTML(table) };
  }

  // Spreadsheet-aware editors distinguish an Excel range from an ordinary
  // web table using these Office markers. Without them ChatGPT renders the
  // HTML table directly and squeezes every column to the composer width;
  // with them it follows its spreadsheet/TSV paste path, like real Excel.
  function excelClipboardHTML(table: HTMLTableElement): string {
    table.setAttribute("border", "0");
    table.setAttribute("cellpadding", "0");
    table.setAttribute("cellspacing", "0");
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><meta name="ProgId" content="Excel.Sheet"><style>td,th{white-space:nowrap}</style></head><body><!--StartFragment-->${table.outerHTML}<!--EndFragment--></body></html>`;
  }

  function wholeTableClipboard(): { text: string; html: string } | null {
    if (!editor) return null;
    const { from, to } = editor.state.selection;
    let tablePos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (tablePos === null && node.type.name === "table" && from <= pos && to >= pos + node.nodeSize) {
        tablePos = pos;
        return false;
      }
      return tablePos === null;
    });
    if (tablePos === null) return null;
    const nodeDom = editor.view.nodeDOM(tablePos) as HTMLElement | null;
    const sourceTable = nodeDom?.matches("table")
      ? (nodeDom as HTMLTableElement)
      : nodeDom?.querySelector<HTMLTableElement>("table") ?? null;
    if (!sourceTable) return null;
    const text = Array.from(sourceTable.rows)
      .map((row) => Array.from(row.cells)
        .map((cell) => (cell.innerText || cell.textContent || "").replace(/\r?\n|\t/g, " ").trim())
        .join("\t"))
      .join("\r\n");
    // Keep the HTML deliberately as flat as Excel's clipboard table. Rich
    // editors such as ChatGPT prefer text/html over text/plain; leaving
    // ProseMirror's <p> wrappers inside cells makes those editors interpret
    // every cell as an unrelated paragraph instead of a table row.
    const cleanTable = document.createElement("table");
    const tbody = document.createElement("tbody");
    for (const sourceRow of Array.from(sourceTable.rows)) {
      const tr = document.createElement("tr");
      for (const sourceCell of Array.from(sourceRow.cells)) {
        const cell = document.createElement(sourceCell.tagName.toLowerCase());
        for (const attr of ["rowspan", "colspan"]) {
          const value = sourceCell.getAttribute(attr);
          if (value) cell.setAttribute(attr, value);
        }
        cell.textContent = (sourceCell.innerText || sourceCell.textContent || "").replace(/\r?\n|\t/g, " ").trim();
        tr.append(cell);
      }
      tbody.append(tr);
    }
    cleanTable.append(tbody);
    return { text, html: excelClipboardHTML(cleanTable) };
  }

  function onEditorCopy(event: ClipboardEvent) {
    // Cell selections and the whole-table block menu take different
    // ProseMirror selection paths. Cover both so Ctrl+C and both menu copy
    // buttons always expose an Excel-compatible TSV plain-text flavor.
    const data = selectedTableClipboard() ?? wholeTableClipboard();
    if (!data || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", data.text);
    // External rich-text inputs (notably ChatGPT) prefer text/html and then
    // squeeze the table into their composer. Expose TSV to other apps, while
    // retaining rich table data in an MDNote-only clipboard flavor.
    event.clipboardData.setData("application/x-mdnote-table", data.html);
  }

  async function copySelectedTableCells() {
    if (!editor || !(editor.state.selection instanceof CellSelection)) return;
    editor.view.focus();
    const copied = document.execCommand("copy");
    if (!copied) {
      const data = selectedTableClipboard();
      if (data) await navigator.clipboard.writeText(data.text);
    }
  }

  function deleteSelectedTableRowsAndColumns() {
    if (!editor || !(editor.state.selection instanceof CellSelection)) return;
    const selection = editor.state.selection;
    const ref = findTable(editor, selection.$anchorCell.pos);
    if (!ref) return;
    const tableStart = ref.pos + 1;
    const rect = TableMap.get(ref.node).rectBetween(
      selection.$anchorCell.pos - tableStart,
      selection.$headCell.pos - tableStart,
    );
    tableDeleteSelectedRowsAndColumns(editor, ref, rect.top, rect.bottom, rect.left, rect.right);
    tableCellSelectionRect = null;
    tableSelectionToolbarVisible = false;
  }

  function clearSelectionFormatting(e: MouseEvent) {
    e.stopPropagation();
    if (!editor) return;
    const { from, to } = editor.state.selection;
    editor.chain().focus().setTextSelection({ from, to }).unsetAllMarks().run();
  }

  function onEditorScroll() {
    updateHandle();
    updateSelectionToolbar();
    if (tableGutter) {
      const table = tableElAt(tableGutter.tablePos);
      if (table) updateTableGutter(table);
    }
  }

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
      rects.push({ top: rect.top - containerRect.top - 4, height: rect.height + 8 });
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
    multiSelectMarquee = null;
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

  // Starts a margin drag-select anywhere to the left of the editable column.
  // Only concrete controls are excluded; transparent handle-container space
  // and the vertical gaps beside blocks remain valid drag starting points.
  // that moves past a threshold before release selects every whole block
  // the pointer has crossed, Notion-style. A plain click (no movement)
  // instead just clears whatever selection was already showing, matching
  // "click elsewhere to deselect".
  function onMarginPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !editor || !wrapperEl) return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest?.(
        ".block-handle, .drag-handle, .block-menu, .block-drag-ghost, .table-gutter-btn, .table-gutter-add, .table-col-resize-hit",
      )
    )
      return;
    // The editor-scroll listener already limits this to the editor pane. Do
    // not clamp Y to the ProseMirror DOM box: headings, lists, tables and
    // collapsed blocks all create real vertical gaps where a drag must still
    // be able to start. blockPosAtClientPoint safely clamps Y to the nearest
    // document block for those gaps.
    const contentRect = editor.view.dom.getBoundingClientRect();
    if (e.clientX >= contentRect.left) return;
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
      const wrapperRect = wrapperEl!.getBoundingClientRect();
      const left = Math.min(startX, ev.clientX) - wrapperRect.left;
      const top = Math.min(startY, ev.clientY) - wrapperRect.top;
      multiSelectMarquee = {
        left,
        top,
        width: Math.abs(ev.clientX - startX),
        height: Math.abs(ev.clientY - startY),
      };
      const currentPos = blockPosAtClientPoint(ev.clientX, ev.clientY);
      if (currentPos === null) return;
      setMultiSelectRange(anchorPos!, currentPos);
      ev.preventDefault();
    }

    function finish() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      multiSelectMarquee = null;
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
    return blockTypes.find((bt) => bt.key === key)?.label ?? t("editor.contentBlock");
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
    // Listener lives on .editor-scroll (full width), not the narrower
    // max-width:1000px content column, so the handle keeps following the
    // mouse through the side margins too. posAtCoords needs a coordinate
    // that actually lands over the doc though, so clamp x into the
    // contenteditable's own horizontal bounds — same trick as
    // onWrapperDblClick below.
    const box = editor.view.dom.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX, box.left + 1), box.right - 1);
    const target = e.target as HTMLElement | null;
    // A horizontalRule renders as a hairline with most of its visual gap
    // living in padding/margin, not the line itself — posAtCoords maps
    // coordinates to the nearest *text* position, so hovering that padding
    // finds nothing (or resolves into whichever paragraph is nearest) and
    // the handle never lands on the divider. Resolving straight from the
    // DOM element sidesteps that: posAtDOM always finds its exact position
    // regardless of how little of its box carries real content.
    const hrEl = target?.closest?.("hr") as HTMLElement | null;
    let pos: number;
    if (hrEl && editor.view.dom.contains(hrEl)) {
      pos = editor.view.posAtDOM(hrEl, 0);
    } else {
      const result = editor.view.posAtCoords({ left: x, top: e.clientY });
      if (!result) return;
      const resolved = editor.state.doc.resolve(result.pos);
      if (resolved.depth < 1) return;
      pos = effectiveBlockPos(resolved);
    }
    hoverClientY = e.clientY;
    hoverBlockPos = pos;
    updateHandle();

    const tableEl = target?.closest?.("table") as HTMLTableElement | null;
    if (tableEl) {
      updateTableGutter(tableEl);
      if (!tableDragActive) updateHoveredGrip(e.clientX, e.clientY);
    } else if (tableGutter && !tableDragActive && !target?.closest?.(".table-gutter-btn, .table-gutter-add, .table-col-resize-hit")) {
      // The grip/add buttons are absolutely-positioned siblings of the
      // <table>, not descendants of it — closest("table") alone would fail
      // the instant the cursor reaches one of them (reached by moving off
      // the table into the gutter strip to its left/above), clearing the
      // gutter out from under the very controls the user is trying to grab.
      tableGutter = null;
      hoveredRowIndex = null;
      hoveredColIndex = null;
      hoveredTableResizeBoundary = null;
    }
  }

  function onContentMouseLeave() {
    if (dragSource) return;
    hoverBlockPos = null;
    hoverClientY = null;
    if (!menuOpen) updateHandle();
    if (!tableDragActive) {
      tableGutter = null;
      hoveredRowIndex = null;
      hoveredColIndex = null;
      hoveredTableResizeBoundary = null;
    }
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
    if (
      target?.closest?.(
        ".tiptap, .handle-group, .block-menu, .block-drag-ghost, .block-drop-indicator, .table-gutter-btn, .table-gutter-add, .table-col-resize-hit",
      )
    )
      return;
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
    let blockPos = effectiveBlockPos(resolved);
    if (multiSelectDragging) {
      // A multi-block group selection has no sensible single-row form, so
      // it can't be wrapped into one list item — always target whole
      // top-level positions for it, same as before per-item targeting
      // existed. A single-row drag (the common case) can target any row,
      // in any list, or any top-level block — commitBlockMove wraps/
      // unwraps as needed to fit wherever it lands.
      blockPos = resolved.before(1);
    }
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
    const sourceNode = editor.state.doc.nodeAt(source.from);
    // doc.slice rather than a single doc.nodeAt(source.from): source can now
    // be either one block (the "⋮⋮" handle) or a whole multi-select range
    // (dragging a group by one of its members' handles) — both are just a
    // [from, to) span of whole top-level nodes, so the same move works for
    // either without the caller needing to special-case which one it is.
    const slice = editor.state.doc.slice(source.from, source.to);
    if (slice.content.size === 0) return;

    const sourceRowType =
      sourceNode?.type.name === "listItem" || sourceNode?.type.name === "taskItem" ? sourceNode.type.name : null;
    const targetRowType =
      targetNode.type.name === "listItem" || targetNode.type.name === "taskItem" ? targetNode.type.name : null;

    // What's actually being placed at the destination: unwrapped one level
    // (the row's own children, not the row itself) when the source is a
    // list/task row — group drags never resolve to one, so this is always
    // the plain slice content for those.
    const coreChildren: import("@tiptap/pm/model").Node[] = [];
    if (sourceRowType && sourceNode) {
      sourceNode.content.forEach((child) => coreChildren.push(child));
    } else {
      slice.content.forEach((child) => coreChildren.push(child));
    }
    // Re-wrapped into whatever row type the destination needs (listItem for
    // a bulletList/orderedList target, taskItem for a taskList target), or
    // left as top-level content when landing outside any list — this one
    // path covers dropping a plain block into the middle of a list,
    // dragging a list row out to become a plain block, and moving a row
    // between differently-typed lists (bullet/ordered share the listItem
    // node type already; list<->task additionally goes through this
    // wrap/unwrap). listItem requires its first child specifically be a
    // paragraph (schema: "paragraph block*") — prepend an empty one if the
    // dragged content doesn't start with one (e.g. a heading or table),
    // rather than leaving a schema-invalid list item.
    let insertFragment: Fragment;
    try {
      if (targetRowType) {
        const rowType = editor.state.schema.nodes[targetRowType];
        const attrs = targetRowType === "taskItem" ? { checked: false } : null;
        let children = coreChildren;
        if (children[0]?.type.name !== "paragraph") {
          children = [editor.state.schema.nodes.paragraph.create(), ...children];
        }
        insertFragment = Fragment.from(rowType.create(attrs, children));
      } else {
        insertFragment = Fragment.from(coreChildren);
      }
    } catch {
      // Schema rejected the wrap (e.g. a taskItem only accepts paragraphs,
      // no headings/tables/etc.) — leave the document untouched rather than
      // half-apply an invalid move.
      appState.showToast(t("editor.cannotDropHere"));
      return;
    }

    // If the dragged row is the *only* item in its list, deleting just that
    // item would leave an empty list behind (bulletList/orderedList/
    // taskList's schema requires at least one child) — widen the deletion
    // to the whole list in that case, since there'd be nothing left in it.
    let deleteFrom = source.from;
    let deleteTo = source.to;
    if (sourceRowType) {
      const sourceStartResolved = editor.state.doc.resolve(source.from);
      const sourceParent = sourceStartResolved.parent;
      if (sourceParent.childCount === 1) {
        deleteFrom = sourceStartResolved.before(sourceStartResolved.depth);
        deleteTo = deleteFrom + sourceParent.nodeSize;
      }
    }
    let insertPos = position === "before" ? targetPos : targetPos + targetNode.nodeSize;
    let tr = editor.state.tr.delete(deleteFrom, deleteTo);
    // Deleting the source shifts every position after it; correct the
    // target position for that before inserting there.
    if (insertPos > deleteTo) {
      insertPos -= deleteTo - deleteFrom;
    } else if (insertPos > deleteFrom) {
      insertPos = deleteFrom;
    }
    tr = tr.insert(insertPos, insertFragment);
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
    // Multi-select ranges are always whole top-level blocks (blockPosAtClientPoint
    // never resolves into a list item), so comparing the listItem-aware pos
    // against it still works: a list item's start position falls inside its
    // list's [from,to) range whenever that list is part of the selection.
    const isGroupDrag = !!multiSelectRange && pos >= multiSelectRange.from && pos < multiSelectRange.to;
    let source: { from: number; to: number };
    let ghostLabel: string;
    if (isGroupDrag) {
      source = multiSelectRange!;
      ghostLabel = t("editor.blockCount", { n: String(countBlocksInRange(source)) });
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
        selectedBlockRect = null;
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
        const clickedNode = editor!.state.doc.nodeAt(pos!);
        selectedBlockRect = blockRectAt(pos!);
        if (clickedNode && clickedNode.type.name === "table") {
          openTableHeaderMenu(e, pos!, clickedNode);
        } else if (clickedNode && clickedNode.type.name === "mdImage") {
          const figure = editor!.view.nodeDOM(pos!) as HTMLElement | null;
          if (figure) showImageMenuForFigure(figure, pos!, clickedNode);
        } else {
          // Plain click, no drag: opens the same menu as the "+" handle, but
          // in "change" mode — always converts the current line in place
          // (per-item for a list line, via insertBlock's listContext handling)
          // regardless of whether it has content.
          toggleMenu("actions");
        }
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
      case "h5":
        return { type: "heading", attrs: { level: 5 } };
      case "h6":
        return { type: "heading", attrs: { level: 6 } };
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
        const tableColumnWidths = defaultTableColumnWidths();
        return {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: tableColumnWidths.map((width) => ({ type: "tableHeader", attrs: { colwidth: [width] }, content: [{ type: "paragraph" }] })),
            },
            {
              type: "tableRow",
              content: tableColumnWidths.map((width) => ({ type: "tableCell", attrs: { colwidth: [width] }, content: [{ type: "paragraph" }] })),
            },
            {
              type: "tableRow",
              content: tableColumnWidths.map((width) => ({ type: "tableCell", attrs: { colwidth: [width] }, content: [{ type: "paragraph" }] })),
            },
          ],
        };
      case "columns2":
      case "columns3":
      case "columns4":
      case "columns5": {
        // Paired with a trailing empty paragraph (same reasoning as
        // horizontalRule below): with content:"block+", Enter inside a
        // column only ever adds another paragraph within that column, so
        // without this there'd be no way to land the cursor after the whole
        // layout to keep writing normally.
        const count = Number(key[key.length - 1]);
        return [
          {
            type: "columns",
            attrs: { count },
            content: Array.from({ length: count }, () => ({ type: "column", content: [{ type: "paragraph" }] })),
          },
          { type: "paragraph" },
        ];
      }
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
          content: extra ? [{ type: key, attrs: { path: extra.path, id: extra.id ?? null } }] : [],
        };
      case "webLink":
        return {
          type: "paragraph",
          content: extra
            ? [{ type: "text", text: extra.title, marks: [{ type: "link", attrs: { href: extra.path } }] }]
            : [],
        };
      default:
        return { type: "paragraph" };
    }
  }

  // Every entry shown by the "turn into" submenu is handled here. Targets
  // without their own text slot (divider/page/file link) keep the original
  // inline content in an adjacent paragraph, so conversion never silently
  // discards the block's contents.
  const CONVERTIBLE_KEYS = new Set([
    "paragraph",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "bulletList",
    "orderedList",
    "taskList",
    "toggleList",
    "callout",
    "blockquote",
    "codeBlock",
    "table",
    "columns2",
    "columns3",
    "columns4",
    "columns5",
    "horizontalRule",
    "webLink",
    "pageLink",
    "fileLink",
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
  function buildConvertedContent(key: string, inline: Record<string, unknown>[], extra?: LinkPick): Record<string, unknown> | Record<string, unknown>[] {
    switch (key) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
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
      case "table": {
        const widths = defaultTableColumnWidths();
        return {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: widths.map((width, index) => ({
                type: "tableHeader",
                attrs: { colwidth: [width] },
                content: [{ type: "paragraph", content: index === 0 ? inline : [] }],
              })),
            },
            ...Array.from({ length: 2 }, () => ({
              type: "tableRow",
              content: widths.map((width) => ({ type: "tableCell", attrs: { colwidth: [width] }, content: [{ type: "paragraph" }] })),
            })),
          ],
        };
      }
      case "columns2":
      case "columns3":
      case "columns4":
      case "columns5": {
        const count = Number(key[key.length - 1]);
        return [
          {
            type: "columns",
            attrs: { count },
            content: Array.from({ length: count }, (_, index) => ({
              type: "column",
              content: [{ type: "paragraph", content: index === 0 ? inline : [] }],
            })),
          },
          { type: "paragraph" },
        ];
      }
      case "horizontalRule":
        return [{ type: "horizontalRule" }, { type: "paragraph", content: inline }];
      case "webLink": {
        const href = extra?.path;
        const linked = href
          ? inline.map((item) => ({
              ...item,
              marks: [
                ...((item.marks as Record<string, unknown>[] | undefined) ?? []).filter((mark) => mark.type !== "link"),
                { type: "link", attrs: { href } },
              ],
            }))
          : inline;
        return { type: "paragraph", content: linked };
      }
      case "pageLink":
      case "fileLink":
        return [
          {
            type: "paragraph",
            content: extra ? [{ type: key, attrs: { path: extra.path, id: extra.id ?? null } }] : [],
          },
          { type: "paragraph", content: inline },
        ];
      default:
        return { type: "paragraph", content: inline };
    }
  }

  // Converting/replacing a list ITEM (as opposed to a normal top-level
  // block) can't just insertContentAt over its range: bulletList/
  // orderedList/taskList's schema only allows listItem/taskItem children
  // directly, so dropping a heading/paragraph/different-list-type node
  // straight into that range would violate it. Instead, split the
  // containing list around this one item — items before it stay in a
  // (possibly now-shorter) list, items after it become a second list, and
  // the new content goes in between, collapsing to a plain whole-list
  // replace when the item was the list's only child.
  function convertListItem(listContext: ListItemContext, newContent: Record<string, unknown> | Record<string, unknown>[]) {
    if (!editor) return;
    const { listPos, listNode, itemIndex } = listContext;
    const listType = listNode.type;
    const beforeChildren: import("@tiptap/pm/model").Node[] = [];
    const afterChildren: import("@tiptap/pm/model").Node[] = [];
    for (let i = 0; i < listNode.childCount; i++) {
      if (i < itemIndex) beforeChildren.push(listNode.child(i));
      else if (i > itemIndex) afterChildren.push(listNode.child(i));
    }
    const pieces: Record<string, unknown>[] = [];
    let landingOffset = 0;
    if (beforeChildren.length) {
      const beforeList = listType.create(listNode.attrs, beforeChildren);
      pieces.push(beforeList.toJSON());
      landingOffset = beforeList.nodeSize;
    }
    pieces.push(...(Array.isArray(newContent) ? newContent : [newContent]));
    if (afterChildren.length) {
      pieces.push(listType.create(listNode.attrs, afterChildren).toJSON());
    }
    editor
      .chain()
      .focus()
      .insertContentAt({ from: listPos, to: listPos + listNode.nodeSize }, pieces)
      .run();
    placeCursorNear(listPos + landingOffset);
  }

  async function resolveAsyncExtra(key: string): Promise<LinkPick | null> {
    if (key === "fileLink") return appState.pickFileLink();
    if (key === "newPage") return appState.createNewPageNear(appState.activeTab?.path ?? null);
    if (key === "webLink") {
      // The insert-new-link flow never shows the dialog's "convert to plain
      // text" option (see WebLinkDialog.svelte's `editing` guard) — this
      // narrows pickWebLink's wider return type back down for that reason,
      // not because { unlink: true } is actually reachable here.
      const result = await appState.pickWebLink();
      return result && "path" in result ? result : null;
    }
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
  // mode distinguishes which button opened the menu — see the "+"/drag
  // handle onclick handlers below:
  //  - "change" (drag handle, ⠿): always "turn into" — the line's own text
  //    is preserved and reshaped into the new type in place, regardless of
  //    whether it's empty.
  //  - "add" (the "+" button): a fresh block is inserted *after* the
  //    current line, current content left untouched — matching its literal
  //    "add a new block" label. The one exception is an empty line, which
  //    has nothing to preserve or displace either way, so both modes
  //    collapse to the same in-place replace for it (nothing left behind).
  async function insertBlock(key: string) {
    if (!editor) return;
    const pos = hoverBlockPos ?? topLevelBlockPos();
    if (pos === null) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const empty = isEffectivelyEmpty(node);
    const listContext = listContextAt(pos);
    const currentFormatKey = blockTypeKeyFor(node, listContext?.listNode.type.name);
    const blockEnd = pos + node.nodeSize;
    const wantsConvert = false;

    let effectiveKey = key;
    let extra: LinkPick | undefined;
    if (ASYNC_KEYS.has(key)) {
      menuOpen = false;
      const picked = await resolveAsyncExtra(key);
      if (!picked || !editor) return;
      extra = picked;
      // newPage isn't a real node type — it creates a file then drops a
      // pageLink chip pointing at it. pageLink/fileLink themselves must stay
      // as-is here, or picking "文件链接" would silently insert a pageLink
      // chip (internal appState.openPath navigation) instead of a fileLink
      // chip (opens with the OS default app) — same bug for both call sites.
      effectiveKey = key === "newPage" ? "pageLink" : key;
    }
    if (!editor) return;

    if (wantsConvert && CONVERTIBLE_KEYS.has(effectiveKey)) {
      if (effectiveKey === currentFormatKey) {
        // Already this format — nothing to do (also avoids gratuitously
        // fragmenting a list into before/after pieces around a no-op).
        menuOpen = false;
        return;
      }
      const inline = extractInlineContent(node);
      const content = buildConvertedContent(effectiveKey, inline, extra);
      if (listContext) {
        convertListItem(listContext, content);
      } else {
        editor.chain().focus().insertContentAt({ from: pos, to: blockEnd }, content).run();
        placeCursorNear(pos);
      }
    } else if (empty) {
      // Empty, but the target isn't a content-preserving "turn into" type
      // (table/hr/pageLink/...) — still replace in place rather than
      // leaving a stray empty line behind.
      const content = buildBlockContent(effectiveKey, extra);
      if (listContext) {
        convertListItem(listContext, content);
      } else {
        editor.chain().focus().insertContentAt({ from: pos, to: blockEnd }, content).run();
        placeCursorNear(pos);
      }
    } else {
      // Non-empty line, "add" mode: leave it untouched, insert the new
      // block right after it.
      const content = buildBlockContent(effectiveKey, extra);
      editor.chain().focus().insertContentAt(blockEnd, content).run();
      placeCursorNear(blockEnd);
    }
    menuOpen = false;
    updateHandle();
  }

  // Copy through ProseMirror's native clipboard pipeline so both plain text
  // and rich HTML describe the complete block (marks, links and structure),
  // rather than reducing it to node.textContent. The previous selection is
  // restored immediately after the synchronous copy event has fired.
  function copyBlockAt(pos: number, e: MouseEvent) {
    e.stopPropagation();
    if (!editor) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const previousSelection = editor.state.selection;
    const selection = TextSelection.create(editor.state.doc, pos, pos + node.nodeSize);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    editor.view.focus();
    const copied = document.execCommand("copy");
    editor.view.dispatch(editor.state.tr.setSelection(previousSelection));
    menuOpen = false;
    tableHeaderMenu = null;
    imageMenu = null;
    selectedBlockRect = null;
    if (!copied) appState.showToast(t("block.copyFailed"));
  }

  function copyHandleBlock(e: MouseEvent) {
    const pos = hoverBlockPos ?? topLevelBlockPos();
    if (pos !== null) copyBlockAt(pos, e);
  }

  // Slash menu: replaces the current (empty, trigger-only) row in place —
  // "row" being the nearest listItem/taskItem when typed inside a list item,
  // same reasoning as effectiveBlockPos, so typing "/" on line 2 of a list
  // doesn't replace the whole list.
  async function applySlash(key: string) {
    if (!editor) return;
    const { $from: cursor } = editor.state.selection;
    const blockStart = effectiveBlockPos(cursor);
    const blockNode = editor.state.doc.nodeAt(blockStart);
    if (!blockNode) return;
    const blockEnd = blockStart + blockNode.nodeSize;
    const listContext = listContextAt(blockStart);
    slashMenuState.close();

    let effectiveKey = key;
    let extra: LinkPick | undefined;
    if (ASYNC_KEYS.has(key)) {
      const picked = await resolveAsyncExtra(key);
      if (!picked || !editor) return;
      extra = picked;
      // newPage isn't a real node type — it creates a file then drops a
      // pageLink chip pointing at it. pageLink/fileLink themselves must stay
      // as-is here, or picking "文件链接" would silently insert a pageLink
      // chip (internal appState.openPath navigation) instead of a fileLink
      // chip (opens with the OS default app) — same bug for both call sites.
      effectiveKey = key === "newPage" ? "pageLink" : key;
    }
    if (!editor) return;
    const content = buildBlockContent(effectiveKey, extra);
    if (listContext) {
      convertListItem(listContext, content);
    } else {
      editor.chain().focus().insertContentAt({ from: blockStart, to: blockEnd }, content).run();
      placeCursorNear(blockStart);
    }
    updateHandle();
  }

  function toggleMenu(mode: "add" | "actions" = "add") {
    menuOpen = !menuOpen;
    menuMode = mode;
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
          codeBlock: false,
          // Its default click-to-open just calls window.open, which inside
          // WebView2 spawns another embedded webview rather than the
          // user's actual browser — LinkClickHandler (links.ts) handles
          // opening via the system default browser instead.
          link: { openOnClick: false },
        }),
        CodeBlock,
        FullwidthHeadingShortcut,
        Markdown.configure({ html: true, transformPastedText: true }),
        SearchHighlight,
        GrammarCheck,
        Highlight.configure({ multicolor: true }),
        WavyUnderline,
        DotUnderline,
        TextColor,
        UnderlineColor,
        Mention,
        JoinAdjacentLists,
        EmptyListItemDelete,
        TaskList,
        TaskItem,
        Table,
        TableRow,
        TableHeader,
        TableCell,
        ToggleList,
        ToggleSummary,
        Callout,
        Columns,
        Column,
        MdImage,
        PageLink,
        FileLink,
        LinkClickHandler,
        Placeholder.configure({
          placeholder: t("editor.placeholder"),
        }),
      ],
      content: appState.activeTab?.content ?? "",
      autofocus: true,
      onUpdate: () => {
        if (switching) return;
        syncContentFromEditor();
        scheduleSync();
        updateHandle();
        updateSlash();
        queueTableWrapperSync();
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
        syncActiveTableCell();
        syncTableCellSelectionRect();
        updateSelectionToolbar();
      },
      onFocus: () => {
        updateHandle();
        syncActiveTableCell();
        queueTableWrapperSync();
      },
      onBlur: () => {
        hideTableBlockHandle();
        if (!menuOpen && hoverBlockPos === null) handleTop = null;
        slashMenuState.close();
        selectionToolbar = null;
        editor?.view.dom.querySelectorAll(".active-table-cell").forEach((el) => el.classList.remove("active-table-cell"));
      },
      onCreate: () => {
        syncTableHeaderAttrs();
        syncActiveTableCell();
        queueTableWrapperSync();
      },
      onTransaction: () => {
        syncUndoRedo();
        syncTableHeaderAttrs();
        syncImageMenuTarget();
        syncActiveTableCell();
        syncTableCellSelectionRect();
        queueTableWrapperSync();
      },
    });
    editorBridge.instance = editor;
    editor.view.dom.addEventListener("mdnote:cell-selection-finished", onTableCellSelectionFinished);
    editor.view.dom.addEventListener("mdnote:cell-text-selection-started", onTableCellTextSelectionStarted);
    editorBridge.scrollToPos = scrollToPos;
    editorBridge.scrollToRange = scrollToRange;
    editorBridge.resetZoom = resetZoom;
    editorBridge.insertImagesFromPaths = (paths: string[], coords?: { x: number; y: number }) => {
      void insertImagesFromPaths(paths, coords);
    };
    setGrammarCheckEnabled(editor.view, appState.settings.grammarCheckEnabled);
    lastTabId = appState.activeTabId;
    refreshDerivedState();
    syncUndoRedo();
    scrollEl?.addEventListener("scroll", onEditorScroll, { passive: true });
    window.addEventListener("resize", queueTableWrapperSync);
    window.addEventListener("mousemove", onWindowTableSelectionMouseMove, true);
  });

  onDestroy(() => {
    if (debounceHandle) clearTimeout(debounceHandle);
    if (tableSelectionToolbarHideTimer) clearTimeout(tableSelectionToolbarHideTimer);
    scrollEl?.removeEventListener("scroll", onEditorScroll);
    window.removeEventListener("resize", queueTableWrapperSync);
    window.removeEventListener("mousemove", onWindowTableSelectionMouseMove, true);
    editor?.view.dom.removeEventListener("mdnote:cell-selection-finished", onTableCellSelectionFinished);
    editor?.view.dom.removeEventListener("mdnote:cell-text-selection-started", onTableCellTextSelectionStarted);
    slashMenuState.onSelect = null;
    slashMenuState.close();
    editor?.destroy();
    editorBridge.instance = null;
    editorBridge.scrollToPos = null;
    editorBridge.scrollToRange = null;
    editorBridge.resetZoom = null;
    editorBridge.insertImagesFromPaths = null;
  });

  $effect(() => {
    editorBridge.zoom = editorZoom;
  });

  $effect(() => {
    const enabled = appState.settings.grammarCheckEnabled;
    if (editor) setGrammarCheckEnabled(editor.view, enabled);
  });

  // Not just an onMount-time read: Editor.svelte mounts (child) before
  // +page.svelte's onMount runs appState.init() (parent) — the async
  // api.getSettings() call inside it hasn't resolved yet when this
  // component first mounts, so appState.settings.customDictionary is still
  // its empty default at that point. A dictionary word added in a previous
  // session would silently never reach the spell-checker's in-memory set on
  // a fresh launch — reading it reactively here (same pattern as
  // grammarCheckEnabled above) re-runs once appState.settings is actually
  // populated, not just once at mount time.
  $effect(() => {
    setCustomDictionary(appState.settings.customDictionary ?? []);
  });

  $effect(() => {
    const tab = appState.activeTab;
    const id = appState.activeTabId;
    if (!editor || id === lastTabId) return;
    lastTabId = id;
    switching = true;
    clearMultiSelect();
    selectionToolbar = null;
    highlightPickerOpen = false;
    // Chained so the addToHistory meta lands on the same transaction as the
    // content replacement: otherwise every tab switch/open pushed a
    // whole-document replace onto the undo stack, and a couple of undos
    // after opening a file could wipe everything just typed.
    editor.chain().setMeta("addToHistory", false).setContent(tab?.content ?? "", { emitUpdate: false }).run();
    switching = false;
    refreshDerivedState();
    updateHandle();
    syncUndoRedo();
    queueTableWrapperSync();
  });
</script>

<svelte:window onpointerdown={onWindowPointerDown} onclick={onWindowClick} onblur={hideTableBlockHandle} onkeydown={onWindowKeydown} />

<div
  class="editor-scroll"
  bind:this={scrollEl}
  onwheel={onEditorWheel}
  onpointerdown={onMarginPointerDown}
  onmousemove={onContentMouseMove}
  onmouseleave={onContentMouseLeave}
  role="presentation"
>
  <div
    class="editor-content-col-wrapper"
    class:multiselect-active={multiSelectRange !== null}
    bind:this={wrapperEl}
    ondblclick={onWrapperDblClick}
    onpointerdown={onWrapperPointerDown}
    onmousedown={onWrapperMouseDown}
    onpastecapture={onEditorPaste}
    oncopycapture={onEditorCopy}
    ondragover={(e) => {
      if (Array.from(e.dataTransfer?.items ?? []).some((item) => item.kind === "file" && item.type.startsWith("image/"))) e.preventDefault();
    }}
    ondrop={onEditorDrop}
    onclick={onEditorClick}
    role="presentation"
    style={`zoom:${editorZoom}%`}
  >
    {#if multiSelectMarquee}
      <div
        class="multi-select-marquee"
        style={`left:${multiSelectMarquee.left / zoomScale}px; top:${multiSelectMarquee.top / zoomScale}px; width:${multiSelectMarquee.width / zoomScale}px; height:${multiSelectMarquee.height / zoomScale}px`}
      ></div>
    {/if}
    {#each multiSelectRects as r, i (i)}
      <div
        class="row-highlight"
        class:dragging={multiSelectDragging}
        style={`top:${r.top / zoomScale}px; height:${r.height / zoomScale}px`}
      ></div>
    {/each}
    {#if selectedBlockRect}
      <div
        class="row-highlight selected-block-highlight"
        style={`top:${selectedBlockRect.top / zoomScale}px; left:${selectedBlockRect.left / zoomScale}px; width:${selectedBlockRect.width / zoomScale}px; height:${selectedBlockRect.height / zoomScale}px`}
      ></div>
    {/if}
    {#if dropTargetRect}
      <div
        class="row-highlight"
        style={`top:${dropTargetRect.top / zoomScale}px; height:${dropTargetRect.height / zoomScale}px`}
      ></div>
    {/if}
    {#if handleTop !== null}
      <div class="handle-group" style={`top:${handleTop / zoomScale}px; left:${handleLeft / zoomScale}px; height:${handleHeight / zoomScale}px`}>
        <button
          class="block-handle"
          class:handle-lg={handleBtnSize === 30}
          title={t("block.add")}
          aria-label={t("block.add")}
          onmousedown={preventBlur}
          onclick={(e) => {
            e.stopPropagation();
            toggleMenu("add");
          }}
        >
          <Icon name="plus" size={handleBtnSize === 30 ? 21 : 19} />
        </button>
        <button
          class="drag-handle"
          class:handle-lg={handleBtnSize === 30}
          title={t("block.drag")}
          aria-label={t("block.drag")}
          onmousedown={preventBlur}
          onpointerdown={onDragHandlePointerDown}
          onclick={(e) => e.stopPropagation()}
        >
          <Icon name="grip" size={handleBtnSize === 30 ? 20 : 18} />
        </button>
      </div>
      {#if menuOpen}
        <div class="block-menu" class:handle-action-menu={menuMode === "actions"} style={`top:${(handleTop + handleHeight + 2) / zoomScale}px`}>
          {#if menuMode === "actions"}
            <button onmousedown={preventBlur} onclick={copyHandleBlock}>
              <span class="menu-symbol">⧉</span>
              <span>{t("block.copy")}</span>
            </button>
          {:else}
            {#each blockTypes as bt (bt.key)}
              <button onmousedown={preventBlur} onclick={() => insertBlock(bt.key)}>
                <Icon name={bt.icon} size={14} />
                <span>{bt.label}</span>
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    {/if}
    {#if imageMenu}
      <div
        class="context-menu image-menu"
        style={`left:${imageMenu.x / zoomScale}px; top:${imageMenu.y / zoomScale}px; width:${IMAGE_MENU_WIDTH / zoomScale}px`}
      >
        <button onmousedown={preventBlur} onclick={(e) => copyBlockAt(imageMenu!.pos, e)}>
          <span class="menu-symbol">⧉</span>
          <span>{t("block.copy")}</span>
        </button>
        <button
          class="switch-row"
          onmousedown={preventBlur}
          onclick={(e) => {
            e.stopPropagation();
            toggleImageCentered();
          }}
        >
          <span>{t("image.center")}</span>
          <span class="switch" class:on={imageMenu.centered}><span class="switch-knob"></span></span>
        </button>
        <button class="image-reset-btn" onmousedown={preventBlur} onclick={resetImageSize}>{t("image.resetSize")}</button>
        <button class="image-reset-btn" onmousedown={preventBlur} onclick={saveImageAs}>{t("image.saveAs")}</button>
        <button class="image-reset-btn" onmousedown={preventBlur} onclick={revealImageInExplorer}>{t("tabs.revealInExplorer")}</button>
        <button class="image-reset-btn danger" onmousedown={preventBlur} onclick={deleteImage}>{t("image.delete")}</button>
      </div>
    {/if}
    {#if tableCellSelectionRect}
      <div
        class="table-cell-selection-outline"
        style={`left:${tableCellSelectionRect.left / zoomScale}px; top:${tableCellSelectionRect.top / zoomScale}px; width:${tableCellSelectionRect.width / zoomScale}px; height:${tableCellSelectionRect.height / zoomScale}px`}
      ></div>
    {/if}
    {#if tableCellSelectionRect && tableSelectionToolbarVisible}
      <div
        class="table-cell-selection-toolbar"
        style={`left:${(tableCellSelectionRect.left + tableCellSelectionRect.width / 2) / zoomScale}px; top:${tableCellSelectionRect.top / zoomScale}px`}
        onclick={(e) => e.stopPropagation()}
        onmouseenter={showTableSelectionToolbar}
        onmouseleave={scheduleHideTableSelectionToolbar}
        role="presentation"
      >
        <button onmousedown={preventBlur} onclick={copySelectedTableCells}>{t("table.copySelectedCells")}</button>
        <button onmousedown={preventBlur} onclick={clearSelectedTableCells}>{t("table.clearSelectedCells")}</button>
        <button class="menu-danger" onmousedown={preventBlur} onclick={deleteSelectedTableRowsAndColumns}>{t("table.deleteSelectedRowsAndColumns")}</button>
      </div>
    {/if}
    {#if dropIndicatorTop !== null}
      <div class="block-drop-indicator" style={`top:${dropIndicatorTop / zoomScale}px`}></div>
    {/if}
    {#if selectionToolbar && !highlightPickerOpen}
      <div
        class="selection-toolbar"
        style={`top:${selectionToolbar.top / zoomScale}px; left:${selectionToolbar.left / zoomScale}px`}
      >
        <button
          class="selection-toolbar-btn"
          title={t("editor.bold")}
          aria-label={t("editor.bold")}
          onmousedown={preventBlur}
          onclick={(e) => toggleInlineFormat(e, "bold")}
        >
          <RasterIcon name="format-bold" size={18} />
        </button>
        <button
          class="selection-toolbar-btn"
          title={t("editor.italic")}
          aria-label={t("editor.italic")}
          onmousedown={preventBlur}
          onclick={(e) => toggleInlineFormat(e, "italic")}
        >
          <RasterIcon name="format-italic" size={18} />
        </button>
        <button
          class="selection-toolbar-btn"
          title={t("editor.strike")}
          aria-label={t("editor.strike")}
          onmousedown={preventBlur}
          onclick={(e) => toggleInlineFormat(e, "strike")}
        >
          <RasterIcon name="format-strike" size={20} />
        </button>
        <button
          class="selection-toolbar-btn"
          title={t("editor.textColor")}
          aria-label={t("editor.textColor")}
          onmousedown={preventBlur}
          onclick={(e) => openHighlightPicker(e, "text")}
        >
          <RasterIcon name="format-text-color" size={18} />
        </button>
        <button
          class="selection-toolbar-btn"
          title={t("editor.highlight")}
          aria-label={t("editor.highlight")}
          onmousedown={preventBlur}
          onclick={(e) => openHighlightPicker(e, "highlight")}
        >
          <RasterIcon name="format-highlight" size={22} />
        </button>
        <button
          class="selection-toolbar-btn"
          title={t("editor.wavyUnderline")}
          aria-label={t("editor.wavyUnderline")}
          onmousedown={preventBlur}
          onclick={(e) => toggleInlineFormat(e, "wavyUnderline")}
        >
          <RasterIcon name="format-wavy" size={20} />
        </button>
        <button
          class="selection-toolbar-btn"
          title={t("editor.underline")}
          aria-label={t("editor.underline")}
          onmousedown={preventBlur}
          onclick={(e) => toggleInlineFormat(e, "underline")}
        >
          <RasterIcon name="format-underline" size={20} />
        </button>
        <button
          class="selection-toolbar-btn"
          title={t("editor.dotUnderline")}
          aria-label={t("editor.dotUnderline")}
          onmousedown={preventBlur}
          onclick={(e) => toggleInlineFormat(e, "dotUnderline")}
        >
          <RasterIcon name="format-dot-underline" size={20} />
        </button>
        <button
          class="selection-toolbar-btn"
          title={t("editor.underlineColor")}
          aria-label={t("editor.underlineColor")}
          onmousedown={preventBlur}
          onclick={(e) => openHighlightPicker(e, "underline")}
        >
          <RasterIcon name="format-underline-color" size={20} />
        </button>
        <button
          class="selection-toolbar-btn"
          title={t("editor.clearFormatting")}
          aria-label={t("editor.clearFormatting")}
          onmousedown={preventBlur}
          onclick={clearSelectionFormatting}
        >
          <RasterIcon name="format-clear" size={20} />
        </button>
      </div>
    {/if}
    {#if highlightPickerOpen}
      <HighlightColorPicker
        x={highlightPickerPos.x}
        y={highlightPickerPos.y}
        current={highlightCurrentColor}
        noneLabel={t(highlightPickerKind === "highlight" ? "editor.highlightNone" : "editor.colorNone")}
        customLabel={t(highlightPickerKind === "highlight" ? "editor.highlightCustom" : "editor.colorCustom")}
        onPick={applyHighlightColor}
      />
    {/if}
    {#if tableGutter}
      {#if !tableAddDragAxis}
        {#each tableGutter.resizeBoundaries as boundary (boundary.index)}
          <div
            class="table-col-resize-hit"
            class:hovered={hoveredTableResizeBoundary?.index === boundary.index}
            style={`left:${boundary.x / zoomScale - 5}px; top:${boundary.top / zoomScale}px; height:${(boundary.bottom - boundary.top) / zoomScale}px`}
            onpointerenter={() => (hoveredTableResizeBoundary = boundary)}
            onpointerdown={(e) => onTableColResizePointerDown(e, boundary)}
            role="presentation"
          ></div>
        {/each}
        {#if hoveredTableResizeBoundary || tableColResize}
          {@const boundary = tableColResize ?? hoveredTableResizeBoundary!}
          <div
            class="table-col-resize-indicator"
            style={`left:${boundary.x / zoomScale}px; top:${boundary.top / zoomScale}px; height:${(boundary.bottom - boundary.top) / zoomScale}px`}
          ></div>
        {/if}
      {/if}
      {#if hoveredRowIndex !== null}
        {@const rowIndex = hoveredRowIndex}
        {@const row = tableGutter.rows[rowIndex]}
        <button
          class="table-gutter-btn table-row-grip"
          style={`top:${(row.top + row.bottom) / 2 / zoomScale - 15}px; left:${tableRowGripLeft(tableGutter) / zoomScale}px`}
          title={t("table.rowGrip")}
          aria-label={t("table.rowGrip")}
          onmousedown={preventBlur}
          onpointerdown={(e) => onRowGripPointerDown(e, rowIndex)}
          onclick={(e) => e.stopPropagation()}
        >
          <Icon name="grip4" size={16} />
        </button>
      {/if}
      <button
        class="table-gutter-add table-add-row"
        class:hidden={tableAddDragAxis === "row"}
        style={`top:${tableGutter.tableBottom / zoomScale}px; left:${tableRowStripRect(tableGutter).left / zoomScale}px; width:${tableRowStripRect(tableGutter).width / zoomScale}px`}
        title={t("table.addRow")}
        aria-label={t("table.addRow")}
        onmousedown={preventBlur}
        onpointerdown={onAddRowPointerDown}
      >
        <Icon name="plus" size={13} />
      </button>
      {#if hoveredColIndex !== null}
        {@const colIndex = hoveredColIndex}
        {@const col = tableGutter.cols[colIndex]}
        {@const visible = tableVisibleRect(tableGutter)}
        {@const colLeft = Math.max(col.left, visible.left)}
        {@const colRight = Math.min(col.right, visible.right)}
        <button
          class="table-gutter-btn table-col-grip"
          style={`left:${(colLeft + colRight) / 2 / zoomScale - 15}px; top:${tableColGripTop(tableGutter) / zoomScale}px`}
          title={t("table.colGrip")}
          aria-label={t("table.colGrip")}
          onmousedown={preventBlur}
          onpointerdown={(e) => onColGripPointerDown(e, colIndex)}
          onclick={(e) => e.stopPropagation()}
        >
          <Icon name="grip4" size={16} />
        </button>
      {/if}
      <button
        class="table-gutter-add table-add-col"
        class:hidden={tableAddDragAxis === "col"}
        style={`left:${tableVisibleRect(tableGutter).right / zoomScale}px; top:${tableGutter.tableTop / zoomScale}px; height:${(tableGutter.tableBottom - tableGutter.tableTop) / zoomScale}px`}
        title={t("table.addCol")}
        aria-label={t("table.addCol")}
        onmousedown={preventBlur}
        onpointerdown={onAddColPointerDown}
      >
        <Icon name="plus" size={13} />
      </button>
      {#if tableRowAdjust}
        {@const rowPreview = rowPreviewHeights(tableGutter, tableRowAdjust)}
        {@const rowPreviewHeight = sumSizes(rowPreview)}
        {@const visibleTable = tableVisibleRect(tableGutter)}
        {#if tableRowAdjust.removing}
          <div
            class="table-resize-remove table-preview-grid"
            style={`top:${(tableGutter.tableBottom - rowPreviewHeight) / zoomScale}px; left:${visibleTable.left / zoomScale}px; width:${visibleTable.width / zoomScale}px; height:${rowPreviewHeight / zoomScale}px`}
          >
            {#each visibleColumnOffsets(tableGutter, visibleTable) as x}
              <span class="table-preview-vline" style={`left:${x / zoomScale}px`}></span>
            {/each}
            {#each internalOffsets(rowPreview) as y}
              <span class="table-preview-hline" style={`top:${y / zoomScale}px`}></span>
            {/each}
          </div>
        {:else}
          <div
            class="table-resize-ghost table-preview-grid"
            style={`top:${tableGutter.tableBottom / zoomScale}px; left:${visibleTable.left / zoomScale}px; width:${visibleTable.width / zoomScale}px; height:${rowPreviewHeight / zoomScale}px`}
          >
            {#each visibleColumnOffsets(tableGutter, visibleTable) as x}
              <span class="table-preview-vline" style={`left:${x / zoomScale}px`}></span>
            {/each}
            {#each internalOffsets(rowPreview) as y}
              <span class="table-preview-hline" style={`top:${y / zoomScale}px`}></span>
            {/each}
          </div>
        {/if}
      {/if}
      {#if tableColAdjust}
        {@const colPreview = colPreviewWidths(tableGutter, tableColAdjust)}
        {@const colPreviewWidth = sumSizes(colPreview)}
        {@const visibleTable = tableVisibleRect(tableGutter)}
        {#if tableColAdjust.removing}
          {@const removalRect = colRemovalPreviewRect(tableGutter, tableColAdjust.count)}
          <div
            class="table-resize-remove table-preview-grid"
            style={`left:${removalRect.left / zoomScale}px; top:${tableGutter.tableTop / zoomScale}px; height:${(tableGutter.tableBottom - tableGutter.tableTop) / zoomScale}px; width:${removalRect.width / zoomScale}px`}
          >
            {#each removalRect.offsets as x}
              <span class="table-preview-vline" style={`left:${x / zoomScale}px`}></span>
            {/each}
            {#each internalOffsets(tableGutter.rowHeights) as y}
              <span class="table-preview-hline" style={`top:${y / zoomScale}px`}></span>
            {/each}
          </div>
        {:else}
          <div
            class="table-resize-ghost table-preview-grid"
            style={`left:${visibleTable.right / zoomScale}px; top:${tableGutter.tableTop / zoomScale}px; height:${(tableGutter.tableBottom - tableGutter.tableTop) / zoomScale}px; width:${colPreviewWidth / zoomScale}px`}
          >
            {#each internalOffsets(colPreview) as x}
              <span class="table-preview-vline" style={`left:${x / zoomScale}px`}></span>
            {/each}
            {#each internalOffsets(tableGutter.rowHeights) as y}
              <span class="table-preview-hline" style={`top:${y / zoomScale}px`}></span>
            {/each}
          </div>
        {/if}
      {/if}
      {#if tableDimensionLabel}
        <div
          class="table-dimension-label"
          style={`left:${tableDimensionLabel.left / zoomScale}px; top:${tableDimensionLabel.top / zoomScale}px`}
        >
          {tableDimensionLabel.text}
        </div>
      {/if}
    {/if}
    {#if tableDropRowY !== null && tableGutter}
      {@const rowStrip = tableVisibleRect(tableGutter)}
      <div
        class="table-drop-indicator table-drop-row"
        style={`top:${tableDropRowY / zoomScale}px; left:${rowStrip.left / zoomScale}px; width:${rowStrip.width / zoomScale}px`}
      ></div>
    {/if}
    {#if tableDropColX !== null && tableGutter}
      <div
        class="table-drop-indicator table-drop-col"
        style={`left:${tableDropColX / zoomScale}px; top:${tableGutter.tableTop / zoomScale}px; height:${(tableGutter.tableBottom - tableGutter.tableTop) / zoomScale}px`}
      ></div>
    {/if}
    {#if tableHeaderMenu}
      <div
        class="context-menu table-header-menu"
        style={`left:${tableHeaderMenu.x}px; top:${tableHeaderMenu.y}px`}
        onclick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <button onmousedown={preventBlur} onclick={(e) => copyBlockAt(tableHeaderMenu!.tablePos, e)}>
          <span class="menu-symbol">⧉</span>
          <span>{t("block.copy")}</span>
        </button>
        <button class="switch-row" onmousedown={preventBlur} onclick={toggleTableHeaderRow}>
          <span>{t("table.showHeaderRow")}</span>
          <span class="switch" class:on={tableHeaderMenu.showHeaderRow} aria-hidden="true">
            <span class="switch-knob"></span>
          </span>
        </button>
        <button class="switch-row" onmousedown={preventBlur} onclick={toggleTableHeaderColumn}>
          <span>{t("table.showHeaderColumn")}</span>
          <span class="switch" class:on={tableHeaderMenu.showHeaderColumn} aria-hidden="true">
            <span class="switch-knob"></span>
          </span>
        </button>
        <button class="switch-row" onmousedown={preventBlur} onclick={toggleTableIndexColumn}>
          <span>{t("table.showIndexColumn")}</span>
          <span class="switch" class:on={tableHeaderMenu.showIndexColumn} aria-hidden="true">
            <span class="switch-knob"></span>
          </span>
        </button>
        <div class="menu-sep"></div>
        <button onmousedown={preventBlur} onclick={distributeColumnsEvenlyAction}>
          <Icon name="columns" size={14} />
          <span>{t("table.distributeColumnsEvenly")}</span>
        </button>
        <button onmousedown={preventBlur} onclick={fitColumnsToContentAction}>
          <Icon name="columns" size={14} />
          <span>{t("table.fitColumnsToContent")}</span>
        </button>
        <button onmousedown={preventBlur} onclick={addTableCheckboxColumn}>
          <Icon name="check-square" size={14} />
          <span>{t("table.addCheckboxColumn")}</span>
        </button>
        <button onmousedown={preventBlur} onclick={fitTableToWidthAction}>
          <Icon name="columns" size={14} />
          <span>{t("table.fitTableToWidth")}</span>
        </button>
        <div class="menu-sep"></div>
        <button class="menu-danger" onmousedown={preventBlur} onclick={deleteTableFromMenu}>
          <Icon name="trash" size={14} />
          <span>{t("table.deleteTable")}</span>
        </button>
      </div>
    {/if}
    {#if tableRowMenu}
      <div
        class="context-menu table-action-menu"
        style={`left:${tableRowMenu.x}px; top:${tableRowMenu.y}px`}
        onclick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <button onmousedown={preventBlur} onclick={insertRowAboveAction}>
          <Icon name="row-insert-above" size={14} />
          <span>{t("table.insertRowAbove")}</span>
        </button>
        <button onmousedown={preventBlur} onclick={insertRowBelowAction}>
          <Icon name="row-insert-below" size={14} />
          <span>{t("table.insertRowBelow")}</span>
        </button>
        <button
          class="menu-danger"
          disabled={tableRowMenu.rowCount <= 1}
          onmousedown={preventBlur}
          onclick={deleteRowAction}
        >
          <Icon name="trash" size={14} />
          <span>{t("table.deleteRow")}</span>
        </button>
      </div>
    {/if}
    {#if tableColMenu}
      <div
        class="context-menu table-action-menu"
        style={`left:${tableColMenu.x}px; top:${tableColMenu.y}px`}
        onclick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <button onmousedown={preventBlur} onclick={insertColLeftAction}>
          <Icon name="col-insert-left" size={14} />
          <span>{t("table.insertColLeft")}</span>
        </button>
        <button onmousedown={preventBlur} onclick={insertColRightAction}>
          <Icon name="col-insert-right" size={14} />
          <span>{t("table.insertColRight")}</span>
        </button>
        <button
          class="menu-danger"
          disabled={tableColMenu.colCount <= 1}
          onmousedown={preventBlur}
          onclick={deleteColAction}
        >
          <Icon name="trash" size={14} />
          <span>{t("table.deleteCol")}</span>
        </button>
      </div>
    {/if}
    {#if slashMenuState.open}
      <div
        class="block-menu slash-menu"
        style={`top:${slashPos.top / zoomScale}px; left:${slashPos.left / zoomScale}px`}
      >
        {#if slashItems.length === 0}
          <div class="slash-empty">{t("block.slashEmpty")}</div>
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
    <div
      class="editor-content-col"
      bind:this={element}
      oncontextmenu={(e) => !onEditorImageContextMenu(e) && onEditorContextMenu(e)}
      role="presentation"
    ></div>
  </div>
</div>
{#if grammarMenu}
  <div class="context-menu grammar-menu" style={`left:${grammarMenu.x}px; top:${grammarMenu.y}px`}>
    {#if grammarMenu.suggestions.length > 0}
      {#each grammarMenu.suggestions as suggestion (suggestion)}
        <button onclick={() => applyGrammarSuggestion(suggestion)}>{suggestion}</button>
      {/each}
      <div class="menu-sep"></div>
    {:else}
      <div class="grammar-menu-empty">{t("editor.noSuggestions")}</div>
      <div class="menu-sep"></div>
    {/if}
    <button onclick={addGrammarWordToDictionary}>{t("editor.addToDictionary")}</button>
  </div>
{/if}
{#if blockDragGhost}
  <div class="block-drag-ghost" style={`left:${blockDragGhost.x}px; top:${blockDragGhost.y}px`}>
    {blockDragGhost.text}
  </div>
{/if}
{#if tableDragLabel}
  <div class="block-drag-ghost" style={`left:${tableDragLabel.x}px; top:${tableDragLabel.y}px`}>
    {tableDragLabel.text}
  </div>
{/if}
{#if imageResizeActive}
  <div
    class="image-resize-capture"
    role="presentation"
    onpointermove={onImageResizeOverlayMove}
    onpointerup={onImageResizeOverlayUp}
    onmousemove={onImageResizeOverlayMove}
    onmouseup={onImageResizeOverlayUp}
    ondragstart={(e) => e.preventDefault()}
    onclick={(e) => {
      e.preventDefault();
      e.stopPropagation();
    }}
  ></div>
{/if}

<style>
  :global(html.table-col-resizing),
  :global(html.table-col-resizing *) {
    cursor: col-resize !important;
  }
  :global(html.table-row-resizing),
  :global(html.table-row-resizing *) {
    cursor: ns-resize !important;
  }
  :global(html.table-col-adding),
  :global(html.table-col-adding *) {
    cursor: ew-resize !important;
  }
  :global(html.table-grip-dragging),
  :global(html.table-grip-dragging *) {
    cursor: grabbing !important;
  }
  .image-resize-capture {
    position: fixed;
    inset: 0;
    z-index: 1000;
    cursor: ew-resize;
    background: transparent;
    user-select: none;
    -webkit-user-select: none;
  }

  .editor-scroll {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--content-bg);
    /* Query container for the wide-table breakout below — lets a table's
       width be computed relative to this pane's actual rendered width
       (correctly excluding the sidebar/outline beside it) via cqw units,
       instead of the viewport (100vw would run under those panels) or the
       narrower 1000px reading column a table would otherwise inherit. */
    container-type: inline-size;
  }

  .editor-content-col-wrapper {
    position: relative;
    max-width: 1000px;
    margin: 0 auto;
    padding: 56px 64px 30vh;
    min-height: 100%;
    --editor-content-width: max(240px, calc(min(100cqw, 1000px) - 128px));
  }

  .handle-group {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 1px;
    z-index: 90;
    user-select: none;
    -webkit-user-select: none;
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
    user-select: none;
    -webkit-user-select: none;
  }
  .handle-group :global(svg),
  .handle-group :global(svg *) {
    user-select: none;
    -webkit-user-select: none;
    pointer-events: none;
  }
  /* Bumped up from 28x28 when the hovered row is tall enough to fit it
     without visibly overflowing (see handleBtnSize) — e.g. a heading line. */
  .block-handle.handle-lg,
  .drag-handle.handle-lg {
    width: 30px;
    height: 30px;
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
  .menu-symbol {
    width: 14px;
    flex-shrink: 0;
    color: var(--text-secondary);
    text-align: center;
    font-size: 16px;
    line-height: 1;
  }
  .selection-toolbar {
    position: absolute;
    z-index: 60;
    transform: translate(-50%, calc(-100% - 8px));
    display: flex;
    background: var(--content-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    padding: 3px;
  }
  .selection-toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .selection-toolbar-btn:hover {
    background: var(--hover-bg-strong);
    color: var(--text-primary);
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
    display: flex;
    align-items: center;
    /* Matches the text's own 1.6 line-height so the checkbox centers against
       exactly the same vertical span as the first line next to it — more
       reliable than eyeballing a margin-top offset, since the browser's
       default UA stylesheet also gives <input type="checkbox"> its own
       intrinsic margin that was stacking with ours and pushing it further
       out of alignment. */
    height: 1.6em;
    margin: 0;
    user-select: none;
  }
  /* appearance:none + a hand-drawn box/checkmark, rather than sizing the
     native control via width/height/margin/accent-color: the native
     checkbox's *own* rendering still carries browser-controlled internal
     metrics that width/height/margin resets don't fully override, which is
     why it kept sitting a few px off from centered no matter how the
     surrounding label/margins were tuned. A fully custom-drawn box has no
     such hidden metrics — its rendered size is exactly what's declared. */
  .editor-content-col :global(.tiptap ul[data-type="taskList"] li > label input[type="checkbox"]) {
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    border: 1.5px solid var(--border);
    border-radius: 4px;
    background-color: var(--content-bg);
    background-repeat: no-repeat;
    background-position: center;
    background-size: 10px 10px;
    cursor: pointer;
  }
  .editor-content-col :global(.tiptap ul[data-type="taskList"] li > label input[type="checkbox"]:checked) {
    background-color: var(--accent);
    border-color: var(--accent);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='3 8 6.5 11.5 13 4.5'/%3E%3C/svg%3E");
  }
  .editor-content-col :global(.tiptap ul[data-type="taskList"] li > div) {
    flex: 1;
  }
  /* The content div's own <p> still carries the global "p { margin: 0.4em
     0 }" rule, which — unlike in normal block flow — doesn't collapse away
     against the flex-item div wrapping it, so it was pushing the text down
     below the checkbox's centered position instead of the two lining up. */
  .editor-content-col :global(.tiptap ul[data-type="taskList"] li > div p) {
    margin: 0;
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
    font-family: "Cascadia Code", "Consolas", "Microsoft YaHei UI", "PingFang SC", ui-monospace, monospace;
    font-size: 0.9em;
  }
  .editor-content-col :global(.tiptap .code-block-shell) {
    position: relative;
    margin: 0.6em 0;
  }
  .editor-content-col :global(.tiptap .code-block-shell pre) {
    margin: 0;
    padding-bottom: 40px;
  }
  .editor-content-col :global(.tiptap .code-language-select) {
    position: absolute;
    right: 8px;
    bottom: 8px;
    z-index: 1;
    max-width: 130px;
    height: 26px;
    padding: 0 24px 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--code-bg);
    color: var(--text-secondary);
    font: 12px/1 system-ui, sans-serif;
    cursor: pointer;
  }
  .editor-content-col :global(.tiptap .hljs-keyword),
  .editor-content-col :global(.tiptap .hljs-selector-tag),
  .editor-content-col :global(.tiptap .hljs-literal) { color: #9c36b5; }
  .editor-content-col :global(.tiptap .hljs-string),
  .editor-content-col :global(.tiptap .hljs-title),
  .editor-content-col :global(.tiptap .hljs-section) { color: #087f5b; }
  .editor-content-col :global(.tiptap .hljs-number),
  .editor-content-col :global(.tiptap .hljs-type),
  .editor-content-col :global(.tiptap .hljs-built_in) { color: #1864ab; }
  .editor-content-col :global(.tiptap .hljs-comment),
  .editor-content-col :global(.tiptap .hljs-quote) { color: #868e96; font-style: italic; }
  .editor-content-col :global(.tiptap .hljs-meta),
  .editor-content-col :global(.tiptap .hljs-operator),
  .editor-content-col :global(.tiptap .hljs-punctuation) { color: #e67700; }
  .editor-content-col :global(.tiptap code) {
    color: inherit;
    background: #FFF3C4;
    border: none;
    border-radius: 6px;
    box-shadow: none;
    padding: 3px 6px;
    font: inherit;
    font-size: inherit;
  }
  .editor-content-col :global(.tiptap pre code) {
    color: inherit;
    background: none;
    padding: 0;
  }
  .editor-content-col :global(.tiptap span[data-type="mention"]) {
    color: #1677FF;
    background: rgba(22, 119, 255, 0.09);
    border: none;
    border-radius: 6px;
    box-shadow: none;
    margin: 0;
    padding: 1px 4px;
    font: inherit;
  }
  /* A bare 1px border-top with margin around it means the element's own
     rendered box (what posAtCoords/getBoundingClientRect see) is just that
     1px sliver — hovering anywhere in its margin resolves to whichever
     paragraph is nearest instead, so the block handle never lands on a
     divider. Folding that margin into padding (with the line drawn via a
     background clipped to the content box, so it stays a visually centered
     1px rule) keeps the same total footprint but makes the *whole* gap part
     of the hr's own hoverable box. */
  .editor-content-col :global(.tiptap hr) {
    border: none;
    height: 1px;
    margin: 0;
    padding: 1.5em 0;
    background: var(--border);
    background-clip: content-box;
    box-sizing: content-box;
  }
  /* prosemirror-tables' own TableView NodeView wraps every <table> in this
     div (regardless of the extension's `renderWrapper` option, which is a
     separate mechanism) — giving it the horizontal scrollbar here, rather
     than the table itself, keeps row/column borders looking continuous
     while only the cell content area scrolls. */
  .editor-content-col :global(.tiptap .tableWrapper) {
    width: 100%;
    max-width: 100%;
    margin: 0.6em 0;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    padding-bottom: 18px;
    scrollbar-width: auto;
    scrollbar-color: rgba(55, 53, 47, 0.28) transparent;
  }
  .editor-content-col :global(.tiptap .tableWrapper.wide-table-wrapper) {
    width: 100cqw;
    max-width: 100cqw;
    margin-left: calc(50% - 50cqw);
    margin-right: calc(50% - 50cqw);
    padding-left: calc(50cqw - 50%);
    padding-right: 36px;
    box-sizing: border-box;
  }
  .editor-content-col :global(.tiptap table) {
    border-collapse: collapse;
    width: max-content;
    min-width: min(100%, var(--editor-content-width));
  }
  .editor-content-col :global(.tiptap .tableWrapper::-webkit-scrollbar) {
    height: 14px;
  }
  .editor-content-col :global(.tiptap .tableWrapper::-webkit-scrollbar-track) {
    background: transparent;
  }
  .editor-content-col :global(.tiptap .tableWrapper::-webkit-scrollbar-thumb) {
    min-width: 48px;
    border: 4px solid transparent;
    border-radius: 999px;
    background: rgba(55, 53, 47, 0.28);
    background-clip: content-box;
  }
  .editor-content-col :global(.tiptap .tableWrapper::-webkit-scrollbar-thumb:hover) {
    background: rgba(55, 53, 47, 0.38);
    background-clip: content-box;
  }
  .editor-content-col :global(.tiptap .tableWrapper::-webkit-scrollbar-button:horizontal:end:single-button) {
    width: 14px;
    background:
      linear-gradient(45deg, transparent 50%, rgba(55, 53, 47, 0.28) 50%) 4px 4px / 6px 6px no-repeat,
      linear-gradient(135deg, rgba(55, 53, 47, 0.28) 50%, transparent 50%) 4px 4px / 6px 6px no-repeat;
  }
  .editor-content-col :global(.tiptap .tableWrapper::-webkit-scrollbar-button:horizontal:start:single-button) {
    width: 0;
  }
  /* Past 4 columns, cells start getting squeezed illegibly narrow inside
     the normal 1000px reading column — instead, break the table's own
     wrapper (TableView always renders one, see editor/nodes/table.ts) out
     to use the editing pane's full width (see .editor-scroll's
     container-type above), scrolling horizontally *inside the table*
     rather than squeezing columns or scrolling the whole page. Tables with
     4 or fewer columns are untouched, still centered at 1000px like
     everything else. `left: 50cqw` + a matching negative margin (not
     percentages, which would resolve against this element's own — much
     narrower — containing block) is what lets this be positioned relative
     to .editor-scroll's width specifically. */
  .editor-content-col :global(.tiptap th),
  .editor-content-col :global(.tiptap td) {
    position: relative;
    cursor: default;
    border: 1px solid var(--border);
    /* Keep editable content physically outside the fixed 8px cell-action
       strips used by table.ts, including above and below a single line. */
    padding: 10px;
    min-width: 50px;
    vertical-align: middle;
  }
  /* Document-level paragraph/list margins must not contribute to a table
     row's intrinsic height. In particular, a one-item taskList otherwise
     stacks the ul and li margins and makes its row taller than a plain-text
     row. Keeping cell blocks marginless also leaves the visible padding as
     one consistent edge-selection strip on all four sides. */
  .editor-content-col :global(.tiptap td > p),
  .editor-content-col :global(.tiptap th > p),
  .editor-content-col :global(.tiptap td > ul),
  .editor-content-col :global(.tiptap th > ul),
  .editor-content-col :global(.tiptap td > ol),
  .editor-content-col :global(.tiptap th > ol),
  .editor-content-col :global(.tiptap td > ul > li),
  .editor-content-col :global(.tiptap th > ul > li),
  .editor-content-col :global(.tiptap td > ol > li),
  .editor-content-col :global(.tiptap th > ol > li) {
    margin-top: 0;
    margin-bottom: 0;
  }
  .editor-content-col :global(.tiptap td p),
  .editor-content-col :global(.tiptap th p),
  .editor-content-col :global(.tiptap td a),
  .editor-content-col :global(.tiptap th a),
  .editor-content-col :global(.tiptap td summary),
  .editor-content-col :global(.tiptap th summary) {
    cursor: text;
  }
  /* A text caret inside a cell is ordinary editing, not a one-cell
     selection. Do not draw the old full-cell blue editing outline here;
     CellSelection has the dedicated outer outline below. */
  .editor-content-col :global(.tiptap .selectedCell::after) {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 2;
    background: rgba(35, 131, 226, 0.12);
    pointer-events: none;
  }
  .table-cell-selection-outline {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid #2383e2;
    pointer-events: none;
    z-index: 38;
  }
  .table-cell-selection-toolbar {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    transform: translate(-50%, calc(-100% - 8px));
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--content-bg);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
    white-space: nowrap;
    z-index: 70;
  }
  .table-cell-selection-toolbar button {
    border: 0;
    border-radius: 4px;
    padding: 6px 9px;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    width: 100%;
    text-align: left;
  }
  .table-cell-selection-toolbar button:hover { background: var(--hover-bg); }
  .table-cell-selection-toolbar button.menu-danger { color: #e03e3e; }
  .table-cell-selection-toolbar button.menu-danger:hover { background: rgba(224, 62, 62, 0.1); }
  .editor-content-col :global(.tiptap th) {
    text-align: left;
    /* The browser's UA stylesheet bolds <th> by default. Every table's
       first row is always a real <th> regardless of the showHeaderRow
       toggle (see the comment below), so without this reset every fresh
       table's first row reads as bold — indistinguishable from an actual
       `bold` mark, except Ctrl+B/the selection toolbar's bold button can't
       touch it, since there's no mark there to toggle. Actual header-row
       styling stays opt-in via the [data-show-header-row] rule below. */
    font-weight: normal;
  }
  /* The first row is always a real <th> (tiptap-markdown's GFM table
     serializer requires it), but whether it actually *looks* like a header
     is the table's own showHeaderRow toggle (table-header-menu, click the
     drag handle) — off by default, so a fresh table reads as plain cells
     until turned on. Same story for the first column via showHeaderColumn,
     except that one is CSS-only (its cells stay ordinary tableCell nodes). */
  .editor-content-col :global(.tiptap table[data-show-header-row] tr:first-child > th) {
    background: var(--sidebar-bg);
    font-weight: 600;
  }
  /* Row 0's first cell is always a <th> regardless of row 0's own
     showHeaderRow styling — showHeaderColumn needs to cover it too (the
     whole column bolds/backgrounds together, header row included), not
     just the <td>s in every row below it. */
  .editor-content-col :global(.tiptap table[data-show-header-column] td:first-child),
  .editor-content-col :global(.tiptap table[data-show-header-column] th:first-child) {
    background: var(--sidebar-bg);
    font-weight: 600;
  }
  /* With an index column (see tableOps.ts's setShowIndexColumn), physical
     column 0 is the index column, not the real first content column — the
     rule above already covers it (it's still :first-child), this adds the
     pairing the feature asks for: the *real* first content column (now
     :nth-child(2), including row 0's own <th> there) switches its header-
     column look together with it, instead of only the index column
     changing. */
  .editor-content-col :global(.tiptap table[data-show-header-column][data-show-index-column] td:nth-child(2)),
  .editor-content-col :global(.tiptap table[data-show-header-column][data-show-index-column] th:nth-child(2)) {
    background: var(--sidebar-bg);
    font-weight: 600;
  }
  /* Index column always reads as an auxiliary, non-content column —
     narrow, centered, muted — regardless of the header-column toggle above
     (which only adds background/bold on top of this). */
  .editor-content-col :global(.tiptap table[data-show-index-column] > tbody > tr > :first-child) {
    width: 40px !important;
    min-width: 40px;
    max-width: 40px;
    text-align: center;
    color: var(--text-secondary);
    user-select: none;
    -webkit-user-select: none;
  }
  .editor-content-col :global(.tiptap table p) {
    margin: 0;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image) {
    position: relative;
    margin: 0.8em 0;
    max-width: 100%;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image[data-centered="true"]) {
    text-align: center;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image .mdnote-image-frame) {
    position: relative;
    display: inline-block;
    max-width: 100%;
    vertical-align: top;
    -webkit-user-drag: none;
    user-select: none;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image .mdnote-image-frame::after) {
    content: "";
    position: absolute;
    inset: -4px;
    border: 1px dashed rgba(55, 53, 47, 0.32);
    border-radius: 6px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image:hover .mdnote-image-frame::after) {
    opacity: 1;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image[data-resizing="true"] .mdnote-image-frame::after) {
    opacity: 1;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image img) {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    -webkit-user-drag: none;
    user-select: none;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image[data-width-percent] img) {
    width: 100%;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image[data-width-percent] .mdnote-image-frame) {
    max-width: none;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image .image-resize-handle) {
    position: absolute;
    top: 50%;
    width: 7px;
    height: 32px;
    transform: translateY(-50%);
    border-radius: 999px;
    background: rgba(55, 53, 47, 0.42);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease;
    z-index: 2;
    cursor: ew-resize;
    touch-action: none;
    -webkit-user-drag: none;
    user-select: none;
  }
  :global(html.image-resizing),
  :global(html.image-resizing *) {
    cursor: ew-resize !important;
    user-select: none !important;
    -webkit-user-select: none !important;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image:hover .image-resize-handle) {
    opacity: 1;
    pointer-events: auto;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image[data-resizing="true"] .image-resize-handle) {
    opacity: 1;
    pointer-events: auto;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image .image-resize-left) {
    left: 10px;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image .image-resize-right) {
    right: 10px;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image figcaption[data-role="missing"]) {
    display: none;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image[data-invalid="true"] img) {
    display: none;
  }
  .editor-content-col :global(.tiptap figure.mdnote-image[data-invalid="true"] figcaption[data-role="missing"]) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 180px;
    min-height: 96px;
    padding: 14px 18px;
    box-sizing: border-box;
    border-radius: 4px;
    background: #e6e6e6;
    color: var(--text-secondary);
    font-size: 13px;
  }
  .editor-content-col :global(.tiptap details.toggle-list) {
    margin: 0.4em 0;
  }
  .editor-content-col :global(.tiptap details.toggle-list > summary) {
    display: flex;
    align-items: center;
    gap: 2px;
    cursor: pointer;
    font-weight: 500;
    list-style: none;
  }
  /* The native disclosure marker only renders because Chromium's UA
     stylesheet gives <summary> `display: list-item` — switching it to flex
     above (for the icon+title layout) already drops it, since ::marker only
     applies to list-item boxes. This is the explicit belt-and-suspenders
     version for engines that still render it another way: a custom
     .toggle-icon triangle below can carry a hover box, which a ::marker
     pseudo-element's very limited box model can't. */
  .editor-content-col :global(.tiptap details.toggle-list > summary::-webkit-details-marker) {
    display: none;
  }
  .editor-content-col :global(.tiptap .toggle-icon) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    flex-shrink: 0;
    color: var(--text-secondary);
  }
  .editor-content-col :global(.tiptap .toggle-icon:hover) {
    background: var(--hover-bg-strong);
    color: var(--text-primary);
  }
  .editor-content-col :global(.tiptap .toggle-icon::before) {
    content: "";
    width: 0;
    height: 0;
    border-style: solid;
    border-width: 5px 0 5px 8.7px;
    border-color: transparent transparent transparent currentColor;
    transition: transform 0.12s ease;
  }
  .editor-content-col :global(.tiptap details.toggle-list[open] > summary .toggle-icon::before) {
    transform: rotate(90deg);
  }
  .editor-content-col :global(.tiptap details.toggle-list[open] > summary) {
    margin-bottom: 0.2em;
  }
  .editor-content-col :global(.tiptap details.toggle-list > :not(summary)) {
    padding-left: 24px;
  }
  /* Was `display:flex` with the icon as one item and the callout's actual
     content (its real DOM children) implicitly expected to be "the other
     item" — fine for a single paragraph, but content:"block+" allows more
     than one, and every one of them became its own flex item in that same
     row instead of a second one stacking below the first. Pressing Enter
     inside a callout very much did start a new paragraph (verified
     directly against the ProseMirror command chain), it just rendered
     immediately to the right of the first one with the 10px flex `gap` in
     between — reading as "stayed on the same line, just a small gap"
     exactly as reported. Position-based icon placement sidesteps this
     entirely: the real children go back to normal block flow (stacking
     vertically the way any block+ content does), the icon is pulled out of
     that flow altogether via absolute positioning instead of being another
     sibling competing for a row layout meant for exactly one text column. */
  .editor-content-col :global(.tiptap div[data-type="callout"]) {
    position: relative;
    background: var(--hover-bg);
    border-radius: 6px;
    padding: 12px 14px 12px 40px;
    margin: 0.6em 0;
  }
  .editor-content-col :global(.tiptap div[data-type="callout"]::before) {
    content: "\1F4A1";
    position: absolute;
    left: 14px;
    top: 12px;
  }
  .editor-content-col :global(.tiptap div[data-type="callout"] p) {
    margin: 0;
  }
  .editor-content-col :global(.tiptap div[data-type="callout"] p + p) {
    margin-top: 0.3em;
  }
  .editor-content-col :global(.tiptap div[data-type="callout"] > ol:first-child),
  .editor-content-col :global(.tiptap div[data-type="callout"] > ul:first-child) {
    margin-top: 0;
  }
  .editor-content-col :global(.tiptap div[data-type="columns"]) {
    display: grid;
    gap: 24px;
    margin: 0.6em 0;
  }
  .editor-content-col :global(.tiptap div[data-type="columns"][data-count="2"]) {
    grid-template-columns: repeat(2, 1fr);
  }
  .editor-content-col :global(.tiptap div[data-type="columns"][data-count="3"]) {
    grid-template-columns: repeat(3, 1fr);
  }
  .editor-content-col :global(.tiptap div[data-type="columns"][data-count="4"]) {
    grid-template-columns: repeat(4, 1fr);
  }
  .editor-content-col :global(.tiptap div[data-type="columns"][data-count="5"]) {
    grid-template-columns: repeat(5, 1fr);
  }
  .editor-content-col :global(.tiptap div[data-type="column"]) {
    min-width: 0;
    border-left: 1px dashed var(--border);
    padding-left: 12px;
  }
  .editor-content-col :global(.tiptap div[data-type="column"]:first-child) {
    border-left: none;
    padding-left: 0;
  }
  .editor-content-col :global(.tiptap div[data-type="column"] > :first-child) {
    margin-top: 0;
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
  /* Set only after a click actually fails to find the target (see
     linkKey/invalidLinksKey in links.ts) — never assumed just because a
     path looks suspicious, and cleared again the moment a click succeeds. */
  .editor-content-col :global(.tiptap a.link-chip-invalid) {
    background: rgba(224, 62, 62, 0.12);
    border-color: rgba(224, 62, 62, 0.35);
  }
  .editor-content-col :global(.tiptap a.link-chip-invalid:hover) {
    background: rgba(224, 62, 62, 0.2);
  }
  /* Swaps the rendered glyph for a warning triangle without touching the
     node's actual content/attrs (which stay whatever was saved to disk) —
     the original glyph is hidden in place and a ::after overlay drawn over
     the same box shows the warning instead. */
  .editor-content-col :global(.tiptap a.link-chip-invalid .link-chip-icon) {
    position: relative;
    visibility: hidden;
  }
  .editor-content-col :global(.tiptap a.link-chip-invalid .link-chip-icon::after) {
    content: "\26A0\FE0F";
    position: absolute;
    inset: 0;
    visibility: visible;
    display: flex;
    align-items: center;
    justify-content: center;
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
  /* The Highlight extension's own renderHTML sets an inline
     background-color (and color: inherit) whenever a mark has a `color`
     attribute — this is only the fallback for a bare `<mark>` with none,
     e.g. one created via the extension's built-in `==text==` input rule. */
  .editor-content-col :global(.tiptap mark) {
    border-radius: 2px;
    padding: 0 1px;
    background: #ffeb3b;
    color: inherit;
  }
  .editor-content-col :global(.tiptap [data-underline-color]) {
    text-decoration-color: var(--mdnote-underline-color);
  }
  .editor-content-col :global(.tiptap [data-underline-color] u),
  .editor-content-col :global(.tiptap [data-underline-color] [data-wavy]) {
    text-decoration-color: var(--mdnote-underline-color) !important;
  }
  .editor-content-col :global(.tiptap [data-dot-underline]) {
    text-emphasis: none !important;
    -webkit-text-emphasis: none !important;
    background-image: radial-gradient(circle, var(--mdnote-underline-color, currentColor) 1.15px, transparent 1.3px);
    background-repeat: repeat-x;
    background-size: 7px 4px;
    background-position: left calc(100% - 0.02em);
    padding-bottom: 0.18em;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  .editor-content-col :global(.tiptap [data-underline-color] [data-dot-underline]) {
    background-image: radial-gradient(circle, var(--mdnote-underline-color) 1.15px, transparent 1.3px);
  }
  .editor-content-col :global(.tiptap .grammar-error) {
    text-decoration: underline wavy #e03e3e;
    text-decoration-thickness: 1.5px;
    text-underline-offset: 3px;
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
  /* Table row/column gutters: one small grip per row (left of the table) /
     column (above the table) — drag it to reorder; the row grip also opens
     a right-click menu (header row/column display toggles). Plus a trailing
     "+" strip to append a row/column at the end. */
  /* Same footprint as .block-handle/.drag-handle (the left-side hover
     button) — 28px, radius 5px — so the two kinds of grip read as the same
     control instead of a visibly different size/shape. Unlike that button
     though, this one is only ever rendered for the single row/column
     currently under the cursor (see hoveredRowIndex/hoveredColIndex), so its
     background shows immediately rather than waiting for a further :hover
     on the small 28px target itself. */
  .table-gutter-btn {
    position: absolute;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 5px;
    background: var(--hover-bg);
    color: var(--text-primary);
    cursor: grab;
    z-index: 40;
  }
  .table-gutter-btn:active {
    cursor: grabbing;
  }
  .table-gutter-btn:hover {
    background: var(--hover-bg-strong);
    color: var(--text-primary);
  }
  /* Rendered only while tableGutter is set (i.e. the table is already being
     hovered — see the template), so this doesn't need its own opacity gate
     on top of that: it should be visible the instant it exists, not require
     the pointer to already be on this exact 14px strip to discover it (that
     was unreachable — nothing hinted the strip was there to hover). */
  .table-gutter-add {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: var(--sidebar-bg);
    color: var(--text-secondary);
    cursor: pointer;
    z-index: 40;
  }
  .table-gutter-add :global(svg) {
    display: block;
    flex-shrink: 0;
    opacity: 1;
  }
  .table-gutter-add:hover {
    background: var(--hover-bg-strong);
    color: var(--text-primary);
  }
  .table-gutter-add.hidden {
    visibility: hidden;
  }
  .table-add-row {
    height: 18px;
    border-radius: 0 0 4px 4px;
  }
  .table-add-col {
    width: 18px;
    border-radius: 0 4px 4px 0;
  }
  .table-col-resize-hit {
    position: absolute;
    width: 10px;
    margin-left: -5px;
    cursor: col-resize;
    z-index: 45;
  }
  .table-col-resize-indicator {
    position: absolute;
    width: 3px;
    margin-left: -1.5px;
    border-radius: 2px;
    background: var(--accent);
    pointer-events: none;
    z-index: 46;
  }
  .table-drop-indicator {
    position: absolute;
    background: var(--accent);
    border-radius: 2px;
    pointer-events: none;
    z-index: 41;
  }
  .table-drop-row {
    height: 3px;
    margin-top: -1.5px;
  }
  .table-drop-col {
    width: 3px;
    margin-left: -1.5px;
  }
  /* Live preview while dragging the add-row/add-col strip — see
     tableRowAdjust/tableColAdjust. Neither ever mutates the doc by itself;
     both are purely visual until pointerup. */
  .table-resize-ghost {
    position: absolute;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px dashed var(--accent);
    pointer-events: none;
    z-index: 39;
  }
  .table-preview-grid {
    overflow: hidden;
  }
  .table-preview-vline,
  .table-preview-hline {
    position: absolute;
    pointer-events: none;
    background: rgba(35, 131, 226, 0.36);
  }
  .table-preview-vline {
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .table-preview-hline {
    left: 0;
    right: 0;
    height: 1px;
  }
  .table-resize-remove .table-preview-vline,
  .table-resize-remove .table-preview-hline {
    background: rgba(224, 62, 62, 0.42);
  }
  .table-resize-remove {
    position: absolute;
    background: rgba(224, 62, 62, 0.16);
    border: 1px dashed #e03e3e;
    pointer-events: none;
    z-index: 39;
  }
  .table-dimension-label {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 60;
    pointer-events: none;
    padding: 5px 10px;
    border-radius: 6px;
    background: rgba(45, 45, 45, 0.95);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    white-space: nowrap;
  }
  /* Menu opened by a plain left-click on the whole-table drag handle (see
     openTableHeaderMenu) — same floating-panel look as the sidebar's
     tree-node context menu. */
  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--content-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    padding: 4px;
    display: flex;
    flex-direction: column;
  }
  .image-menu {
    position: absolute;
    transform: translateX(-50%);
    z-index: 70;
    gap: 2px;
  }
  .image-reset-btn {
    width: 100%;
    padding: 7px 8px;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .image-reset-btn:hover {
    background: var(--hover-bg);
  }
  .image-reset-btn.danger {
    color: #e03e3e;
  }
  .image-reset-btn.danger:hover {
    background: rgba(224, 62, 62, 0.1);
  }
  .table-header-menu {
    min-width: 200px;
    padding: 6px;
    gap: 2px;
  }
  .table-header-menu button:not(.switch-row) {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 10px;
    border: none;
    background: none;
    text-align: left;
    padding: 6px 8px;
    font-size: 13px;
    font-family: inherit;
    color: var(--text-primary);
    border-radius: 5px;
    cursor: pointer;
  }
  .table-header-menu button:not(.switch-row):hover {
    background: var(--hover-bg);
  }
  .table-header-menu button:not(.switch-row) :global(svg) {
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .table-header-menu button.menu-danger:hover {
    background: rgba(224, 62, 62, 0.12);
  }
  .table-header-menu button.menu-danger:hover :global(svg) {
    color: #e03e3e;
  }
  /* Row/column insert-above/below (or left/right) + delete popover, opened
     by a plain click on a row/col grip — same look as .block-menu's items. */
  .table-action-menu {
    min-width: 180px;
    padding: 4px;
    gap: 1px;
  }
  .table-action-menu button {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 10px;
    border: none;
    background: none;
    text-align: left;
    padding: 7px 10px;
    font-size: 13px;
    font-family: inherit;
    color: var(--text-primary);
    border-radius: 5px;
    cursor: pointer;
  }
  .table-action-menu button:hover {
    background: var(--hover-bg);
  }
  .table-action-menu button :global(svg) {
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .table-action-menu button.menu-danger:hover {
    background: rgba(224, 62, 62, 0.12);
  }
  .table-action-menu button.menu-danger:hover :global(svg) {
    color: #e03e3e;
  }
  .table-action-menu button:disabled {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
  }
  .grammar-menu {
    min-width: 160px;
    padding: 4px;
    gap: 1px;
  }
  .grammar-menu button {
    display: block;
    width: 100%;
    border: none;
    background: none;
    text-align: left;
    padding: 7px 10px;
    font-size: 13px;
    font-family: inherit;
    color: var(--text-primary);
    border-radius: 5px;
    cursor: pointer;
  }
  .grammar-menu button:hover {
    background: var(--hover-bg);
  }
  .grammar-menu-empty {
    padding: 7px 10px;
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .menu-sep {
    height: 1px;
    background: var(--border);
    margin: 4px 2px;
  }
  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: 5px;
    background: none;
    font-size: 13px;
    font-family: inherit;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }
  .switch-row:hover {
    background: var(--hover-bg);
  }
  .switch {
    position: relative;
    flex-shrink: 0;
    width: 32px;
    height: 18px;
    border-radius: 9px;
    background: var(--border);
    transition: background 0.15s ease;
  }
  .switch.on {
    background: var(--accent);
  }
  .switch-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: left 0.15s ease;
  }
  .switch.on .switch-knob {
    left: 16px;
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
    /* Notion-style block frame: every selected block shares one flush left
       edge while retaining 8px of breathing room around plain text. It
       begins after the handle group, so the add/drag buttons stay outside. */
    left: 56px;
    right: 56px;
    background: rgba(35, 131, 226, 0.13);
    border-radius: 4px;
    pointer-events: none;
  }
  .editor-content-col :global(.tiptap.cell-selection-dragging),
  .editor-content-col :global(.tiptap.cell-selection-dragging *) {
    cursor: default !important;
  }
  .multi-select-marquee {
    position: absolute;
    z-index: 1;
    background: rgba(35, 131, 226, 0.1);
    pointer-events: none;
  }
  .selected-block-highlight {
    right: auto;
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
