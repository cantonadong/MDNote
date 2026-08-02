import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type nspell from "nspell";
import { getSpeller, peekSpeller, isCustomDictionaryWord } from "./grammar/spellCheck";
import { COMMON_CORRECTIONS } from "./grammar/commonCorrections";

interface GrammarCheckState {
  enabled: boolean;
  decorations: DecorationSet;
}

export const grammarCheckKey = new PluginKey<GrammarCheckState>("grammarCheck");
const autocorrectKey = new PluginKey("grammarAutocorrect");

const WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)*/g;

// Frequent contractions the vendored dictionary doesn't reliably recognize as
// a single token (it knows a word's own affix forms, not every contraction
// built from it) — skipped outright rather than flagged, since they're
// correct far more often than not and a squiggly under "it's" on every other
// line would be pure noise.
const CONTRACTION_ALLOWLIST = new Set([
  "it's",
  "that's",
  "there's",
  "here's",
  "what's",
  "who's",
  "how's",
  "where's",
  "when's",
  "let's",
  "i'm",
  "i've",
  "i'll",
  "i'd",
  "he's",
  "she's",
  "we're",
  "we've",
  "we'll",
  "we'd",
  "you're",
  "you've",
  "you'll",
  "you'd",
  "they're",
  "they've",
  "they'll",
  "they'd",
]);

function isCodeContext(parent: ProseMirrorNode | null, node: ProseMirrorNode): boolean {
  if (parent?.type.name === "codeBlock") return true;
  return node.marks.some((m) => m.type.name === "code");
}

function isMisspelled(speller: nspell, word: string): boolean {
  if (word.length < 2) return false;
  if (isCustomDictionaryWord(word)) return false;
  const lower = word.toLowerCase();
  if (CONTRACTION_ALLOWLIST.has(lower)) return false;
  if (COMMON_CORRECTIONS[lower]) return true;
  if (/^[A-Z]+$/.test(word)) return false; // acronym, e.g. "API"
  return !speller.correct(word) && !speller.correct(lower);
}

// Scans every text run for misspelled/unrecognized words and exact
// word-word repeats ("the the"), producing one inline decoration per hit.
// Rebuilt from scratch on every doc change, same as searchHighlight.ts/
// links.ts's invalidLinksKey — the document sizes this app handles don't
// warrant incremental diffing.
function buildDecorations(doc: ProseMirrorNode, enabled: boolean, speller: nspell | null): DecorationSet {
  if (!enabled || !speller) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return;
    if (isCodeContext(parent, node)) return;
    const text = node.text;
    let prevWord: string | null = null;
    let prevEndInText = 0; // text-relative, unlike `to` below (an absolute doc pos)
    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(text))) {
      const word = m[0];
      const from = pos + m.index;
      const to = from + word.length;
      const gap = text.slice(prevEndInText, m.index);
      if (prevWord && prevWord.toLowerCase() === word.toLowerCase() && /^\s+$/.test(gap)) {
        decos.push(Decoration.inline(from, to, { class: "grammar-error" }));
      } else if (isMisspelled(speller, word)) {
        decos.push(Decoration.inline(from, to, { class: "grammar-error" }));
      }
      prevWord = word;
      prevEndInText = m.index + word.length;
    }
  });
  return DecorationSet.create(doc, decos);
}

function applyCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && original !== original.toLowerCase()) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// React only to a single plain character insertion, ignore our own tagged
// follow-up edits. Fires once the
// user finishes a word and presses space — collapses an exact repeated word
// ("the the ") or, failing that, rewrites a known typo via
// COMMON_CORRECTIONS (never a raw dictionary suggestion — see that file for
// why only this curated, unambiguous set is safe to rewrite silently).
function autocorrectPlugin(): Plugin {
  return new Plugin({
    key: autocorrectKey,
    appendTransaction(transactions, oldState, newState) {
      if (transactions.length !== 1 || transactions.some((tr) => tr.getMeta(autocorrectKey))) return null;
      const tr = transactions[0];
      if (!tr.docChanged || !oldState.selection.empty || !newState.selection.empty) return null;
      if (!grammarCheckKey.getState(oldState)?.enabled) return null;

      const from = oldState.selection.from;
      const to = newState.selection.from;
      if (to !== from + 1 || newState.doc.textBetween(from, to) !== " ") return null;

      const $to = newState.doc.resolve(to);
      if ($to.parent.type.name === "codeBlock" || $to.marks().some((mk) => mk.type.name === "code")) return null;

      // leafText "￼" keeps this string's indices aligned with
      // parentOffset's position-space even when the paragraph contains an
      // inline atom (a pageLink/fileLink chip) before the cursor — without
      // it, textBetween silently omits atoms entirely while parentOffset
      // still counts each as one unit, shifting every index after it.
      const blockText = $to.parent.textBetween(0, $to.parentOffset, undefined, "￼"); // ends with the space just typed
      const blockStart = to - $to.parentOffset;

      const curMatch = /([A-Za-z]+(?:'[A-Za-z]+)*) $/.exec(blockText);
      if (!curMatch) return null;
      const curWord = curMatch[1];
      const curFrom = blockStart + curMatch.index;
      const curTo = curFrom + curWord.length;

      const beforeCur = blockText.slice(0, curMatch.index);
      const prevMatch = /([A-Za-z]+(?:'[A-Za-z]+)*)\s$/.exec(beforeCur);
      if (prevMatch && prevMatch[1].toLowerCase() === curWord.toLowerCase()) {
        const dupFrom = blockStart + prevMatch.index;
        const delTr = newState.tr.delete(dupFrom, curFrom);
        delTr.setMeta(autocorrectKey, true);
        return delTr;
      }

      const correction = COMMON_CORRECTIONS[curWord.toLowerCase()];
      if (!correction) return null;
      const replacement = applyCase(curWord, correction);
      if (replacement === curWord) return null;
      const fixTr = newState.tr.insertText(replacement, curFrom, curTo);
      fixTr.setMeta(autocorrectKey, true);
      return fixTr;
    },
  });
}

export const GrammarCheck = Extension.create({
  name: "grammarCheck",
  addProseMirrorPlugins() {
    return [
      new Plugin<GrammarCheckState>({
        key: grammarCheckKey,
        state: {
          init: (): GrammarCheckState => ({ enabled: false, decorations: DecorationSet.empty }),
          apply(tr, prev): GrammarCheckState {
            const meta = tr.getMeta(grammarCheckKey) as { enabled?: boolean; recompute?: boolean } | undefined;
            const enabled = meta?.enabled !== undefined ? meta.enabled : prev.enabled;
            if (meta?.enabled !== undefined || meta?.recompute || tr.docChanged) {
              return { enabled, decorations: buildDecorations(tr.doc, enabled, peekSpeller()) };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return grammarCheckKey.getState(state)?.decorations;
          },
        },
      }),
      autocorrectPlugin(),
    ];
  },
});

// Called from Editor.svelte whenever the settings toggle changes. The
// dictionary loads lazily and asynchronously (see spellCheck.ts) — once it
// resolves, a second "recompute" dispatch forces the decorations to actually
// reflect it, since simply having the promise resolve doesn't itself trigger
// a ProseMirror state update.
export function setGrammarCheckEnabled(view: EditorView, enabled: boolean) {
  view.dispatch(view.state.tr.setMeta(grammarCheckKey, { enabled }));
  if (enabled) {
    void getSpeller().then(() => {
      if (!view.isDestroyed) {
        view.dispatch(view.state.tr.setMeta(grammarCheckKey, { enabled: true, recompute: true }));
      }
    });
  }
}

// Called after the custom dictionary changes (see spellCheck.ts's
// addCustomDictionaryWord) so the just-added word's squiggly disappears
// immediately instead of waiting for the next doc edit to rebuild
// decorations.
export function recomputeGrammarDecorations(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(grammarCheckKey, { recompute: true }));
}
