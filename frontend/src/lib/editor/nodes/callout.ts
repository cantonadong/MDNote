import { Node, mergeAttributes } from "@tiptap/core";

// Notion-style highlighted callout box. No markdown syntax covers this, so
// (like ToggleList) it relies on tiptap-markdown's raw-HTML fallback
// serializer/parser for its round trip — see toggleList.ts for why that
// requires no extra code here.
//
// No custom Enter handling on purpose: content:"block+" plus the default
// prosemirror-commands keymap chain (part of StarterKit) already gives this
// the same interaction as blockquote — Enter on a non-empty line splits into
// another paragraph still inside the callout, and Enter again on the now-
// empty line runs liftEmptyBlock, which lifts that empty paragraph out,
// exiting the callout. An earlier version force-exited on every Enter
// regardless of whether the current line was empty, which didn't match
// blockquote's (unmodified, default) behavior.
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
});
