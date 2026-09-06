const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/components/Editor.svelte'), 'utf8');
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
