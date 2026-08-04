import { Node, mergeAttributes } from "@tiptap/core";
import { api } from "../../api";
import { t } from "../../i18n.svelte";

function isRemoteOrEmbedded(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src);
}

function imageDisplaySrc(src: string | null): string {
  if (!src) return "";
  if (isRemoteOrEmbedded(src)) return src;
  let normalized = src.replace(/\\/g, "/");
  if (/^[a-z]:\//i.test(normalized)) normalized = `/${normalized}`;
  return `file://${encodeURI(normalized)}`;
}

export const MdImage = Node.create({
  name: "mdImage",
  group: "block",
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-src") || el.getAttribute("src") || "",
        renderHTML: (attrs: { src: string }) => ({ "data-src": attrs.src || "" }),
      },
      alt: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("alt") || "",
        renderHTML: (attrs: { alt: string }) => (attrs.alt ? { alt: attrs.alt } : {}),
      },
      centered: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-centered") === "true",
        renderHTML: (attrs: { centered: boolean }) => (attrs.centered ? { "data-centered": "true" } : {}),
      },
      widthPercent: {
        default: 100,
        parseHTML: (el: HTMLElement) => Number.parseFloat(el.getAttribute("data-width-percent") || "100") || 100,
        renderHTML: (attrs: { widthPercent: number }) =>
          attrs.widthPercent && attrs.widthPercent !== 100 ? { "data-width-percent": String(attrs.widthPercent) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-type="mdnote-image"]' }, { tag: "img[src]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const src = node.attrs.src as string;
    return [
      "figure",
      mergeAttributes(HTMLAttributes, {
        "data-type": "mdnote-image",
        class: "mdnote-image",
      }),
      [
        "span",
        {
          class: "mdnote-image-frame",
          style: node.attrs.widthPercent && node.attrs.widthPercent !== 100 ? `width:${node.attrs.widthPercent}%` : null,
        },
        ["img", { src: imageDisplaySrc(src), alt: node.attrs.alt || "" }],
        ["figcaption", { "data-role": "missing" }, t("image.invalid")],
      ],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const figure = document.createElement("figure");
      const rawSrc = String(node.attrs.src || "");
      figure.setAttribute("data-type", "mdnote-image");
      figure.className = "mdnote-image";
      figure.setAttribute("data-src", rawSrc);
      figure.draggable = false;
      if (node.attrs.centered) figure.setAttribute("data-centered", "true");

      const frame = document.createElement("span");
      frame.className = "mdnote-image-frame";
      const img = document.createElement("img");
      img.alt = node.attrs.alt || "";
      img.draggable = false;
      img.src = imageDisplaySrc(rawSrc);

      const missing = document.createElement("figcaption");
      missing.setAttribute("data-role", "missing");
      missing.textContent = t("image.invalid");
      const leftHandle = document.createElement("span");
      leftHandle.className = "image-resize-handle image-resize-left";
      leftHandle.setAttribute("data-side", "left");
      leftHandle.draggable = false;
      const rightHandle = document.createElement("span");
      rightHandle.className = "image-resize-handle image-resize-right";
      rightHandle.setAttribute("data-side", "right");
      rightHandle.draggable = false;

      function preventResizeHandleEvent(event: Event) {
        if ((event.target as HTMLElement | null)?.closest?.(".image-resize-handle")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
      for (const eventName of ["dragstart", "click"]) {
        figure.addEventListener(eventName, preventResizeHandleEvent, true);
      }

      function applyAttrs(nextNode = node) {
        const widthPercent = Number(nextNode.attrs.widthPercent) || 100;
        figure.toggleAttribute("data-centered", !!nextNode.attrs.centered);
        if (widthPercent !== 100) {
          figure.setAttribute("data-width-percent", String(widthPercent));
          frame.style.width = `${widthPercent}%`;
        } else {
          figure.removeAttribute("data-width-percent");
          frame.style.width = "";
        }
      }
      applyAttrs();

      img.addEventListener("load", () => {
        figure.removeAttribute("data-invalid");
      });
      img.addEventListener("error", () => {
        figure.setAttribute("data-invalid", "true");
      });

      frame.append(leftHandle, img, missing, rightHandle);
      figure.append(frame);
      if (rawSrc && !isRemoteOrEmbedded(rawSrc)) {
        api
          .imageDataURL(rawSrc)
          .then((dataURL) => {
            img.src = dataURL;
          })
          .catch(() => {
            figure.setAttribute("data-invalid", "true");
          });
      }
      return {
        dom: figure,
        stopEvent(event) {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.(".image-resize-handle")) return true;
          return event.type === "dragstart" && !!target?.closest?.(".mdnote-image");
        },
        update(nextNode) {
          if (nextNode.type.name !== "mdImage") return false;
          applyAttrs(nextNode);
          return true;
        },
      };
    };
  },
});
