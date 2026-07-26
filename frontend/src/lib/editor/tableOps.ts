import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

// Row/column add/delete/reorder for the Table extension, implemented by
// rebuilding the whole table node and replacing it in one step rather than
// computing insert/delete positions inside it — simpler to get right, and
// safe here because our tables are always a uniform grid (no colspan/rowspan:
// nothing in this app ever offers a "merge cells" UI).

export interface TableRef {
  node: PMNode;
  pos: number; // doc position immediately before the table node
}

export function findTable(editor: Editor, atPos: number): TableRef | null {
  const $pos = editor.state.doc.resolve(atPos);
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "table") {
      return { node, pos: $pos.before(d) };
    }
  }
  return null;
}

export function rowCount(table: PMNode): number {
  return table.childCount;
}

export function colCount(table: PMNode): number {
  return table.childCount > 0 ? table.child(0).childCount : 0;
}

function rowsOf(table: PMNode): PMNode[] {
  const rows: PMNode[] = [];
  for (let i = 0; i < table.childCount; i++) rows.push(table.child(i));
  return rows;
}

function replaceTable(editor: Editor, ref: TableRef, rows: PMNode[]) {
  const { state, view } = editor;
  const newTable = ref.node.type.create(ref.node.attrs, rows, ref.node.marks);
  view.dispatch(state.tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, newTable));
}

export function addRow(editor: Editor, ref: TableRef, atIndex: number) {
  const { schema } = editor.state;
  const cols = colCount(ref.node);
  const cells: PMNode[] = [];
  for (let c = 0; c < cols; c++) {
    const cell = schema.nodes.tableCell.createAndFill();
    if (cell) cells.push(cell);
  }
  const newRow = schema.nodes.tableRow.create(null, cells);
  const rows = rowsOf(ref.node);
  rows.splice(atIndex, 0, newRow);
  replaceTable(editor, ref, rows);
}

export function deleteRow(editor: Editor, ref: TableRef, index: number) {
  if (rowCount(ref.node) <= 1) return;
  const rows = rowsOf(ref.node).filter((_, i) => i !== index);
  replaceTable(editor, ref, rows);
}

export function moveRow(editor: Editor, ref: TableRef, fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return;
  const rows = rowsOf(ref.node);
  const [moved] = rows.splice(fromIndex, 1);
  rows.splice(toIndex, 0, moved);
  replaceTable(editor, ref, rows);
}

export function addColumn(editor: Editor, ref: TableRef, atIndex: number) {
  const { schema } = editor.state;
  const rows = rowsOf(ref.node).map((row) => {
    const cells: PMNode[] = [];
    for (let c = 0; c < row.childCount; c++) cells.push(row.child(c));
    // Match the row's own cell kind (header row is all tableHeader) rather
    // than always inserting a plain tableCell, so a new column doesn't leave
    // the header row with a stray non-bold cell.
    const kind = row.child(0)?.type.name === "tableHeader" ? schema.nodes.tableHeader : schema.nodes.tableCell;
    const newCell = kind.createAndFill();
    if (newCell) cells.splice(atIndex, 0, newCell);
    return row.type.create(row.attrs, cells, row.marks);
  });
  replaceTable(editor, ref, rows);
}

export function deleteColumn(editor: Editor, ref: TableRef, index: number) {
  if (colCount(ref.node) <= 1) return;
  const rows = rowsOf(ref.node).map((row) => {
    const cells: PMNode[] = [];
    for (let c = 0; c < row.childCount; c++) if (c !== index) cells.push(row.child(c));
    return row.type.create(row.attrs, cells, row.marks);
  });
  replaceTable(editor, ref, rows);
}

export function moveColumn(editor: Editor, ref: TableRef, fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return;
  const rows = rowsOf(ref.node).map((row) => {
    const cells: PMNode[] = [];
    for (let c = 0; c < row.childCount; c++) cells.push(row.child(c));
    const [moved] = cells.splice(fromIndex, 1);
    cells.splice(toIndex, 0, moved);
    return row.type.create(row.attrs, cells, row.marks);
  });
  replaceTable(editor, ref, rows);
}

// Given the boundaries of N items (each {start,end} in one axis) and a
// pointer coordinate along that axis, returns which of the N+1 "slots"
// (before item 0, between item i/i+1, ..., after the last item) the pointer
// is nearest — used for both row (Y axis) and column (X axis) drag reorder.
export function slotIndex(mids: number[], coord: number): number {
  let slot = 0;
  for (const mid of mids) {
    if (coord > mid) slot++;
  }
  return slot;
}

// Converts a raw drop "slot" (0..N, N+1 possible landing spots around N
// items) into the actual target array index for Array.splice-style reorder,
// accounting for the dragged item itself being removed first.
export function slotToTargetIndex(slot: number, fromIndex: number): number {
  return slot > fromIndex ? slot - 1 : slot;
}
