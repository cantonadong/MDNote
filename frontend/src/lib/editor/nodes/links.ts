import { Node, mergeAttributes, Extension, getMarkRange } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { appState } from "../../appState.svelte";
import { api } from "../../api";
import { t } from "../../i18n.svelte";

function basenameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx === -1 ? path : path.slice(idx + 1);
}

// Inline "chip" nodes for Notion-style page/file references. Both are atoms
// (no editable inner content, just attrs), so appearance is a plain static
// renderHTML — the interesting behavior (opening the target on click) lives
// in LinkClickHandler below rather than a NodeView, since a NodeView buys
// nothing extra for a leaf node.
//
// Deliberately no "title" attribute: the displayed label is always derived
// from `path`'s current basename at render time, so renaming the target
// file (via appState.renameEntry, which walks open tabs updating any
// chip's `path` — see appState) automatically updates what the chip shows,
// with nothing else to keep in sync. Storing a separate static title would
// go stale the moment the target got renamed, and previously *did* — a
// real pre-existing bug, not just a hypothetical: this node's "title" attr
// had no explicit parseHTML/renderHTML, so it fell back to Tiptap's default
// of reading/writing a plain `title="..."` HTML attribute — the same
// attribute name this renderHTML was *also* separately using for the
// native hover-tooltip (set to the path, for a different purpose). The
// tooltip's value silently won on render, meaning every save+reload round
// trip overwrote the chip's remembered title with its own path string.
function linkChipNode(name: string, dataType: string, glyph: string, stripExt: boolean) {
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        path: {
          default: null as string | null,
          parseHTML: (el: HTMLElement) => el.getAttribute("data-path"),
          renderHTML: (attrs: { path: string | null }) => ({ "data-path": attrs.path ?? "" }),
        },
        // Stable id from the backend's link registry (linkids.go) — unset
        // for chips created before this existed, which just fall back to
        // the stored path with no id-based resolution. See LinkClickHandler
        // for how this keeps a link working even if its target got
        // renamed/moved while the file holding the link was closed.
        id: {
          default: null as string | null,
          parseHTML: (el: HTMLElement) => el.getAttribute("data-id"),
          renderHTML: (attrs: { id: string | null }) => (attrs.id ? { "data-id": attrs.id } : {}),
        },
      };
    },
    parseHTML() {
      // Explicit priority (default is 50) is load-bearing, not decorative:
      // StarterKit's own Link *mark* also matches any `<a href>` tag,
      // including this one. Without out-ranking it here, whichever rule
      // ProseMirror's DOMParser happens to try first wins — verified by
      // direct round-trip testing that it's the Link mark, not this node,
      // silently degrading every pageLink/fileLink chip into a plain
      // editable hyperlink (losing its path/id attrs and click behavior)
      // the moment the document re-parses from its markdown string form,
      // which happens on every tab switch, not just a save+reload.
      return [{ tag: `a[data-type="${dataType}"]`, priority: 100 }];
    },
    renderHTML({ node, HTMLAttributes }) {
      const path = node.attrs.path as string | null;
      let label = path ? basenameOf(path) : "(未命名)";
      if (stripExt) label = label.replace(/\.md$/i, "");
      // Icon split into its own element (rather than one plain text node
      // with the glyph and label concatenated) purely so the "broken link"
      // CSS below has something to swap out — see .link-chip-invalid.
      return [
        "a",
        mergeAttributes(HTMLAttributes, {
          "data-type": dataType,
          href: "#",
          class: "link-chip",
          title: path ?? "",
        }),
        ["span", { class: "link-chip-icon" }, glyph],
        `${label}`,
      ];
    },
  });
}

export const PageLink = linkChipNode("pageLink", "page-link", "\u{1F4C4}", true);
export const FileLink = linkChipNode("fileLink", "file-link", "\u{1F4CE}", false);

// Tracks which link targets (keyed by id, or by path for id-less legacy
// chips) have been confirmed missing by an actual click — deliberately not
// a node attribute, so this never round-trips into the saved markdown: only
// a click can prove a target is gone, so reopening a file must always start
// with every chip in its normal state, not whatever was last known. A plain
// decoration keyed off live doc content (recomputed on every transaction,
// same as searchHighlight.ts) means every chip pointing at the same target
// reflects one click's result, and moving/editing the doc can't leave a
// decoration stuck on a stale position.
interface InvalidLinksState {
  invalid: Set<string>;
  decorations: DecorationSet;
}

const invalidLinksKey = new PluginKey<InvalidLinksState>("invalidLinks");

function linkKey(node: ProseMirrorNode): string | null {
  return (node.attrs.id as string | null) || (node.attrs.path as string | null);
}

