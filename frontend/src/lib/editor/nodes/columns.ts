import { Node, mergeAttributes } from "@tiptap/core";

// Notion-style side-by-side layout (2-5 columns). No markdown syntax covers
// this, so — like Callout/ToggleList — it relies on tiptap-markdown's
// raw-HTML fallback serializer/parser for its round trip; see callout.ts for
// why that requires no extra code here.
export const Column = Node.create({
  name: "column",
  // No `group: "block"` on purpose — a bare column shouldn't be placeable
  // anywhere a block is expected (e.g. directly at doc top level); it's only
  // ever a child of Columns below, which references it by name in its own
  // content expression, same pattern as ToggleSummary/toggleList.
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "column" }), 0];
  },
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      count: {
        default: 2,
        parseHTML: (el) => Number(el.getAttribute("data-count")) || 2,
        renderHTML: (attrs) => ({ "data-count": String(attrs.count) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "columns" }), 0];
  },
});
