import { editorBridge } from "./editor/bridge.svelte";

export function formatPageTimestamp(locale: "zh" | "en", date = new Date()): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-NZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

// Builds a standalone HTML document reproducing the current note's on-screen
// appearance, for the silent "另存为PDF" export (see api.ts's exportPdf /
// pdfexport.go). Pulls every live stylesheet's actual cssText rather than
// duplicating the editor's CSS here, so the export can never drift out of
// sync with Editor.svelte's own styling.
export function buildExportHtml(title: string, exportedAt: string, target: "pdf" | "html" = "pdf"): string | null {
  const editor = editorBridge.instance;
  if (!editor) return null;
  // .editor-content-col is tiptap's own mount element (the parent Editor.svelte
  // gives it) — grabbing it rather than editor.view.dom directly keeps the
  // Svelte scoped-CSS class that selectors like ".editor-content-col :global(.tiptap p)"
  // depend on, which a hand-built wrapper div wouldn't carry.
  const contentEl = editor.view.dom.closest(".editor-content-col") ?? editor.view.dom;
  const contentClone = contentEl.cloneNode(true) as HTMLElement;
  syncLiveElementState(contentEl, contentClone);
  contentClone.querySelectorAll(".ProseMirror-selectednode, .selectedCell, .search-match, .search-match-active")
    .forEach((element) => element.classList.remove("ProseMirror-selectednode", "selectedCell", "search-match", "search-match-active"));
  contentClone.querySelectorAll("[contenteditable]").forEach((element) => element.removeAttribute("contenteditable"));
  contentClone.querySelectorAll("[spellcheck]").forEach((element) => element.removeAttribute("spellcheck"));
  const contentHtml = contentClone.outerHTML;

  const css = Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join("\n");
      } catch {
        return "";
      }
    })
    .join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${css}
${buildPageChromeCss(title, exportedAt)}
${buildExportLayoutCss(target)}
</style>
</head>
<body>
<div class="pdf-export-page">${contentHtml}</div>
</body>
</html>`;
}

// cloneNode/outerHTML only serializes HTML attributes. Form controls and
// disclosure widgets keep their current state in DOM properties, so copy
// those properties back to attributes before writing the standalone file.
function syncLiveElementState(source: Element, clone: Element): void {
  const sourceControls = [source, ...source.querySelectorAll("input, textarea, select, option, details")];
  const cloneControls = [clone, ...clone.querySelectorAll("input, textarea, select, option, details")];
  sourceControls.forEach((element, index) => {
    const copy = cloneControls[index];
    if (!copy) return;
    if (element instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
      copy.toggleAttribute("checked", element.checked);
      copy.value = element.value;
      copy.setAttribute("value", element.value);
    } else if (element instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) {
      copy.textContent = element.value;
    } else if (element instanceof HTMLOptionElement && copy instanceof HTMLOptionElement) {
      copy.toggleAttribute("selected", element.selected);
    } else if (element instanceof HTMLDetailsElement && copy instanceof HTMLDetailsElement) {
      copy.toggleAttribute("open", element.open);
    }
  });
}

function buildExportLayoutCss(target: "pdf" | "html"): string {
  if (target === "html") {
    return `html, body {
  margin: 0 !important;
  width: 100% !important;
  height: auto !important;
  min-height: 100% !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  background: var(--content-bg) !important;
}
body { display: block !important; }
.pdf-export-page {
  width: 100%;
  max-width: 1000px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 56px 64px 30vh;
  overflow: visible !important;
}
.editor-content-col, .editor-content-col .tiptap {
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
}
.editor-content-col .tiptap { outline: none !important; }`;
  }
  return `html, body { margin: 0; height: auto !important; overflow: visible !important; }
.pdf-export-page { max-width: 800px; margin: 0 auto; padding: 0; }`;
}

// Keep silent PDF export and the native print preview on exactly the same
// page furniture. JSON string literals are valid CSS <string> values and
// safely quote filenames/timestamps containing punctuation.
export function buildPageChromeCss(title: string, timestamp: string): string {
  return `@page {
  margin: 18mm 12mm 16mm;
  @top-center {
    content: ${JSON.stringify(title)};
    color: #777;
    font: 10px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  @bottom-center {
    content: counter(page) "/" counter(pages);
    color: #777;
    font: 10px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  @bottom-right {
    content: ${JSON.stringify(timestamp)};
    color: #777;
    font: 10px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => escapeMap[c]);
}

const escapeMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
