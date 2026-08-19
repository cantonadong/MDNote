import { Mark, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

export const Mention = Mark.create({
  name: "mention",
  inclusive: false,

  addAttributes() {
    return {
      token: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-mention-token"),
        renderHTML: (attributes) => attributes.token ? { "data-mention-token": attributes.token } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "mention" }), 0];
  },

  addProseMirrorPlugins() {
    const mentionType = this.type;
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const tr = newState.tr;

          newState.doc.descendants((block, blockPos) => {
            if (!block.isTextblock) return;
            let activeToken: string | null = null;

            block.descendants((child, childPos) => {
              if (!child.isText || !child.text) {
                // Inline atoms are a real content boundary. Nested blocks
                // are normalized by their own outer traversal callback.
                if (child.isInline) activeToken = null;
                return;
              }

              const existingToken = (mentionType.isInSet(child.marks)?.attrs.token as string | null) ?? null;
              let runStart = 0;
              let runWanted: string | null | undefined;
              const flush = (end: number) => {
                if (runWanted === undefined || runWanted === existingToken || runStart === end) return;
                const from = blockPos + 1 + childPos + runStart;
                const to = blockPos + 1 + childPos + end;
                if (runWanted) tr.addMark(from, to, mentionType.create({ token: runWanted }));
                else tr.removeMark(from, to, mentionType);
              };

              for (let index = 0; index < child.text.length; index += 1) {
                const character = child.text[index];
                let wanted: string | null;
                if (character === "@") {
                  // Each @ starts a distinct token, so adjacent @张@李
                  // remains two labels even without an intervening space.
                  activeToken = `mention-${blockPos + 1 + childPos + index}`;
                  wanted = activeToken;
                } else if (character === " ") {
                  wanted = null;
                  activeToken = null;
                } else {
                  wanted = activeToken;
                }
                if (runWanted === undefined) runWanted = wanted;
                else if (wanted !== runWanted) {
                  flush(index);
                  runStart = index;
                  runWanted = wanted;
                }
              }
              flush(child.text.length);
            });
            return false;
          });

          return tr.steps.length ? tr : null;
        },
      }),
    ];
  },
});
