import type { Editor } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";

const INDEX_COLUMN_WIDTH = 40;
const NEW_COLUMN_WIDTH = 200;

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

// The index column (see setShowIndexColumn below), when present, is always
// physical grid column 0 in every row — every "logical" column index used
// throughout this file and by the col-grip UI in Editor.svelte excludes it,
// so callers never need to know it exists. This is the one place that
// conversion happens.
function indexOffset(table: PMNode): number {
  return table.attrs.showIndexColumn ? 1 : 0;
}

export function colCount(table: PMNode): number {
  const total = table.childCount > 0 ? table.child(0).childCount : 0;
  return Math.max(0, total - indexOffset(table));
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

export function deleteTable(editor: Editor, ref: TableRef) {
  const { state, view } = editor;
  view.dispatch(state.tr.delete(ref.pos, ref.pos + ref.node.nodeSize));
}

// Sets every cell's colwidth in each (logical, index-column-excluded)
// column to widths[column] — null clears it back to auto/natural sizing
// (see TableView's updateColumns: a missing colwidth means that column
// isn't fixed-width, so the browser's own table layout sizes it from
// content). Written on every cell in the column, not just row 0, even
// though TableView only reads row 0's — matches how a real column-resize
// drag (prosemirror-tables' own columnResizing, unused here since this app
// never turns resizable on) keeps a column's cells consistent, so nothing
// downstream has to know only row 0 "really" matters.
export function setColumnWidths(editor: Editor, ref: TableRef, widths: (number | null)[]) {
  const off = indexOffset(ref.node);
  const rows = rowsOf(ref.node).map((row) => {
    const cells: PMNode[] = [];
    for (let c = 0; c < row.childCount; c++) {
      const cell = row.child(c);
      const logicalIdx = c - off;
      if (logicalIdx < 0 || logicalIdx >= widths.length) {
        cells.push(cell.type.create({ ...cell.attrs, colwidth: logicalIdx < 0 ? [INDEX_COLUMN_WIDTH] : cell.attrs.colwidth }, cell.content, cell.marks));
        continue;
      }
      const w = widths[logicalIdx];
      cells.push(cell.type.create({ ...cell.attrs, colwidth: w ? [w] : null }, cell.content, cell.marks));
    }
    return row.type.create(row.attrs, cells, row.marks);
  });
  replaceTable(editor, ref, rows);
}

export function setPhysicalColumnWidths(editor: Editor, ref: TableRef, widths: (number | null)[]) {
  const rows = rowsOf(ref.node).map((row) => {
    const cells: PMNode[] = [];
    for (let c = 0; c < row.childCount; c++) {
      const cell = row.child(c);
      const w = widths[c];
      cells.push(cell.type.create({ ...cell.attrs, colwidth: c === 0 && ref.node.attrs.showIndexColumn ? [INDEX_COLUMN_WIDTH] : w ? [w] : null }, cell.content, cell.marks));
    }
    return row.type.create(row.attrs, cells, row.marks);
  });
  replaceTable(editor, ref, rows);
}

// Toggles the index column on/off — inserting or removing physical column 0
// in every row and flipping the table's showIndexColumn attr in the same
// step. The newly-added column's numbers are left blank; the IndexColumn
// ProseMirror plugin (see nodes/table.ts) fills them in as soon as this
// transaction lands, the same way it keeps them correct after any other
// row add/delete/move — including ones that don't go through this file at
// all, like prosemirror-tables' own addRowAfter() (what Tab in the last
// cell falls back to).
export function setShowIndexColumn(editor: Editor, ref: TableRef, show: boolean) {
  const wasOn = !!ref.node.attrs.showIndexColumn;
  if (show === wasOn) return;
  const rows = rowsOf(ref.node).map((row) => {
    const cells: PMNode[] = [];
    for (let c = 0; c < row.childCount; c++) cells.push(row.child(c));
    if (show) {
      const kind = row.child(0)?.type.name === "tableHeader" ? editor.state.schema.nodes.tableHeader : editor.state.schema.nodes.tableCell;
      const filled = kind.createAndFill();
      if (filled) cells.unshift(kind.create({ ...filled.attrs, colwidth: [INDEX_COLUMN_WIDTH] }, filled.content, filled.marks));
    } else {
      cells.shift();
    }
    return row.type.create(row.attrs, cells, row.marks);
  });
  const newTable = ref.node.type.create({ ...ref.node.attrs, showIndexColumn: show }, rows, ref.node.marks);
  editor.view.dispatch(editor.state.tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, newTable));
}

