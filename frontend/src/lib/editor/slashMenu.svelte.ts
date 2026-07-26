// Shared state between the ProseMirror-level trigger plugin (nodes/slashTrigger.ts,
// which intercepts space/"/" keydowns and arrow/Enter/Escape navigation) and the
// Svelte popup that renders the filtered menu (Editor.svelte). Living outside any
// component (like editorBridge.svelte.ts) is what lets a plain Tiptap Extension
// read and mutate it directly.
class SlashMenuState {
  open = $state(false);
  query = $state("");
  from = $state(0); // doc position right after the trigger ("/": after the slash; space: at the empty block)
  highlight = $state(0);
  itemCount = $state(0); // kept in sync by Editor.svelte so ArrowUp/Down can wrap correctly
  onSelect: (() => void) | null = null;

  openAt(from: number) {
    this.open = true;
    this.from = from;
    this.query = "";
    this.highlight = 0;
  }

  close() {
    this.open = false;
    this.query = "";
  }

  move(delta: number) {
    if (this.itemCount <= 0) return;
    this.highlight = (this.highlight + delta + this.itemCount) % this.itemCount;
  }
}

export const slashMenuState = new SlashMenuState();
