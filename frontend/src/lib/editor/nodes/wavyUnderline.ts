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
        style: "text-decoration-line: underline; text-decoration-style: wavy; text-decoration-color: var(--mdnote-underline-color, currentColor);",
      }),
      0,
    ];
  },
});

export const DotUnderline = Mark.create({
  name: "dotUnderline",
  parseHTML() {
    return [{ tag: "span[data-dot-underline]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-dot-underline": "",
        style:
          "text-emphasis: none; -webkit-text-emphasis: none; background-image: radial-gradient(circle, var(--mdnote-underline-color, currentColor) 1.15px, transparent 1.3px); background-repeat: repeat-x; background-size: 7px 4px; background-position: left calc(100% - 0.02em); padding-bottom: 0.18em; box-decoration-break: clone; -webkit-box-decoration-break: clone;",
      }),
      0,
    ];
  },
});