export function setTableHeaderAttrs(
  editor: Editor,
  ref: TableRef,
  attrs: Partial<{ showHeaderRow: boolean; showHeaderColumn: boolean }>,
) {
  editor.view.dispatch(editor.state.tr.setNodeMarkup(ref.pos, undefined, { ...ref.node.attrs, ...attrs }));
}

// Row 0 is always a real tableHeader node regardless of the showHeaderRow
// display toggle (see editor/nodes/table.ts) — GFM serialization and
// isPlainGfmTable() both depend on that. Inserting a row above index 0 or
// deleting index 0 changes which row that is, so the cell kind has to be
// swapped along with it to keep the invariant true.
function retypeRow(row: PMNode, schema: Schema, kind: "tableHeader" | "tableCell"): PMNode {
  const targetType = schema.nodes[kind];
  const cells: PMNode[] = [];
  row.forEach((cell) => {
    cells.push(cell.type.name === kind ? cell : targetType.create(cell.attrs, cell.content, cell.marks));
  });
  return row.type.create(row.attrs, cells, row.marks);
}

function isCellEmpty(cell: PMNode): boolean {
  if (cell.textContent.trim().length > 0) return false;
  let hasAtom = false;
  cell.descendants((child) => {
    if (child.isAtom && !child.isText) hasAtom = true;
  });
  return !hasAtom;
}

function isRowEmpty(row: PMNode, table: PMNode): boolean {
  const off = indexOffset(table);
  for (let c = off; c < row.childCount; c++) if (!isCellEmpty(row.child(c))) return false;
  return true;
}

function isColumnEmpty(table: PMNode, colIndex: number): boolean {
  const off = indexOffset(table);
  for (let r = 0; r < table.childCount; r++) {
    const cell = table.child(r).child(colIndex + off);
    if (cell && !isCellEmpty(cell)) return false;
  }
  return true;
}

// How many rows/columns, counting back from the last one, can be dropped
// without discarding real content — used both to cap the add-row/add-col
// button's remove-drag preview and to clamp the actual removal below, so a
// user can only shrink a table back down through cells they already
// emptied out (undo-able content loss, never silent data loss).
export function trailingEmptyRowCount(table: PMNode): number {
  const rows = rowsOf(table);
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!isRowEmpty(rows[i], table)) break;
    n++;
  }
  return n;
}

export function trailingEmptyColumnCount(table: PMNode): number {
  const cols = colCount(table);
  let n = 0;
  for (let c = cols - 1; c >= 0; c--) {
    if (!isColumnEmpty(table, c)) break;
    n++;
  }
  return n;
}

export function addRow(editor: Editor, ref: TableRef, atIndex: number) {
  const { schema } = editor.state;
  const totalCols = colCount(ref.node) + indexOffset(ref.node);
  const rows = rowsOf(ref.node);
  // Inserting above the current row 0 pushes it down to row 1, so it has to
  // stop being the header row — and the new row takes over that spot instead.
  const insertingHeader = atIndex === 0 && rows.length > 0;
  const kind = insertingHeader ? schema.nodes.tableHeader : schema.nodes.tableCell;
  const cells: PMNode[] = [];
  for (let c = 0; c < totalCols; c++) {
    const cell = kind.createAndFill();
    if (cell) cells.push(cell);
  }
  const newRow = schema.nodes.tableRow.create(null, cells);
  if (insertingHeader) rows[0] = retypeRow(rows[0], schema, "tableCell");
  rows.splice(atIndex, 0, newRow);
  replaceTable(editor, ref, rows);
}

