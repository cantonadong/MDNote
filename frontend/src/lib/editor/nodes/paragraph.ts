import { Paragraph as BaseParagraph } from "@tiptap/extension-paragraph";
import type { Node as PMNode } from "@tiptap/pm/model";

interface MarkdownState {
  write(text: string): void;
  closeBlock(node: PMNode): void;
  renderInline(node: PMNode): void;
}

// Markdown treats any number of blank separator lines as equivalent, so a
// genuinely empty editor paragraph would otherwise disappear on the next
// save/load round trip. Encode only top-level empty paragraphs as harmless
// HTML blocks; markdown-it passes them back to ProseMirror as real empty
// paragraphs while ordinary non-empty paragraphs stay clean Markdown.
export const Paragraph = BaseParagraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNode, parent: PMNode) {
          if (parent.type.name === "doc" && node.content.size === 0) {
            state.write('<p data-mdnote-empty="true"></p>');
            state.closeBlock(node);
            return;
          }

          state.renderInline(node);
          state.closeBlock(node);
        },
        parse: {
          // Raw HTML is handled by markdown-it and the paragraph DOM parser.
        },
      },
    };
  },
});
