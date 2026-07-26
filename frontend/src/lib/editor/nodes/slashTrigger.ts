import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { slashMenuState } from "../slashMenu.svelte";

// Registered *before* StarterKit in Editor.svelte's extensions list so this
// plugin's handleKeyDown runs first: ProseMirror walks plugins in order and
// stops at the first one that returns true, which is what lets us swallow
// Enter/ArrowUp/ArrowDown/Escape while the slash menu is open instead of
// also letting StarterKit split a paragraph or move the cursor.
export const SlashTrigger = Extension.create({
  name: "slashTrigger",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("slashTrigger"),
        props: {
          handleKeyDown(_view, event) {
            if (slashMenuState.open) {
              if (event.key === "ArrowDown") {
                slashMenuState.move(1);
                return true;
              }
              if (event.key === "ArrowUp") {
                slashMenuState.move(-1);
                return true;
              }
              if (event.key === "Enter") {
                slashMenuState.onSelect?.();
                return true;
              }
              if (event.key === "Escape") {
                slashMenuState.close();
                return true;
              }
            }

            return false;
          },
        },
      }),
    ];
  },
});