// Deletes a specific row outright (no "must already be empty" restriction —
// unlike removeRows below, this backs an explicit menu action, not a drag
// gesture that could delete content by accident). Keeps at least one row,
// and re-promotes the new row 0 to a header row if the old one was removed.
export function deleteRow(editor: Editor, ref: TableRef, index: number) {
  const rows = rowsOf(ref.node);
  if (rows.length <= 1) return;
  rows.splice(index, 1);
  if (index === 0) rows[0] = retypeRow(rows[0], editor.state.schema, "tableHeader");
  replaceTable(editor, ref, rows);
}

// Batch versions for the add-row button's drag gesture — inserting/removing
// several rows for one pointer-drag-then-release needs to land as a single
// transaction (one replaceTable call) so it's also one undo step, not N.
export function addRows(editor: Editor, ref: TableRef, atIndex: number, count: number) {
  if (count <= 0) return;
  const { schema } = editor.state;
  const totalCols = colCount(ref.node) + indexOffset(ref.node);
  const rows = rowsOf(ref.node);
  const newRows: PMNode[] = [];
  for (let i = 0; i < count; i++) {
    const cells: PMNode[] = [];
    for (let c = 0; c < totalCols; c++) {
      const cell = schema.nodes.tableCell.createAndFill();
      if (cell) cells.push(cell);
    }
    newRows.push(schema.nodes.tableRow.create(null, cells));
  }
  rows.splice(atIndex, 0, ...newRows);
  replaceTable(editor, ref, rows);
}

export function removeRows(editor: Editor, ref: TableRef, fromIndex: number, count: number) {
  const rows = rowsOf(ref.node);
  const removable = Math.min(count, rows.length - 1, rows.length - fromIndex, trailingEmptyRowCount(ref.node));
  if (removable <= 0) return;
  rows.splice(fromIndex, removable);
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
  const off = indexOffset(ref.node);
  const rows = rowsOf(ref.node).map((row) => {
    const cells: PMNode[] = [];
    for (let c = 0; c < row.childCount; c++) cells.push(row.child(c));
    // Match the row's own cell kind (header row is all tableHeader) rather
    // than always inserting a plain tableCell, so a new column doesn't leave
    // the header row with a stray non-bold cell.
    const kind = row.child(0)?.type.name === "tableHeader" ? schema.nodes.tableHeader : schema.nodes.tableCell;
    const newCell = kind.createAndFill();
    if (newCell) cells.splice(atIndex + off, 0, kind.create({ ...newCell.attrs, colwidth: [NEW_COLUMN_WIDTH] }, newCell.content, newCell.marks));
    return row.type.create(row.attrs, cells, row.marks);
  });
  replaceTable(editor, ref, rows);
}

// Batch versions for the add-column button's drag gesture — see addRows/
// removeRows above for why this needs to be one transaction, not N.
export function addColumns(editor: Editor, ref: TableRef, atIndex: number, count: number) {
  if (count <= 0) return;
  const { schema } = editor.state;
  const off = indexOffset(ref.node);
  const rows = rowsOf(ref.node).map((row) => {
    const cells: PMNode[] = [];
    for (let c = 0; c < row.childCount; c++) cells.push(row.child(c));
    const kind = row.child(0)?.type.name === "tableHeader" ? schema.nodes.tableHeader : schema.nodes.tableCell;
    const newCells: PMNode[] = [];
    for (let i = 0; i < count; i++) {
      const cell = kind.createAndFill();
      if (cell) newCells.push(kind.create({ ...cell.attrs, colwidth: [NEW_COLUMN_WIDTH] }, cell.content, cell.marks));
    }
    cells.splice(atIndex + off, 0, ...newCells);
    return row.type.create(row.attrs, cells, row.marks);
  });
  replaceTable(editor, ref, rows);
}

