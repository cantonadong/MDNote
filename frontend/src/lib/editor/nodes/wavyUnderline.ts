import { Mark, mergeAttributes } from "@tiptap/core";

// A second underline style distinct from the standard Underline mark
// (StarterKit), toggled from the selection toolbar. No markdown syntax
// covers this, so — same as Callout/ToggleList — it relies on
// tiptap-markdown's raw-HTML fallback serializer/parser for its round trip.
export const WavyUnderline = Mark.create({
  name: "wavyUnderline",
  parseHTML() {
    return [{ tag: "u[data-wavy]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "u",
      mergeAttributes(HTMLAttributes, {
        "data-wavy": "",
        style: "text-decoration-line: underline; text-decoration-style: wavy;",
      }),
      0,
    ];
  },
});
