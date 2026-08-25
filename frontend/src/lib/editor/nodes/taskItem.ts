import { TaskItem as BaseTaskItem } from "@tiptap/extension-task-item";

// Tiptap's stock task-item view relies on the browser's native checkbox
// activation after preventing mousedown. WebView2 can suppress that activation,
// leaving the checkbox inert. Own the click here and update the node through
// getPos(), which is the authoritative position supplied by ProseMirror.
export const TaskItem = BaseTaskItem.extend({
  addNodeView() {
    return ({ node, getPos, editor, HTMLAttributes }) => {
      const listItem = document.createElement("li");
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      const styler = document.createElement("span");
      const content = document.createElement("div");

      listItem.dataset.type = "taskItem";
      label.contentEditable = "false";
      checkbox.type = "checkbox";
      label.append(checkbox, styler);
      listItem.append(label, content);

      for (const [key, value] of Object.entries(HTMLAttributes)) {
        if (value !== null && value !== undefined) listItem.setAttribute(key, String(value));
      }

      const render = () => {
        const checked = Boolean(node.attrs.checked);
        listItem.dataset.checked = String(checked);
        checkbox.checked = checked;
        checkbox.ariaLabel = `Task item checkbox for ${node.textContent || "empty task item"}`;
      };

      const toggleChecked = () => {
        if (!editor.isEditable) return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        const currentNode = editor.state.doc.nodeAt(pos);
        if (!currentNode || currentNode.type.name !== "taskItem") return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            checked: !currentNode.attrs.checked,
          }),
        );
      };

      // Toggle on pointerdown itself. In WebView2, preventing mousedown inside
      // contenteditable can suppress the later native click/change entirely.
      checkbox.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        toggleChecked();
      });
      checkbox.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      render();
      return {
        dom: listItem,
        contentDOM: content,
        update(updatedNode) {
          if (updatedNode.type.name !== "taskItem") return false;
          node = updatedNode;
          render();
          return true;
        },
        stopEvent(event) {
          return event.target === checkbox;
        },
      };
    };
  },
});