function buildInvalidLinkDecorations(doc: ProseMirrorNode, invalid: Set<string>): DecorationSet {
  if (invalid.size === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "pageLink" && node.type.name !== "fileLink") return;
    const key = linkKey(node);
    if (key && invalid.has(key)) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "link-chip-invalid" }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export const LinkClickHandler = Extension.create({
  name: "linkClickHandler",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: invalidLinksKey,
        state: {
          init: (): InvalidLinksState => ({ invalid: new Set(), decorations: DecorationSet.empty }),
          apply(tr, prev): InvalidLinksState {
            const meta = tr.getMeta(invalidLinksKey) as { key: string; invalid: boolean } | undefined;
            let invalid = prev.invalid;
            if (meta) {
              invalid = new Set(invalid);
              if (meta.invalid) invalid.add(meta.key);
              else invalid.delete(meta.key);
            }
            if (meta || tr.docChanged) {
              return { invalid, decorations: buildInvalidLinkDecorations(tr.doc, invalid) };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return invalidLinksKey.getState(state)?.decorations;
          },
          handleClickOn(view, _pos, node, nodePos, event) {
            const path = node.attrs.path as string | null | undefined;
            const id = node.attrs.id as string | null | undefined;
            if (node.type.name !== "pageLink" && node.type.name !== "fileLink") return false;
            event.preventDefault();
            void (async () => {
              // Prefer the id-registry's current path over the stored one —
              // it's authoritative even if this file was closed (so never
              // patched) when the target got renamed/moved elsewhere. Falls
              // back to the stored path for chips with no id (created
              // before the registry existed) or if resolution fails.
              let targetPath = path ?? null;
              if (id) {
                try {
                  const resolved = await api.resolveLinkID(id);
                  if (resolved) {
                    if (resolved !== path) {
                      // Self-heal: fix the stored path so it renders
                      // correctly and stays correct even if this chip's id
                      // can't be resolved on some future click (e.g. the
                      // registry file got removed).
                      view.dispatch(view.state.tr.setNodeAttribute(nodePos, "path", resolved));
                    }
                    targetPath = resolved;
                  }
                } catch {
                  // Unknown/unresolvable id — fall back to the stored path.
                }
              }
              if (!targetPath) return;
              // Checked explicitly rather than just letting the open call
              // fail: a missing-target link is common enough (the file got
              // deleted or moved outside the app) to deserve its own clear
              // message instead of whatever raw error readFile/ShellExecute
              // happens to surface.
              const exists = await api.fileExists(targetPath).catch(() => true);
              // Marks every chip pointing at this same target (by id, or by
              // path once resolved above) as broken/healthy — only ever
              // written here, right after an actual click proves the
              // current state, never assumed up front.
              const key = id || targetPath;
              view.dispatch(view.state.tr.setMeta(invalidLinksKey, { key, invalid: !exists }));
              if (!exists) {
                appState.showToast(t("toast.fileNotFound"));
                return;
              }
              if (node.type.name === "pageLink") {
                void appState.openPath(targetPath);
              } else {
                api.openWithDefaultApp(targetPath).catch((e) => appState.showToast(`${t("toast.openFailed")}: ${e}`));
              }
            })();
            return true;
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
            // Right-click a plain web link (not a pageLink/fileLink chip,
            // which already has its own click behavior and isn't a "link
            // you'd edit the URL of" the same way) to edit it in place,
            // reusing the same dialog "网页链接" inserts new ones with.
            contextmenu(view, event) {
              const target = (event.target as HTMLElement | null)?.closest?.("a");
              if (!target || target.classList.contains("link-chip")) return false;
              const href = target.getAttribute("href");
              if (!href || href === "#") return false;
              const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (!coords) return false;
              const linkType = view.state.schema.marks.link;
              if (!linkType) return false;
              const $pos = view.state.doc.resolve(coords.pos);
              const range = getMarkRange($pos, linkType);
              if (!range) return false;
              event.preventDefault();
              const currentText = view.state.doc.textBetween(range.from, range.to);
              void appState.pickWebLink({ url: href, text: currentText }).then((picked) => {
                if (!picked) return;
                const tr = view.state.tr;
                if ("unlink" in picked) {
                  tr.removeMark(range.from, range.to, linkType);
                  view.dispatch(tr);
                  return;
                }
                tr.insertText(picked.title, range.from, range.to);
                const newTo = range.from + picked.title.length;
                tr.addMark(range.from, newTo, linkType.create({ href: picked.path }));
                view.dispatch(tr);
              });
              return true;
            },
          },
        },
      }),
    ];
  },
});
