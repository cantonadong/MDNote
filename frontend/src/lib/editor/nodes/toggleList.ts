import { Node, mergeAttributes } from "@tiptap/core";

// A Notion-style collapsible block. Modeled on the native <details>/<summary>
// pair so open/closed state is just a DOM attribute the browser already
// knows how to toggle — no extra plugin/decoration machinery needed. This
// also gives it a free markdown round-trip: tiptap-markdown falls back to
// raw-HTML passthrough for any node without an explicit serializer, and
// <details>/<summary> survive that passthrough (and markdown-it's HTML
// block parsing on the way back in) unchanged.
export const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "summary" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["summary", mergeAttributes(HTMLAttributes), 0];
  },
});

export const ToggleList = Node.create({
  name: "toggleList",
  group: "block",
  content: "toggleSummary block+",
  defining: true,
  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.hasAttribute("open"),
        renderHTML: (attrs) => (attrs.open ? { open: "" } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "details" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["details", mergeAttributes(HTMLAttributes), 0];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      // contentDOM === dom: <summary> and the body blocks must be direct
      // children of <details> for the browser's native collapse behavior
      // (hiding everything but <summary> when closed) to apply.
      const dom = document.createElement("details");
      dom.className = "toggle-list";
      if (node.attrs.open) dom.setAttribute("open", "");

      dom.addEventListener("toggle", () => {
        if (typeof getPos !== "function") return;
        const pos = getPos();
        if (pos === undefined) return;
        editor.view.dispatch(editor.view.state.tr.setNodeAttribute(pos, "open", dom.open));
      });

      return {
        dom,
        contentDOM: dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "toggleList") return false;
          dom.open = !!updatedNode.attrs.open;
          return true;
        },
      };
    };
  },
});
