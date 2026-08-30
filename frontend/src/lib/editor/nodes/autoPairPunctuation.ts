import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

const PAIRS: Readonly<Record<string, string>> = {
  "（": "）",
  "“": "”",
  "‘": "’",
  "《": "》",
  "【": "】",
};

const pluginKey = new PluginKey("autoPairPunctuation");

type PairMeta = {
  kind: "paired";
  opener: string;
  closer: string;
  gap: number;
  createdAt: number;
};

// Pair punctuation before Chromium mutates the contenteditable DOM. This is
// deliberately a beforeinput handler rather than an appendTransaction hook:
// Sogou can keep an IME composition alive and later rewrite its composition
// range. If ProseMirror first accepts that DOM change and only then appends a
// closer, the delayed rewrite lands inside our pair and produces "（（）".
export const AutoPairPunctuation = Extension.create({
  name: "autoPairPunctuation",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: () => null as PairMeta | null,
          apply(tr, pending: PairMeta | null) {
            const meta = tr.getMeta(pluginKey) as PairMeta | undefined;
            if (meta?.kind === "paired") return meta;
            // Keep the marker through selection-only activity, but a real
            // document edit consumes it. appendTransaction still receives
            // the previous marker as oldState when examining that edit.
            return tr.docChanged ? null : pending;
          },
        },
        props: {
          handleDOMEvents: {
            beforeinput(view, rawEvent) {
              const event = rawEvent as InputEvent;
              if (
                !event.cancelable ||
                (event.inputType !== "insertText" &&
                  event.inputType !== "insertCompositionText" &&
                  event.inputType !== "insertReplacementText")
              ) return false;

              const typed = event.data ?? "";
              const opener = typed[0];
              const closer = PAIRS[opener];
              // Some IMEs report only the opener, while others expose the
              // complete native pair as event.data. Do not take over paste,
              // drop, or arbitrary multi-character composition updates.
              if (!closer || (typed !== opener && typed !== opener + closer)) return false;

              const { from, to } = view.state.selection;
              const tr = view.state.tr.insertText(opener + closer, from, to);
              tr.setSelection(TextSelection.create(tr.doc, from + opener.length));
              tr.setMeta(pluginKey, {
                kind: "paired",
                opener,
                closer,
                gap: from + opener.length,
                createdAt: Date.now(),
              } satisfies PairMeta);

              // Prevent the IME's composition text from entering the DOM at
              // all, leaving ProseMirror as the sole owner of this edit.
              event.preventDefault();
              view.dispatch(tr.scrollIntoView());
              return true;
            },
          },
        },
        appendTransaction(transactions, oldState, newState) {
          if (transactions.some((tr) => tr.getMeta(pluginKey))) return null;
          if (transactions.length !== 1 || !transactions[0].docChanged) return null;
          if (!oldState.selection.empty || !newState.selection.empty) return null;

          const from = oldState.selection.from;
          const to = newState.selection.from;
          if (to !== from + 1) return null;
          const typed = newState.doc.textBetween(from, to);
          const closer = PAIRS[typed];
          if (!closer) return null;

          // A non-cancelable Sogou composition can land a delayed duplicate
          // opener in the gap after we already made the pair. Remove that
          // composition update instead of turning "（）" into "（（）".
          const pending = pluginKey.getState(oldState) as PairMeta | null;
          if (
            pending &&
            Date.now() - pending.createdAt < 5000 &&
            pending.gap === from &&
            pending.opener === typed &&
            pending.closer === closer
          ) {
            const tr = newState.tr.delete(from, to);
            tr.setSelection(TextSelection.create(tr.doc, from));
            return tr;
          }

          // Fallback for IME beforeinput events which Chromium marks as
          // non-cancelable: accept the opener, then add the closer in the
          // ProseMirror transaction layer.
          const tr = newState.tr.insertText(closer, to);
          tr.setSelection(TextSelection.create(tr.doc, to));
          tr.setMeta(pluginKey, {
            kind: "paired",
            opener: typed,
            closer,
            gap: to,
            createdAt: Date.now(),
          } satisfies PairMeta);
          return tr;
        },
      }),
    ];
  },
});
