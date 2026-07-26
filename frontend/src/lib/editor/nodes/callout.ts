import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

// Notion-style highlighted callout box. No markdown syntax covers this, so
// (like ToggleList) it relies on tiptap-markdown's raw-HTML fallback
// serializer/parser for its round trip — see toggleList.ts for why that
// requires no extra code here.
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout" }), 0];
  },
  addKeyboardShortcuts() {
    return {
      // content: "block+" lets StarterKit's default Enter just split into
      // another paragraph that's still inside the callout — so it never
      // ends, it only grows. A callout reads as one self-contained note, not
      // a place to keep hitting Enter, so Enter always leaves it instead;
      // Shift-Enter (HardBreak's own default binding, untouched here) is how
      // you add another line *within* it.
      Enter: () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;
        let depth = -1;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === this.name) {
            depth = d;
            break;
          }
        }
        if (depth === -1) return false;
        const afterCallout = $from.after(depth);
        let tr = state.tr;
        if (!tr.doc.resolve(afterCallout).nodeAfter) {
          tr = tr.insert(afterCallout, state.schema.nodes.paragraph.create());
        }
        tr = tr.setSelection(TextSelection.near(tr.doc.resolve(afterCallout), 1)).scrollIntoView();
        view.dispatch(tr);
        return true;
      },
    };
  },
});
