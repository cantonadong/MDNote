import { getHTMLFromFragment } from "@tiptap/core";
import { Table as BaseTable } from "@tiptap/extension-table";
import { TableCell as BaseTableCell } from "@tiptap/extension-table-cell";
import { TableHeader as BaseTableHeader } from "@tiptap/extension-table-header";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Fragment } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { t } from "../../i18n.svelte";

export const TableHeader = BaseTableHeader.extend({
  selectable: false,
});

export const TableCell = BaseTableCell.extend({
  selectable: false,
});

// Adds a per-table "show header row" / "show header column" toggle (see the
// table-gutter context menu in Editor.svelte). Both are purely visual attrs
// — the first row stays a real tableHeader node either way, since
// tiptap-markdown's GFM table serializer requires that regardless of this
// toggle to even recognize the table as a table. The trouble is that a
// plain "| a | b |" GFM row has nowhere to carry extra metadata, so a table
// serialized that way would silently drop these attrs the moment the doc
// round-trips through markdown (e.g. just switching tabs and back re-parses
// tab.content from scratch). Falling back to raw-HTML serialization
// whenever either toggle is on sidesteps that: the attrs ride along as
// data-* attributes on the <table> tag itself, and markdown-it's raw HTML
// passthrough (Markdown.configure({ html: true }), same mechanism
// ToggleList relies on) hands that HTML back to ProseMirror's own DOM
// parser on load, which restores them via parseHTML/getAttrs below. Tables
// with both toggles off (the default) keep serializing as clean GFM text,
// same as before this existed.
export const Table = BaseTable.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      showHeaderRow: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-show-header-row") === "true",
        renderHTML: (attrs: { showHeaderRow: boolean }) => (attrs.showHeaderRow ? { "data-show-header-row": "true" } : {}),
      },
      showHeaderColumn: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-show-header-column") === "true",
        renderHTML: (attrs: { showHeaderColumn: boolean }) =>
          attrs.showHeaderColumn ? { "data-show-header-column": "true" } : {},
      },
      // A real leading tableHeader/tableCell column (see tableOps.ts's
      // setShowIndexColumn), not a decoration — its cells hold plain
      // auto-generated "1"/"2"/... text, kept correct by the IndexColumn
      // plugin below after *any* doc change, not just ones that went
      // through tableOps.ts (Tab in the last cell, for one, falls back to
      // prosemirror-tables' own addRowAfter() directly). Column-level ops
      // (add/delete/move column, colCount as seen by the col-grip UI) all
      // treat it as outside the "real" grid — see indexOffset() in
      // tableOps.ts.
      showIndexColumn: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-show-index-column") === "true",
        renderHTML: (attrs: { showIndexColumn: boolean }) =>
          attrs.showIndexColumn ? { "data-show-index-column": "true" } : {},
      },
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNode, parent: PMNode) {
          if (
            !node.attrs.showHeaderRow &&
            !node.attrs.showHeaderColumn &&
            !node.attrs.showIndexColumn &&
            isPlainGfmTable(node)
          ) {
            writeGfmTable(state, node);
          } else {
            writeHtmlTable(state, node, parent);
          }
        },
        parse: {
          // Handled by markdown-it: a clean GFM table renders straight to
          // <table><tr><th>/<td> HTML, and a raw-HTML table (written by
          // writeHtmlTable below) passes through verbatim — either way it's
          // plain HTML by the time it reaches ProseMirror's DOM parser,
          // which is what actually restores the node/attrs.
        },
      },
    };
  },
  // Merges with (rather than replacing) BaseTable's own addProseMirrorPlugins
  // — it registers tableEditing() (cell selection, arrow-key navigation,
  // ...) and, if resizable, columnResizing(); dropping those would break
  // core table editing entirely, not just the index column.
  addProseMirrorPlugins() {
    return [plainCellTextSelectionPlugin(), ...(this.parent?.() ?? []), indexColumnPlugin(), headerRowKindPlugin()];
  },
});

function plainCellTextSelectionPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown: (_view, event) => {
          const target = event.target as HTMLElement | null;
          if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return false;
          if (!target?.closest?.("td, th")) return false;
          return true;
        },
      },
    },
  });
}

interface CellTypeFix {
  from: number; // cell's own start position (its opening token)
  to: number; // cell's own end position
  cell: PMNode;
  correctType: "tableHeader" | "tableCell";
}

