import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface SearchMatch {
  from: number;
  to: number;
}

export interface SearchState {
  query: string;
  matches: SearchMatch[];
  activeIndex: number;
}

export const searchPluginKey = new PluginKey<SearchState>("search");

export function findMatches(doc: ProseMirrorNode, query: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  if (!query) return matches;
  const lowerQuery = query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let idx = 0;
    while (true) {
      const found = text.indexOf(lowerQuery, idx);
      if (found === -1) break;
      matches.push({ from: pos + found, to: pos + found + query.length });
      idx = found + query.length;
    }
  });
  return matches;
}

export const SearchHighlight = Extension.create({
  name: "searchHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchPluginKey,
        state: {
          init(): SearchState {
            return { query: "", matches: [], activeIndex: -1 };
          },
          apply(tr, prev): SearchState {
            const meta = tr.getMeta(searchPluginKey) as Partial<SearchState> | undefined;
            let next = prev;
            if (meta) {
              next = { ...next, ...meta };
            }
            if (tr.docChanged || meta?.query !== undefined) {
              const matches = findMatches(tr.doc, next.query);
              next = {
                ...next,
                matches,
                activeIndex: matches.length ? Math.min(Math.max(next.activeIndex, 0), matches.length - 1) : -1,
              };
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            const s = searchPluginKey.getState(state);
            if (!s || s.matches.length === 0) return DecorationSet.empty;
            const decos = s.matches.map((m, i) =>
              Decoration.inline(m.from, m.to, {
                class: i === s.activeIndex ? "search-match search-match-active" : "search-match",
              }),
            );
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
