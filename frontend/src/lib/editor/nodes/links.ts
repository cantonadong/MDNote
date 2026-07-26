import { Node, mergeAttributes, Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { appState } from "../../appState.svelte";
import { api } from "../../api";

// Inline "chip" nodes for Notion-style page/file references. Both are atoms
// (no editable inner content, just attrs), so appearance is a plain static
// renderHTML — the interesting behavior (opening the target on click) lives
// in LinkClickHandler below rather than a NodeView, since a NodeView buys
// nothing extra for a leaf node.
function linkChipNode(name: string, dataType: string, glyph: string) {
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        path: { default: null as string | null },
        title: { default: "" },
      };
    },
    parseHTML() {
      return [{ tag: `a[data-type="${dataType}"]` }];
    },
    renderHTML({ node, HTMLAttributes }) {
      return [
        "a",
        mergeAttributes(HTMLAttributes, {
          "data-type": dataType,
          "data-path": node.attrs.path ?? "",
          href: "#",
          class: "link-chip",
          title: node.attrs.path ?? "",
        }),
        `${glyph} ${node.attrs.title || "(未命名)"}`,
      ];
    },
  });
}

export const PageLink = linkChipNode("pageLink", "page-link", "\u{1F4C4}");
export const FileLink = linkChipNode("fileLink", "file-link", "\u{1F4CE}");

export const LinkClickHandler = Extension.create({
  name: "linkClickHandler",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClickOn(_view, _pos, node, _nodePos, event) {
            const path = node.attrs.path as string | null | undefined;
            if (node.type.name === "pageLink") {
              event.preventDefault();
              if (path) void appState.openPath(path);
              return true;
            }
            if (node.type.name === "fileLink") {
              event.preventDefault();
              if (path) {
                api.openWithDefaultApp(path).catch((e) => appState.showToast(`打开失败: ${e}`));
              }
              return true;
            }
            return false;
          },
          // Plain hyperlinks (StarterKit's bundled Link mark — typed/pasted
          // URLs, or [text](url) markdown) are configured with
          // openOnClick: false in Editor.svelte, since its default
          // click-to-open just does a DOM window.open, which inside
          // WebView2 tries to spawn another embedded webview rather than
          // the user's actual browser. Uses api.openURL (Wails'
          // runtime.BrowserOpenURL) rather than openWithDefaultApp's `cmd
          // /c start` — cmd.exe re-parses its whole command line for shell
          // metacharacters common in URL query strings, which was mangling
          // some URLs into a bogus "file not found" cmd popup.
          handleDOMEvents: {
            click(_view, event) {
              const target = (event.target as HTMLElement | null)?.closest?.("a");
              if (!target || target.classList.contains("link-chip")) return false;
              const href = target.getAttribute("href");
              if (!href || href === "#") return false;
              event.preventDefault();
              api.openURL(href);
              return true;
            },
          },
        },
      }),
    ];
  },
});
