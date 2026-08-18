import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

function stripLeadingNotionCalloutIcon(element: HTMLElement) {
  const visit = (node: ChildNode): boolean => {
    if (node.nodeType === node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (!text.trim()) return false;
      node.textContent = text.replace(/^(\s*)💡\s*/u, "$1");
      return true;
    }
    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true;
    }
    return false;
  };
  visit(element);

  // Notion may put the emoji in its own wrapper before the callout body.
  // Remove that wrapper once stripping the icon leaves it empty, otherwise
  // ProseMirror would preserve it as an extra blank paragraph above a list.
  const firstElement = element.firstElementChild;
  if (firstElement && !firstElement.textContent?.trim() && !firstElement.querySelector("img,ol,ul,p")) {
    firstElement.remove();
  }
}

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
    return [
      { tag: 'div[data-type="callout"]' },
      {
        tag: "aside",
        getAttrs: (element) => {
          stripLeadingNotionCalloutIcon(element);
          return {};
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout" }), 0];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPastedHTML(html) {
            if (!/<aside(?:\s|>)/i.test(html)) return html;
            const document = new DOMParser().parseFromString(html, "text/html");
            for (const aside of Array.from(document.body.querySelectorAll("aside"))) {
              const callout = document.createElement("div");
              callout.setAttribute("data-type", "callout");
              while (aside.firstChild) callout.append(aside.firstChild);
              stripLeadingNotionCalloutIcon(callout);
              aside.replaceWith(callout);
            }
            return document.body.innerHTML;
          },
        },
      }),
    ];
  },
});
