const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { getSchema } = require('@tiptap/core');
const { StarterKit } = require('@tiptap/starter-kit');
const { Highlight } = require('@tiptap/extension-highlight');
const { EditorState, TextSelection } = require('@tiptap/pm/state');

function handlers(file, names) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/components', file), 'utf8');
  const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'));
  const parsed = ts.createSourceFile('component.ts', script, ts.ScriptTarget.Latest, true);
  const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  return ts.transpileModule(functions.map(node => node.getText(parsed)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const schema = getSchema([StarterKit, Highlight.configure({ multicolor: true })]);
const applyColor = new Function('editor', 'pendingHighlightRange', `
  let highlightPickerOpen = true, highlightPickerKind = 'highlight';
  ${handlers('Editor.svelte', ['rangesHaveMark', 'applyHighlightColor'])}
  applyHighlightColor('#ffff00');
  return pendingHighlightRange;
`);

for (let level = 1; level <= 6; level++) {
  test(`background color applies to the saved H${level} selection after focus moves`, () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.heading.create({ level }, schema.text('Heading')),
      schema.nodes.paragraph.create(null, schema.text('Body')),
    ]);
    const editor = {
      state: EditorState.create({ doc, selection: TextSelection.create(doc, 10) }),
      commands: { focus() {} },
    };
    editor.view = { dispatch(tr) { editor.state = editor.state.apply(tr); } };
    assert.equal(applyColor(editor, { ranges: [{ from: 2, to: 5 }] }), null);
    assert.equal(editor.state.doc.firstChild.type.name, 'heading');
    assert.equal(editor.state.doc.firstChild.attrs.level, level);
    assert.equal(editor.state.doc.textContent, 'HeadingBody');
    for (let pos = 1; pos <= 7; pos++) {
      const mark = schema.marks.highlight.isInSet(editor.state.doc.nodeAt(pos).marks);
      assert.equal(mark?.attrs.color ?? null, pos >= 2 && pos < 5 ? '#ffff00' : null);
    }
    assert.equal(editor.state.doc.lastChild.firstChild.marks.length, 0);
  });
}

test('color picker stays within the viewport at its right and bottom edges', () => {
  const picker = { style: {}, getBoundingClientRect: () => ({ width: 240, height: 260 }) };
  new Function('picker', 'x', 'y', 'window', `
    ${handlers('HighlightColorPicker.svelte', ['positionPicker'])}
    positionPicker();
  `)(picker, 790, 590, { innerWidth: 800, innerHeight: 600 });
  assert.deepEqual(picker.style, { left: '552px', top: '332px' });
});