// Row 0 must always be tableHeader cells and every other row tableCell —
// isPlainGfmTable/writeGfmTable and the CSS in Editor.svelte's
// [data-show-header-row]/[data-show-header-column] rules all depend on
// that. tableOps.ts's own addRow/deleteRow keep it true for edits that go
// through this app's row-menu actions (see retypeRow there), but nothing
// enforced it against edits that don't — e.g. deleting the actual first row
// of a table via prosemirror-tables' own built-in Backspace/Delete
// handling, or a table pasted in from HTML that never went through
// isPlainGfmTable's check to begin with. When that invariant breaks, only
// whichever cells happen to still be tableHeader visibly respond to the
// showHeaderRow/showHeaderColumn toggles' CSS — e.g. a row 0 of
// [tableCell, tableHeader, tableCell] only bolds its middle cell, which is
// exactly the bug this fixes.
function findCellTypeFixes(table: PMNode, tablePos: number): CellTypeFix[] {
  const fixes: CellTypeFix[] = [];
  table.forEach((row, rowOffset, rowIndex) => {
    const rowStart = tablePos + 1 + rowOffset;
    const expectedType = rowIndex === 0 ? "tableHeader" : "tableCell";
    row.forEach((cell, cellOffset) => {
      if (cell.type.name === expectedType) return;
      if (cell.type.name !== "tableHeader" && cell.type.name !== "tableCell") return;
      const cellStart = rowStart + 1 + cellOffset;
      fixes.push({ from: cellStart, to: cellStart + cell.nodeSize, cell, correctType: expectedType });
    });
  });
  return fixes;
}

function headerRowKindPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const fixes: CellTypeFix[] = [];
      newState.doc.descendants((node, pos) => {
        if (node.type.name !== "table") return;
        fixes.push(...findCellTypeFixes(node, pos));
      });
      if (!fixes.length) return null;
      const tr = newState.tr;
      // tableHeader and tableCell share the same content spec, so swapping
      // one for the other with identical content/attrs/marks never changes
      // nodeSize — every fix's from/to (captured above, against the
      // pre-fix doc) stays valid no matter what order they're applied in
      // or how many other fixes land first, same reasoning as
      // indexColumnPlugin's insertText calls.
      for (const fix of fixes) {
        const targetType = newState.schema.nodes[fix.correctType];
        const newCell = targetType.create(fix.cell.attrs, fix.cell.content, fix.cell.marks);
        tr.replaceWith(fix.from, fix.to, newCell);
      }
      return tr;
    },
  });
}

interface IndexCellFix {
  from: number; // start of the index cell's paragraph text content
  to: number; // end of it
  text: string;
}

// Finds every row in `table` (positioned at `tablePos`) whose index-column
// cell doesn't already read its 1-based row number, and returns just the
// {from,to,text} text range to fix — not new nodes to swap in. Only
// touching the exact text range that's wrong (via tr.insertText, further
// down) rather than rebuilding whole rows/the whole table matters: a full-
// node replaceWith remaps the selection to the nearest surviving edge of
// the replaced range, which — if the user's cursor is anywhere inside that
// table when a row gets added (e.g. mid-Tab, still finishing
// goToNextCell()'s own selection change) — would visibly kick their cursor
// out of the cell they were just typing in. A same-size (or nearly so)
// text-only edit lets ProseMirror's normal position mapping leave an
// unrelated selection exactly where it was.
function findIndexCellFixes(table: PMNode, tablePos: number): IndexCellFix[] {
  if (!table.attrs.showIndexColumn) return [];
  const fixes: IndexCellFix[] = [];
  // With the header row display toggle on, row 0's index cell reads "序号"
  // (a label, not a number) and numbering starts at 1 from row 1 instead —
  // otherwise row 0 is just a normal data row and gets numbered from 1 too.
  const headerRow = !!table.attrs.showHeaderRow;
  table.forEach((row, rowOffset, i) => {
    const rowStart = tablePos + 1 + rowOffset; // row's own start position
    const cell = row.firstChild;
    const para = cell?.firstChild;
    if (!cell || !para || para.type.name !== "paragraph") return;
    const expected = headerRow ? (i === 0 ? t("table.indexHeaderLabel") : String(i)) : String(i + 1);
    if (para.textContent === expected) return;
    // rowStart -> +1 past the row's own open token = cell's start; +1 past
    // the cell's open token = paragraph's start; +1 past the paragraph's
    // own open token = where its text content actually begins.
    const paraTextStart = rowStart + 3;
    fixes.push({ from: paraTextStart, to: paraTextStart + para.content.size, text: expected });
  });
  return fixes;
}

function indexColumnPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (transactions.length === 0) return null;
      const tablePositions: number[] = [];
      newState.doc.descendants((node, pos) => {
        if (node.type.name === "table" && node.attrs.showIndexColumn) tablePositions.push(pos);
      });
      if (!tablePositions.length) return null;
      let tr: Transaction | null = null;
      for (const originalPos of tablePositions) {
        const t: Transaction = tr ?? newState.tr;
        const pos = tr ? t.mapping.map(originalPos) : originalPos;
        const node = t.doc.nodeAt(pos);
        if (!node || node.type.name !== "table") continue;
        const fixes = findIndexCellFixes(node, pos);
        if (!fixes.length) continue;
        // Back-to-front so each insertText's own from/to (computed once,
        // above, against this table's pre-fix layout) stays valid — a fix
        // earlier in the table never shifts a position later in it.
        for (let i = fixes.length - 1; i >= 0; i--) {
          const f = fixes[i];
          t.insertText(f.text, f.from, f.to);
        }
        tr = t;
      }
      return tr;
    },
  });
}

interface MarkdownState {
  inTable: boolean;
  write(text: string): void;
  ensureNewLine(): void;
  closeBlock(node: PMNode): void;
  renderInline(node: PMNode): void;
}

// A cell is safe for writeGfmTable's one-line-per-row output only if its
// content is a single plain paragraph. Anything else — a taskList (e.g. the
// user typed a literal "[x] " inside a cell, which the task-item input rule
// happily converts into a checkbox node right there), a bulletList, a
// blockquote, ... — has no one-line GFM representation. writeGfmTable's
// state.renderInline() call still "succeeds" on such a cell (it doesn't
// throw), but silently produces block-level output — including embedded
// blank lines — spliced into the middle of what's supposed to be a single
// table row, corrupting the row and everything after it. Catching that here
// routes the whole table through the HTML fallback instead, which handles
// arbitrary cell content correctly.
function isPlainCell(cell: PMNode): boolean {
  if (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1 || cell.childCount > 1) return false;
  const content = cell.firstChild;
  return !content || content.type.name === "paragraph";
}

function isPlainGfmTable(table: PMNode): boolean {
  let firstRow: PMNode | null = null;
  const bodyRows: PMNode[] = [];
  table.forEach((row, _p, i) => {
    if (i === 0) firstRow = row;
    else bodyRows.push(row);
  });
  if (!firstRow) return true;
  let ok = true;
  (firstRow as PMNode).forEach((cell) => {
    if (cell.attrs.colwidth) ok = false;
    if (cell.type.name !== "tableHeader" || !isPlainCell(cell)) ok = false;
  });
  for (const row of bodyRows) {
    row.forEach((cell) => {
      if (cell.attrs.colwidth) ok = false;
      if (cell.type.name === "tableHeader" || !isPlainCell(cell)) ok = false;
    });
  }
  return ok;
}

function writeGfmTable(state: MarkdownState, table: PMNode) {
  state.inTable = true;
  table.forEach((row, _p, i) => {
    state.write("| ");
    row.forEach((cell, _p2, j) => {
      if (j) state.write(" | ");
      const cellContent = cell.firstChild;
      if (cellContent && cellContent.textContent.trim()) state.renderInline(cellContent);
    });
    state.write(" |");
    state.ensureNewLine();
    if (!i) {
      const delimiterRow = Array.from({ length: row.childCount })
        .map(() => "---")
        .join(" | ");
      state.write(`| ${delimiterRow} |`);
      state.ensureNewLine();
    }
  });
  state.closeBlock(table);
  state.inTable = false;
}

function writeHtmlTable(state: MarkdownState, table: PMNode, parent: PMNode) {
  const schema = table.type.schema;
  const html = getHTMLFromFragment(Fragment.from(table), schema);
  const atTopLevel = parent?.type?.name === schema.topNodeType.name;
  state.write(atTopLevel ? formatHtmlBlock(html) : html);
  state.closeBlock(table);
}

// Matches the padding tiptap-markdown's own raw-HTML fallback applies (see
// ToggleList's comment above) so a block-level HTML table satisfies
// CommonMark's "blank line around an HTML block" requirement.
function formatHtmlBlock(html: string): string {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  const element = wrapper.firstElementChild;
  if (!element) return html;
  element.innerHTML = element.innerHTML.trim() ? `\n${element.innerHTML}\n` : "\n";
  return element.outerHTML;
}
