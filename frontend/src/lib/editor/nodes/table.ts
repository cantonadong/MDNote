import { getHTMLFromFragment } from "@tiptap/core";
import { Table as BaseTable } from "@tiptap/extension-table";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Fragment } from "@tiptap/pm/model";

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
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNode, parent: PMNode) {
          if (!node.attrs.showHeaderRow && !node.attrs.showHeaderColumn && isPlainGfmTable(node)) {
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
});

interface MarkdownState {
  inTable: boolean;
  write(text: string): void;
  ensureNewLine(): void;
  closeBlock(node: PMNode): void;
  renderInline(node: PMNode): void;
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
    if (cell.type.name !== "tableHeader" || cell.attrs.colspan > 1 || cell.attrs.rowspan > 1 || cell.childCount > 1) ok = false;
  });
  for (const row of bodyRows) {
    row.forEach((cell) => {
      if (cell.type.name === "tableHeader" || cell.attrs.colspan > 1 || cell.attrs.rowspan > 1 || cell.childCount > 1) ok = false;
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
