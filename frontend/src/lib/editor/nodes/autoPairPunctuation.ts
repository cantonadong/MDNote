import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

// Chinese IMEs (Sogou, Microsoft Pinyin, etc.) have a "paired symbol" feature:
// typing the fullwidth open bracket "（" auto-inserts the matching "）" and
// drops the cursor between them, ready to fill in. That's driven entirely by
// the IME talking to the OS's native text-service framework, which is what
// Notepad/Word expose but a Chromium contenteditable (what this editor is
// built on, via WebView2) does not — so the IME falls back to inserting just
// the single typed character, silently dropping the feature. Reimplementing
// the same pairing ourselves at the ProseMirror transaction level sidesteps
// that: it works the same whether the character arrived via IME composition,
// a direct keystroke, or a paste, since all of those end up as an ordinary
// doc-changing transaction by the time appendTransaction sees them.
const PAIRS: Record<string, string> = {
  "（": "）",
  "“": "”",
  "‘": "’",
  "《": "》",
  "【": "】",
};
const CLOSERS = new Set(Object.values(PAIRS));

const pluginKey = new PluginKey("autoPairPunctuation");

export const AutoPairPunctuation = Extension.create({
  name: "autoPairPunctuation",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        appendTransaction(transactions, oldState, newState) {
          // Only react to plain typing: a single incoming transaction that
          // changed the doc and left a collapsed cursor — skip our own
          // follow-up edits (tagged below) and multi-char changes like paste
          // or a tab switch's setContent.
          if (transactions.length !== 1 || transactions.some((tr) => tr.getMeta(pluginKey))) return null;
          const tr = transactions[0];
          if (!tr.docChanged || !oldState.selection.empty || !newState.selection.empty) return null;

          const from = oldState.selection.from;
          const to = newState.selection.from;
          if (to !== from + 1) return null; // exactly one character inserted
          const typed = newState.doc.textBetween(from, to);

          const closer = PAIRS[typed];
          if (closer) {
            const insertTr = newState.tr.insertText(closer, to);
            insertTr.setSelection(TextSelection.create(insertTr.doc, to));
            insertTr.setMeta(pluginKey, true);
            return insertTr;
          }

          // Typing a closing symbol that's already sitting right after the
          // cursor (there because of the case above) — "type over" it
          // instead of inserting a duplicate, same as code-editor bracket
          // matching.
          if (CLOSERS.has(typed) && newState.doc.textBetween(to, Math.min(to + 1, newState.doc.content.size)) === typed) {
            const skipTr = newState.tr.delete(from, to);
            skipTr.setSelection(TextSelection.create(skipTr.doc, from + 1));
            skipTr.setMeta(pluginKey, true);
            return skipTr;
          }

          return null;
        },
      }),
    ];
  },
});
