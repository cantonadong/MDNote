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
