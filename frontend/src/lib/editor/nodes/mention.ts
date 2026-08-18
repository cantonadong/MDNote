import { InputRule, Mark, mergeAttributes } from "@tiptap/core";
import { type EditorState, Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const Mention = Mark.create({
  name: "mention",
  inclusive: false,

  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "mention" }), 0];
  },

  addInputRules() {
    return [
      new InputRule({
        find: /(@[^\s]+)\s$/,
        handler: ({ state, range, match }) => {
          const value = match[1];
          const from = range.from + match[0].indexOf(value);
          const to = from + value.length;
          state.tr
            .addMark(from, to, this.type.create())
            .insertText(" ", range.to)
            .removeMark(range.to, range.to + 1, this.type);
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const mentionType = this.type;

    const mentionRangeAtCursor = (state: EditorState) => {
      const { selection } = state;
      if (!(selection instanceof TextSelection) || !selection.empty) return null;
      const { $from } = selection;
      const offset = $from.parentOffset;
      let childOffset = 0;

      for (let index = 0; index < $from.parent.childCount; index += 1) {
        const child = $from.parent.child(index);
        const childEnd = childOffset + child.nodeSize;
        if (child.isText && childOffset < offset && offset < childEnd && mentionType.isInSet(child.marks)) {
          let first = index;
          let last = index;
          let fromOffset = childOffset;
          let toOffset = childEnd;

          while (first > 0 && mentionType.isInSet($from.parent.child(first - 1).marks)) {
            first -= 1;
            fromOffset -= $from.parent.child(first).nodeSize;
          }
          while (last + 1 < $from.parent.childCount && mentionType.isInSet($from.parent.child(last + 1).marks)) {
            last += 1;
            toOffset += $from.parent.child(last).nodeSize;
          }

          return { from: $from.start() + fromOffset, to: $from.start() + toOffset };
        }
        childOffset = childEnd;
      }
      return null;
    };

    return [
      new Plugin({
        props: {
          decorations(state) {
            const range = mentionRangeAtCursor(state);
            return range
              ? DecorationSet.create(state.doc, [Decoration.inline(range.from, range.to, { class: "mention-editing" })])
              : null;
          },

          handleKeyDown(view, event) {
            const { selection } = view.state;
            if (!selection.empty) return false;
            const { $from } = selection;

            if (event.key === "Backspace") {
              const before = $from.nodeBefore;
              if (before?.isText && mentionType.isInSet(before.marks)) {
                view.dispatch(view.state.tr.delete($from.pos - before.nodeSize, $from.pos));
                return true;
              }
            }

            if (event.key === "Delete") {
              const after = $from.nodeAfter;
              if (after?.isText && mentionType.isInSet(after.marks)) {
                view.dispatch(view.state.tr.delete($from.pos, $from.pos + after.nodeSize));
                return true;
              }
            }

            return false;
          },
        },

        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const range = mentionRangeAtCursor(oldState);
          if (!range) return null;

          let { from, to } = range;
          for (const transaction of transactions) {
            from = transaction.mapping.map(from, -1);
            to = transaction.mapping.map(to, 1);
          }
          if (from >= to) return null;
          return newState.tr.removeMark(from, to, mentionType);
        },
      }),
    ];
  },
});
