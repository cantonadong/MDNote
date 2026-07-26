import type { Editor } from "@tiptap/core";

export interface OutlineItem {
  level: number;
  text: string;
  pos: number;
}

export function buildOutline(editor: Editor): OutlineItem[] {
  const items: OutlineItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      items.push({ level: node.attrs.level as number, text: node.textContent, pos });
    }
    return true;
  });
  return items;
}

// One counter per heading level (index 0 = level 1); a shallower/equal
// heading resets every counter deeper than it, a heading that skips a level
// (h1 straight to h3) just leaves the skipped level's counter untouched
// rather than needing it to exist first.
export function numberOutline(items: OutlineItem[]): string[] {
  const counters: number[] = [];
  return items.map((item) => {
    const idx = item.level - 1;
    // .push (not .length = N) so newly-reached deeper levels get a real 0,
    // not a sparse-array hole that .join would render as an empty segment.
    while (counters.length <= idx) counters.push(0);
    counters.length = idx + 1;
    counters[idx] += 1;
    return counters.map((c) => c || 1).join(".");
  });
}
