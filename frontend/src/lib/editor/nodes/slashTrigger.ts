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
          handleKeyDown(view, event) {
            if (event.key === "Tab" && view.state.selection.$from.parent.type.name === "codeBlock") {
              if (event.shiftKey) {
                const { $from, $to } = view.state.selection;
                if ($to.parent !== $from.parent) return false;
                const text = $from.parent.textContent;
                const contentStart = $from.start();
                const firstLineStart = text.lastIndexOf("\n", Math.max(0, $from.parentOffset - 1)) + 1;
                const selectedEnd = Math.max($from.parentOffset, $to.parentOffset);
                const lineStarts = [firstLineStart];
                for (let i = firstLineStart; i < selectedEnd; i++) {
                  if (text[i] === "\n" && i + 1 <= selectedEnd) lineStarts.push(i + 1);
                }
                const tr = view.state.tr;
                for (const lineStart of lineStarts.reverse()) {
                  const remove = text[lineStart] === "\t"
                    ? 1
                    : text.slice(lineStart, lineStart + 2).match(/^ {1,2}/)?.[0].length ?? 0;
                  if (remove > 0) tr.delete(contentStart + lineStart, contentStart + lineStart + remove);
                }
                if (tr.docChanged) view.dispatch(tr.scrollIntoView());
                return true;
              }
              if (!view.state.selection.empty) {
                const { $from, $to } = view.state.selection;
                if ($to.parent !== $from.parent) return false;
                const text = $from.parent.textContent;
                const contentStart = $from.start();
                const firstLineStart = text.lastIndexOf("\n", Math.max(0, $from.parentOffset - 1)) + 1;
                const selectedEnd = Math.max($from.parentOffset, $to.parentOffset);
                const lineStarts = [firstLineStart];
                for (let i = firstLineStart; i < selectedEnd; i++) {
                  // A selection ending exactly at the next line's start
                  // doesn't include that line, matching common code editors.
                  if (text[i] === "\n" && i + 1 < selectedEnd) lineStarts.push(i + 1);
                }
                const tr = view.state.tr;
                for (const lineStart of lineStarts.reverse()) {
                  tr.insertText("\t", contentStart + lineStart);
                }
                view.dispatch(tr.scrollIntoView());
                return true;
              }
              view.dispatch(view.state.tr.insertText("\t"));
              return true;
            }
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

            if (event.key === "Enter" && view.state.selection.$from.parent.type.name === "codeBlock") {
              const cursor = view.state.selection.$from;
              const beforeCursor = cursor.parent.textBetween(0, cursor.parentOffset, "\n", "\n");
              const currentLine = beforeCursor.slice(beforeCursor.lastIndexOf("\n") + 1);
              const indent = currentLine.match(/^[\t ]*/)?.[0] ?? "";
              view.dispatch(view.state.tr.insertText(`\n${indent}`).scrollIntoView());
              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});
