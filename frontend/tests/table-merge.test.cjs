const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { getSchema } = require('@tiptap/core');
const { StarterKit } = require('@tiptap/starter-kit');
const { TableRow } = require('@tiptap/extension-table-row');
const { TaskList } = require('@tiptap/extension-task-list');
const { TaskItem } = require('@tiptap/extension-task-item');
const { EditorState } = require('@tiptap/pm/state');
const { CellSelection, TableMap, mergeCells, splitCell, tableEditing } = require('@tiptap/pm/tables');
const { history, undo, redo, closeHistory } = require('@tiptap/pm/history');

function loadSource(relativePath) {
  const filename = path.join(__dirname, '..', 'src', 'lib', 'editor', relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(
    name => name.includes('i18n.svelte') ? { t: key => key } : require(name), exports,
  );
  return exports;
}

const { Table, TableCell, TableHeader } = loadSource('nodes/table.ts');
const ops = loadSource('tableOps.ts');
const schema = getSchema([StarterKit, Table, TableRow, TableCell, TableHeader, TaskList, TaskItem]);

function fixture(indexColumn = false) {
  const rows = Array.from({ length: 4 }, (_, row) => schema.nodes.tableRow.create(null,
    Array.from({ length: 4 }, (_, col) => {
      const type = row === 0 ? schema.nodes.tableHeader : schema.nodes.tableCell;
      return type.create(null, schema.nodes.paragraph.create(null, schema.text(`${row},${col}`)));
    }),
  ));
  const editor = {
    state: EditorState.create({
      doc: schema.nodes.doc.create(null, schema.nodes.table.create({ showIndexColumn: indexColumn }, rows)),
      plugins: [history(), tableEditing(), ...Table.config.addProseMirrorPlugins.call({ parent: () => [] })],
    }),
  };
  editor.view = { dispatch: tr => { editor.state = editor.state.applyTransaction(tr).state; } };
  return editor;
}

const ref = editor => ({ pos: 0, node: editor.state.doc.firstChild });
function select(editor, top, left, bottom = top, right = left) {
  const map = TableMap.get(ref(editor).node);
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,
    1 + map.map[top * map.width + left], 1 + map.map[bottom * map.width + right],
  )));
}
function merge(editor, top = 1, left = 1, bottom = 2, right = 2) {
  select(editor, top, left, bottom, right);
  assert.equal(mergeCells(editor.state, editor.view.dispatch), true);
}
function valid(editor, width, height) {
  editor.state.doc.check();
  const map = TableMap.get(ref(editor).node);
  assert.equal(map.problems, null);
  assert.equal(map.width, width);
  assert.equal(map.height, height);
}

test('merge and split preserve content, dimensions, and undo/redo', () => {
  const editor = fixture();
  merge(editor);
  const mergedDoc = editor.state.doc;
  const cell = editor.state.selection.$anchorCell.nodeAfter;
  assert.equal(cell.attrs.colspan, 2);
  assert.equal(cell.attrs.rowspan, 2);
  for (const value of ['1,1', '1,2', '2,1', '2,2']) assert.ok(cell.textContent.includes(value));
  valid(editor, 4, 4);
  editor.view.dispatch(closeHistory(editor.state.tr));
  assert.equal(splitCell(editor.state, editor.view.dispatch), true);
  const splitDoc = editor.state.doc;
  valid(editor, 4, 4);
  assert.equal(ref(editor).node.child(1).child(1).textContent, cell.textContent);
  assert.equal(undo(editor.state, editor.view.dispatch), true);
  assert.ok(editor.state.doc.eq(mergedDoc));
  assert.equal(redo(editor.state, editor.view.dispatch), true);
  assert.ok(editor.state.doc.eq(splitDoc));
  valid(editor, 4, 4);
  assert.ok(mergedDoc.toJSON().content[0].content[1].content.some(c => c.attrs.colspan === 2));
});

test('single ordinary cells cannot merge or split; merged single cells can split', () => {
  const editor = fixture();
  select(editor, 1, 1);
  assert.equal(mergeCells(editor.state), false);
  assert.equal(splitCell(editor.state), false);
  merge(editor);
  select(editor, 1, 1);
  assert.equal(splitCell(editor.state), true);
});

test('adding and deleting through spans keeps a rectangular grid', () => {
  const editor = fixture();
  merge(editor);
  ops.addRows(editor, ref(editor), 2, 2);
  valid(editor, 4, 6);
  ops.addColumns(editor, ref(editor), 2, 2);
  valid(editor, 6, 6);
  ops.deleteRow(editor, ref(editor), 1);
  valid(editor, 6, 5);
  ops.deleteColumn(editor, ref(editor), 1);
  valid(editor, 5, 5);
  ops.deleteSelectedRowsAndColumns(editor, ref(editor), 1, 2, 1, 2);
  valid(editor, 4, 4);
});

test('column widths and index toggles preserve a merged header and empty spanned rows', () => {
  const editor = fixture();
  merge(editor, 0, 0, 1, 3);
  assert.equal(ops.colCount(ref(editor).node), 4);
  assert.doesNotThrow(() => ops.trailingEmptyColumnCount(ref(editor).node));
  ops.setPhysicalColumnWidths(editor, ref(editor), [80, 100, 120, 140]);
  assert.deepEqual(ref(editor).node.firstChild.firstChild.attrs.colwidth, [80, 100, 120, 140]);
  ops.setShowIndexColumn(editor, ref(editor), true);
  valid(editor, 5, 4);
  ops.setShowIndexColumn(editor, ref(editor), false);
  valid(editor, 4, 4);
  ops.addCheckboxColumn(editor, ref(editor));
  valid(editor, 5, 4);
  assert.equal(ref(editor).node.child(1).lastChild.firstChild.type.name, 'taskList');
});

test('moving rows and columns containing merged cells preserves the grid', () => {
  const editor = fixture();
  merge(editor);
  ops.moveRow(editor, ref(editor), 1, 3);
  valid(editor, 4, 4);
  ops.moveColumn(editor, ref(editor), 1, 3);
  valid(editor, 4, 4);
});
