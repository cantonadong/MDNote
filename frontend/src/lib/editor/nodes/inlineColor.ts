import { Mark, mergeAttributes } from "@tiptap/core";

export const TextColor = Mark.create({
  name: "textColor",

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.style.color || null,
        renderHTML: (attributes) => (attributes.color ? { style: `color: ${attributes.color}` } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        style: "color",
        getAttrs: (value) => (typeof value === "string" && value ? { color: value } : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

export const UnderlineColor = Mark.create({
  name: "underlineColor",
  priority: 1000,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.style.textDecorationColor || null,
        renderHTML: (attributes) =>
          attributes.color
            ? {
                "data-underline-color": "",
                style: `--mdnote-underline-color: ${attributes.color}; text-decoration-color: ${attributes.color}; text-underline-offset: 2px`,
              }
            : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        style: "text-decoration-color",
        getAttrs: (value) => (typeof value === "string" && value ? { color: value } : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});
