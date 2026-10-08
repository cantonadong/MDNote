import type { Fragment, Node as PMNode } from "@tiptap/pm/model";

function leafText(node: PMNode): string {
  return node.type.name === "hardBreak" ? "\n" : node.type.spec.leafText?.(node) ?? "";
}

// Containers such as lists do not introduce additional blank lines. Tables
// remain TSV even when the copied slice also contains surrounding prose.
export function clipboardText(content: Fragment): string {
  const blocks: string[] = [];
  content.forEach((node) => {
    if (node.type.name === "table") {
      const rows: string[] = [];
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => {
          cells.push(clipboardText(cell.content).replace(/\r?\n|\t/g, " ").trim());
        });
        rows.push(cells.join("\t"));
      });
      blocks.push(rows.join("\r\n"));
    } else if (node.isTextblock) {
      blocks.push(node.content.textBetween(0, node.content.size, "\n", leafText));
    } else if (node.isLeaf) {
      blocks.push(node.isText ? node.text ?? "" : leafText(node));
    } else {
      blocks.push(clipboardText(node.content));
    }
  });
  return blocks.join("\n");
}
