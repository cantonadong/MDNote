const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/components/Editor.svelte'), 'utf8');
const i18nSource = fs.readFileSync(path.join(__dirname, '../src/lib/i18n.svelte.ts'), 'utf8');
const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'));
const parsed = ts.createSourceFile('Editor.ts', script, ts.ScriptTarget.Latest, true);
const names = ['hideTableBlockHandle', 'targetKeepsTableHandle', 'onWindowPointerDown'];
const handlers = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
  .map(node => node.getText(parsed)).join('\n');
const code = ts.transpileModule(handlers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function pointerDownIn(className) {
  const run = new Function('event', `
    let handleFormatIcon = 'table', hoverBlockPos = 42, hoverClientY = 100, handleTop = 80;
    let tableHeaderMenu = null, tableRowMenu = null, tableColMenu = null, imageMenu = null, selectedBlockRect = null;
    ${code}
    onWindowPointerDown(event);
    return { handleTop, hoverBlockPos };
  `);
  // A menu item's button/icon resolves to its ancestor via closest().
  return run({ target: { closest: selectors => selectors.split(',').map(s => s.trim()).includes(className) ? {} : null } });
}

test('pressing a table block menu item keeps its menu and deletion target alive until click', () => {
  assert.deepEqual(pointerDownIn('.block-menu'), { handleTop: 80, hoverBlockPos: 42 });
});

test('pressing outside the table controls still dismisses the handle', () => {
  assert.deepEqual(pointerDownIn('.editor-content-col'), { handleTop: null, hoverBlockPos: null });
});

test('left-side whole-table hover menu offers an explicit add or delete index-column action', () => {
  const actionMenuStart = source.indexOf('{#if menuMode === "actions"}');
  const actionMenu = source.slice(actionMenuStart, source.indexOf('<div', actionMenuStart));
  assert.match(actionMenu, /handleFormatIcon === "table"/);
  assert.match(actionMenu, /handleTableHasIndexColumn\(\)/);
  assert.match(actionMenu, /table\.deleteIndexColumn/);
  assert.match(actionMenu, /table\.addIndexColumn/);
  assert.match(source, /\{#if tableHeaderMenu\.showIndexColumn\}[\s\S]*table\.deleteIndexColumn[\s\S]*\{:else\}[\s\S]*table\.addIndexColumn/);
  assert.match(i18nSource, /"table\.addIndexColumn": "添加序号列"/);
  assert.match(i18nSource, /"table\.deleteIndexColumn": "删除序号列"/);
});

test('add-row and add-column drags stay bound to the table captured at pointerdown', () => {
  for (const handler of ['onAddRowPointerDown', 'onAddColPointerDown']) {
    const start = source.indexOf(`function ${handler}`);
    const end = source.indexOf('\n  function ', start + 1);
    const body = source.slice(start, end);
    assert.match(body, /const maybeRef = currentTableRef\(\);[\s\S]*const ref: TableRef = maybeRef;/);
    assert.match(body, /tableDragActive = true;/);
    assert.equal((body.match(/currentTableRef\(\)/g) ?? []).length, 1);
  }
  assert.match(source, /if \(!tableDragActive\) \{\s*updateTableGutter\(tableEl\);/);
});
