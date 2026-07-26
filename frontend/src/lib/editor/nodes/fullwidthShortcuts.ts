import { Extension, textblockTypeInputRule } from "@tiptap/core";

// Chinese IMEs commonly have a fullwidth-punctuation toggle (often bound to
// Shift+Space, easy to hit by accident) that, while on, makes the "#" key
// insert "＃" (U+FF03) instead of the ASCII "#". Every markdown shortcut in
// this editor — the built-in heading input rule from @tiptap/extension-
// heading, and the "/" slash-menu trigger in Editor.svelte's
// detectSlashOpen — matches on the literal ASCII character, so a user whose
// IME happens to be in that mode sees "###" or "/" silently do nothing,
// with no indication why. This adds a second heading input rule that
// recognizes a run of the fullwidth "＃" the same way the built-in one
// recognizes "#" (mirrors extension-heading's own addInputRules — same
// {min,level} range pattern, just matched against "＃" instead of "#"); the
// "/" side of the fix lives directly in Editor.svelte's detectSlashOpen.
export const FullwidthHeadingShortcut = Extension.create({
  name: "fullwidthHeadingShortcut",
  addInputRules() {
    const headingType = this.editor.schema.nodes.heading;
    if (!headingType) return [];
    const levels = [1, 2, 3, 4, 5, 6];
    return levels.map((level) =>
      textblockTypeInputRule({
        find: new RegExp(`^(＃{1,${level}})\\s$`),
        type: headingType,
        getAttributes: { level },
      }),
    );
  },
});
