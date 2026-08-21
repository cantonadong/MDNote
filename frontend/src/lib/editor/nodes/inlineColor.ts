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
  // Keep this wrapper outside underline-style marks so its CSS custom
  // property is inherited by wavy and dotted decorations.
  priority: 1200,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.style.textDecorationColor || null,
        renderHTML: (attributes) =>
          attributes.color
            ? {
                "data-underline-color": attributes.color,
                style: `--mdnote-underline-color: ${attributes.color}; text-decoration-color: ${attributes.color}; text-underline-offset: 2px`,
              }
            : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-underline-color]",
        getAttrs: (element) => {
          const color = (element as HTMLElement).getAttribute("data-underline-color")
            || (element as HTMLElement).style.textDecorationColor;
          return color ? { color } : false;
        },
      },
      {
        style: "text-decoration-color",
        getAttrs: (value) =>
          typeof value === "string" && value && !value.startsWith("var(") ? { color: value } : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});
