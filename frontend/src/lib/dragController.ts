// WebView2 (the Windows runtime Wails embeds) has a long-standing platform
// bug where native HTML5 Drag and Drop events (dragstart/dragover/drop)
// simply never fire for in-page drags, even though the exact same markup
// works in a real browser. So the file tree's reorder/move gesture is built
// on plain pointer events instead: pointerdown starts tracking, pointermove
// (past a small threshold, so ordinary clicks aren't mistaken for drags)
// hit-tests via document.elementFromPoint, and pointerup commits the move.
import { appState, parentDir } from "./appState.svelte";

const ROW_ATTR = "data-tree-row";
const DIR_ATTR = "data-tree-dir";
const ROOT_ATTR = "data-tree-root";
const START_THRESHOLD = 4;

interface HitTarget {
  path: string;
  isDir: boolean;
  rect: DOMRect;
  isRoot: boolean;
}

function hitTest(clientX: number, clientY: number): HitTarget | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  const row = el.closest<HTMLElement>(`[${ROW_ATTR}]`);
  if (row) {
    return {
      path: row.getAttribute(ROW_ATTR)!,
      isDir: row.getAttribute(DIR_ATTR) === "true",
      rect: row.getBoundingClientRect(),
      isRoot: false,
    };
  }
  const root = el.closest<HTMLElement>(`[${ROOT_ATTR}]`);
  if (root && appState.effectiveRootDir) {
    return { path: appState.effectiveRootDir, isDir: true, rect: root.getBoundingClientRect(), isRoot: true };
  }
  return null;
}

/**
 * Begin tracking a possible drag of `path` starting from a pointerdown on its
 * tree row. No-op until the pointer actually moves past the threshold, so a
 * plain click/tap still behaves like a click. label/isDir are only used to
 * render the floating drag-ghost that follows the pointer.
 */
export function startRowDrag(path: string, isDir: boolean, label: string, startEvent: PointerEvent) {
  if (startEvent.button !== 0) return;
  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  let dragging = false;

  function onMove(ev: PointerEvent) {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < START_THRESHOLD) return;
      dragging = true;
      appState.draggingPath = path;
      appState.dragGhost = { label, isDir, x: ev.clientX, y: ev.clientY };
      // A row's own CSS cursor only applies while the pointer is over that
      // row — but the pointer spends most of a drag over other rows/blank
      // space, where nothing says "you're holding something" without this.
      document.body.style.cursor = "grabbing";
    } else if (appState.dragGhost) {
      appState.dragGhost = { ...appState.dragGhost, x: ev.clientX, y: ev.clientY };
    }
    ev.preventDefault();
    const hit = hitTest(ev.clientX, ev.clientY);
    if (!hit || hit.path === path) {
      appState.dragOverTarget = null;
      return;
    }
    let position: "before" | "after" | "inside";
    if (hit.isRoot) {
      position = "inside";
    } else if (hit.isDir) {
      // Hovering a folder always means "drop as a child of it" — there's no
      // before/after sibling zone here. There used to be thin top/bottom
      // slivers for reordering as a sibling of the folder, but landing in
      // one while dragging a deeply nested item upward toward an ancestor
      // would silently escape it out to be a sibling of that ancestor
      // instead — a surprising move nothing here is meant to offer.
      position = "inside";
    } else {
      const ratio = (ev.clientY - hit.rect.top) / hit.rect.height;
      position = ratio < 0.5 ? "before" : "after";
    }
    appState.dragOverTarget = { path: hit.path, position };
  }

  async function finish() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    document.body.style.cursor = "";
    const target = appState.dragOverTarget;
    const wasDragging = dragging;
    appState.draggingPath = null;
    appState.dragOverTarget = null;
    appState.dragGhost = null;
    if (!wasDragging || !target || target.path === path) return;
    const destDir = target.position === "inside" ? target.path : parentDir(target.path);
    if (!destDir || destDir === parentDir(path)) return;
    await appState.moveEntry(path, destDir);
    if (target.position === "inside") appState.pendingExpandPath = destDir;
  }

  function onUp(ev: PointerEvent) {
    void finish();
  }

  function onCancel() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    document.body.style.cursor = "";
    appState.draggingPath = null;
    appState.dragOverTarget = null;
    appState.dragGhost = null;
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}