export function addCheckboxColumn(editor: Editor, ref: TableRef) {
  const { schema } = editor.state;
  const off = indexOffset(ref.node);
  const lastLogical = colCount(ref.node) - 1;
  const reuseLast = lastLogical >= 0 && isColumnEmpty(ref.node, lastLogical);
  const rows = rowsOf(ref.node).map((row) => {
    const cells: PMNode[] = [];
    for (let c = 0; c < row.childCount; c++) cells.push(row.child(c));
    const kind = row.child(0)?.type.name === "tableHeader" ? schema.nodes.tableHeader : schema.nodes.tableCell;
    const paragraph = schema.nodes.paragraph.create();
    const taskItem = schema.nodes.taskItem.create({ checked: false }, paragraph);
    const taskList = schema.nodes.taskList.create(null, taskItem);
    const cell = kind.create({ colwidth: [NEW_COLUMN_WIDTH] }, taskList);
    if (reuseLast) cells[lastLogical + off] = cell;
    else cells.push(cell);
    return row.type.create(row.attrs, cells, row.marks);
  });
  replaceTable(editor, ref, rows);
}

// Explicit "delete this column" menu action — see deleteRow above for why
// this isn't restricted to already-empty columns the way removeColumns is.
export function deleteColumn(editor: Editor, ref: TableRef, index: number) {
  if (colCount(ref.node) <= 1) return;
  const off = indexOffset(ref.node);
  const rows = rowsOf(ref.node).map((row) => {
    const cells: PMNode[] = [];
    for (let c = 0; c < row.childCount; c++) if (c !== index + off) cells.push(row.child(c));
    return row.type.create(row.attrs, cells, row.marks);
  });
  replaceTable(editor, ref, rows);
}

// Deletes the complete rows and physical columns covered by one rectangular
// CellSelection in a single transaction. If that would leave no grid at
// all, the table itself is removed.
export function deleteSelectedRowsAndColumns(
  editor: Editor,
  ref: TableRef,
  rowFrom: number,
  rowTo: number,
  colFrom: number,
  colTo: number,
) {
  const remainingRowCount = ref.node.childCount - (rowTo - rowFrom);
  const physicalCols = ref.node.firstChild?.childCount ?? 0;
  const remainingColCount = physicalCols - (colTo - colFrom);
  if (remainingRowCount <= 0 || remainingColCount <= 0) {
    deleteTable(editor, ref);
    return;
  }
  const rows = rowsOf(ref.node)
    .filter((_row, index) => index < rowFrom || index >= rowTo)
    .map((row) => {
      const cells: PMNode[] = [];
      for (let col = 0; col < row.childCount; col++) {
        if (col < colFrom || col >= colTo) cells.push(row.child(col));
      }
      return row.type.create(row.attrs, cells, row.marks);
    });
  rows[0] = retypeRow(rows[0], editor.state.schema, "tableHeader");
  const removedIndexColumn = !!ref.node.attrs.showIndexColumn && colFrom === 0;
  const attrs = removedIndexColumn ? { ...ref.node.attrs, showIndexColumn: false } : ref.node.attrs;
  const newTable = ref.node.type.create(attrs, rows, ref.node.marks);
  editor.view.dispatch(editor.state.tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, newTable));
}

export function removeColumns(editor: Editor, ref: TableRef, fromIndex: number, count: number) {
  const total = colCount(ref.node);
  const removable = Math.min(count, total - 1, total - fromIndex, trailingEmptyColumnCount(ref.node));
  if (removable <= 0) return;
  const off = indexOffset(ref.node);
  const rows = rowsOf(ref.node).map((row) => {
    const cells: PMNode[] = [];
    for (let c = 0; c < row.childCount; c++)
      if (c < fromIndex + off || c >= fromIndex + off + removable) cells.push(row.child(c));
    return row.type.create(row.attrs, cells, row.marks);
  });
  replaceTable(editor, ref, rows);
}

export function moveColumn(editor: Editor, ref: TableRef, fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return;
  const off = indexOffset(ref.node);
  const rows = rowsOf(ref.node).map((row) => {
    const cells: PMNode[] = [];
    for (let c = 0; c < row.childCount; c++) cells.push(row.child(c));
    const [moved] = cells.splice(fromIndex + off, 1);
    cells.splice(toIndex + off, 0, moved);
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
