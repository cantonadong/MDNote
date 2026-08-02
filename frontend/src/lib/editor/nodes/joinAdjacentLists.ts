import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { canJoin } from "@tiptap/pm/transform";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// @tiptap/extension-list's Backspace handling (see handleBackspace.ts)
// deliberately lifts a list item out of its list — for a top-level item,
// that splits the wrapping list in two around it, and the two halves never
// get merged back into one node even after the empty item between them is
// deleted. Two separate bulletList/orderedList nodes of the same type
// sitting next to each other look identical for a bulletList, but for an
// orderedList the second one is a brand-new node that always starts
// counting at 1 — e.g. deleting item 4 out of a 1..5 list leaves item 5
// rendered as "1." instead of continuing as "4.". This plugin re-joins any
// such adjacent same-type list pair after every doc-changing transaction.
// Written as a manual recursive walk (not Node.descendants, which never
// invokes its callback for the root doc node itself) since the boundary we
// care about most — two top-level lists directly under doc — has to be
// checked at the root, not just at deeper descendants.
function findJoinablePos(root: ProseMirrorNode): number | null {
  let found: number | null = null;
  function scan(node: ProseMirrorNode, contentStart: number) {
    if (found !== null) return;
    let prev: ProseMirrorNode | null = null;
    node.forEach((child, offset) => {
      if (found !== null) return;
      if (
        prev &&
        child.type === prev.type &&
        (child.type.name === "orderedList" || child.type.name === "bulletList")
      ) {
        found = contentStart + offset;
        return;
      }
      scan(child, contentStart + offset + 1);
      prev = child;
    });
  }
  scan(root, 0);
  return found;
}

export const JoinAdjacentLists = Extension.create({
  name: "joinAdjacentLists",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const tr = newState.tr;
          let changed = false;
          // Each join can put a new joinable boundary next to another list
          // (e.g. three lists collapsing into one), so keep scanning the
          // transaction's own doc-in-progress until nothing more merges.
          for (;;) {
            const pos = findJoinablePos(tr.doc);
            if (pos === null || !canJoin(tr.doc, pos)) break;
            tr.join(pos);
            changed = true;
          }
          return changed ? tr : null;
        },
      }),
    ];
  },
});
