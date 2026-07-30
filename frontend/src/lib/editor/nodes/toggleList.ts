import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

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
  // A NodeView (rather than folding the icon into renderHTML directly) is
  // required here: renderHTML also drives markdown serialization, and this
  // node's parseHTML has no explicit content selector, so an icon element
  // baked into that same output would round-trip back in as part of the
  // title's own "inline*" content on the next load. A NodeView's contentDOM
  // is a live-editor-only concept — ProseMirror only ever reads/writes the
  // title through it, so the decorative icon living outside it never
  // touches the document model or the saved file.
  addNodeView() {
    return ({ getPos, editor }) => {
      const dom = document.createElement("summary");
      const icon = document.createElement("span");
      icon.className = "toggle-icon";
      icon.contentEditable = "false";
      // Native <summary> click-to-toggle never actually fires here — inside
      // a contenteditable root, ProseMirror's own mousedown/selection
      // handling wins the click before the browser's built-in disclosure
      // behavior gets a chance (verified directly: clicking anywhere on the
      // summary, icon included, did nothing even before this NodeView
      // existed). Dispatching the attribute change straight from here
      // (rather than flipping `details.open` and relying on the native
      // "toggle" event to round-trip back into a transaction, which is how
      // ToggleList's own NodeView below reacts to genuinely-native toggles)
      // avoids a real double-toggle race that setup had: with this summary
      // nested inside ToggleList's contentDOM, the reconciliation pass
      // triggered by that first transaction could itself cause a second
      // "toggle" event before the DOM settled, flipping it right back.
      icon.addEventListener("mousedown", (e) => e.preventDefault());
      icon.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof getPos !== "function") return;
        const pos = getPos();
        if (pos === undefined) return;
        const $pos = editor.state.doc.resolve(pos);
        const toggle = $pos.node($pos.depth);
        if (toggle.type.name !== "toggleList") return;
        const togglePos = $pos.before($pos.depth);
        editor.view.dispatch(editor.state.tr.setNodeAttribute(togglePos, "open", !toggle.attrs.open));
      });
      const title = document.createElement("span");
      title.className = "toggle-title";
      dom.append(icon, title);
      return {
        dom,
        contentDOM: title,
        // Without this, ProseMirror's documented default for a NodeView
        // with no `update` is to always destroy and recreate it on any
        // reconciliation pass — including ones triggered by unrelated
        // sibling/parent changes (e.g. the toggle's own `open` attr
        // flipping, dispatched from the click handler just above). That
        // recreation was discarding the in-progress DOM toggle before the
        // "toggle" event's transaction could even land, so clicking the
        // icon visibly did nothing.
        update: (updatedNode) => updatedNode.type.name === "toggleSummary",
      };
    };
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
  // Same double-Enter-to-exit gesture as callout/blockquote (Enter on a
  // non-empty line splits into another block still inside; Enter again on
  // the now-empty line exits) — but only for multi-block bodies, where the
  // default liftEmptyBlock command (part of StarterKit's keymap) already
  // does this for free: lifting the last empty block out still leaves the
  // required content:"block+" satisfied by whatever's left. When the body
  // is down to its *one and only* block, lifting it would leave the toggle
  // with zero body blocks, which content:"block+" forbids — callout hits
  // the same wall with content:"block+" but has no title to protect, so
  // ProseMirror's generic fallback there just deletes the whole (otherwise
  // fully empty) node. A toggle's summary can hold real typed text, so this
  // explicit case instead leaves the toggle (and its title) untouched and
  // simply opens a new paragraph right after it for the cursor to land in.
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state, view } = editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        // Enter from inside the title: the toggle is *created* with an
        // empty body paragraph already there (see buildBlockContent's
        // toggleList case), so this should just move into it — not run the
        // default splitBlock, which (toggleSummary can't itself be split
        // into two, per content:"toggleSummary block+") falls back to
        // inserting a *second* body paragraph instead, immediately leaving
        // the body with two empty lines instead of one. That stray extra
        // line is exactly what breaks the "Enter again exits" gesture
        // below the first time a real toggle is used end to end — an empty
        // paragraph stuck in the *middle* of the body (not the last child)
        // is something liftEmptyBlock's lift-and-exit case doesn't handle,
        // so it silently falls through to splitBlock too.
        if ($from.parent.type.name === "toggleSummary") {
          const summaryDepth = $from.depth;
          const toggle = $from.node(summaryDepth - 1);
          if (toggle.type.name !== "toggleList") return false;
          const bodyStart = $from.after(summaryDepth) + 1;
          view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, bodyStart)));
          return true;
        }
        const para = $from.parent;
        if (para.type.name !== "paragraph" || para.content.size !== 0) return false;
        const depth = $from.depth;
        if (depth < 1) return false;
        const toggle = $from.node(depth - 1);
        if (toggle.type.name !== "toggleList") return false;
        // 2 children = [toggleSummary, this paragraph] — the body's only block.
        if (toggle.childCount !== 2 || $from.index(depth - 1) !== 1) return false;
        const toggleEnd = $from.before(depth - 1) + toggle.nodeSize;
        const tr = state.tr.insert(toggleEnd, state.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, toggleEnd + 1));
        view.dispatch(tr);
        return true;
      },
    };
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
