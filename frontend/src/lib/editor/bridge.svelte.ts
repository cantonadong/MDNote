import type { Editor } from "@tiptap/core";

// Lets Outline / FindReplace / Toolbar reach the live Tiptap instance that
// Editor.svelte owns, without prop-drilling through +page.svelte.
class EditorBridge {
  instance = $state<Editor | null>(null);
  canUndo = $state(false);
  canRedo = $state(false);
  // Set by Editor.svelte (it owns the scroll container the outline doesn't
  // have direct access to) — jumps to a document position with a bounded
  // slide-into-view animation instead of ProseMirror's instant
  // scrollIntoView() or an unbounded smooth-scroll across the whole gap.
  scrollToPos: ((pos: number) => void) | null = null;
  // Same bounded slide-into-view, but for a [from, to) range (a find/replace
  // match) instead of a single point — and without moving the real
  // selection/focus, since FindReplace.svelte wants the caller's focus to
  // stay in its own input fields.
  scrollToRange: ((from: number, to: number) => void) | null = null;
  // Mirrors Editor.svelte's Ctrl+wheel zoom level, for StatusBar's
  // percentage readout/reset button — kept in sync via an $effect in
  // Editor.svelte rather than owned here, since the wheel handler and the
  // zoomed DOM element both live there.
  zoom = $state(100);
  resetZoom: (() => void) | null = null;
  insertImagesFromPaths: ((paths: string[], coords?: { x: number; y: number }) => void) | null = null;
}

export const editorBridge = new EditorBridge();
