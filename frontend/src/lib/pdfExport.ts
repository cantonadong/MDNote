import { editorBridge } from "./editor/bridge.svelte";

// Builds a standalone HTML document reproducing the current note's on-screen
// appearance, for the silent "另存为PDF" export (see api.ts's exportPdf /
// pdfexport.go). Pulls every live stylesheet's actual cssText rather than
// duplicating the editor's CSS here, so the export can never drift out of
// sync with Editor.svelte's own styling.
export function buildExportHtml(title: string): string | null {
  const editor = editorBridge.instance;
  if (!editor) return null;
  // .editor-content-col is tiptap's own mount element (the parent Editor.svelte
  // gives it) — grabbing it rather than editor.view.dom directly keeps the
  // Svelte scoped-CSS class that selectors like ".editor-content-col :global(.tiptap p)"
  // depend on, which a hand-built wrapper div wouldn't carry.
  const contentEl = editor.view.dom.closest(".editor-content-col") ?? editor.view.dom;
  const contentHtml = contentEl.outerHTML;

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
<title>${escapeHtml(title)}</title>
<style>
${css}
html, body { margin: 0; }
.pdf-export-page { max-width: 800px; margin: 0 auto; padding: 12px 0; }
</style>
</head>
<body>
<div class="pdf-export-page">${contentHtml}</div>
</body>
</html>`;
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
