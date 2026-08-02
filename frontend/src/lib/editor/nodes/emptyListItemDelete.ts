import { Extension } from "@tiptap/core";

function deleteEmptyListItem(editor: any): boolean {
  const { state, view } = editor;
  const { selection } = state;
  if (!selection.empty) return false;

  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const item = $from.node(depth);
    if (item.type.name !== "listItem" && item.type.name !== "taskItem") continue;
    if (item.textContent.length > 0) return false;

    const parentDepth = depth - 1;
    const parent = $from.node(parentDepth);
    const itemFrom = $from.before(depth);
    const itemTo = itemFrom + item.nodeSize;

    if (
      parent.childCount === 1 &&
      (parent.type.name === "bulletList" || parent.type.name === "orderedList" || parent.type.name === "taskList")
    ) {
      view.dispatch(state.tr.delete($from.before(parentDepth), $from.after(parentDepth)).scrollIntoView());
    } else {
      view.dispatch(state.tr.delete(itemFrom, itemTo).scrollIntoView());
    }
    return true;
  }

  return false;
}

export const EmptyListItemDelete = Extension.create({
  name: "emptyListItemDelete",
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Backspace: () => deleteEmptyListItem(this.editor),
      Delete: () => deleteEmptyListItem(this.editor),
    };
  },
});
