// English hunspell dictionary data (en.aff/en.dic) vendored from the
// `dictionary-en` npm package (wooorm/dictionaries, MIT AND BSD — see
// en-dictionary-LICENSE.txt) rather than imported from the package itself:
// its own entry point reads the files via node:fs, which doesn't exist in
// this Vite-bundled browser build, and its package.json `exports` field
// blocks importing the raw .aff/.dic subpaths directly.
import affData from "./en.aff?raw";
import dicData from "./en.dic?raw";
import nspell from "nspell";

let speller: nspell | null = null;
let loadPromise: Promise<nspell> | null = null;

// Building the ~550KB dictionary is a one-time, non-trivial parse — done
// lazily (only once grammar check is actually switched on) rather than at
// module load, so the cost is never paid by users who leave the feature off
// (default).
export function getSpeller(): Promise<nspell> {
  if (speller) return Promise.resolve(speller);
  if (!loadPromise) {
    loadPromise = new Promise((resolve) => {
      setTimeout(() => {
        speller = nspell(affData, dicData);
        resolve(speller);
      }, 0);
    });
  }
  return loadPromise;
}

// Synchronous peek for the decoration builder, which runs on every
// transaction and can't await — returns null until getSpeller()'s promise
// has actually resolved once.
export function peekSpeller(): nspell | null {
  return speller;
}

// User-added "always correct" words, from the grammar-error word's right-
// click "add to dictionary". Matched case-sensitively/exactly (a Set of the
// literal spellings added, not lowercased) per the feature request — adding
// "Foo" doesn't silently also allow "foo"/"FOO".
let customDictionary = new Set<string>();

// Called once at editor mount with whatever Settings.CustomDictionary was
// loaded from config.ini, so words added in a previous session are honored
// immediately without waiting for another "add to dictionary" click.
export function setCustomDictionary(words: string[]): void {
  customDictionary = new Set(words);
}

export function addCustomDictionaryWord(word: string): void {
  customDictionary.add(word);
}

export function isCustomDictionaryWord(word: string): boolean {
  return customDictionary.has(word);
}

// Used by the right-click suggestion list: if the flagged word only differs
// from an existing dictionary entry by case (isCustomDictionaryWord above
// already ruled out an exact match), surface that entry as a suggestion —
// picking it is the fast path to make the word match what's already been
// approved, without having to add yet another case variant to the
// dictionary. Returns null if there's no such near-match.
export function findDictionaryCaseMatch(word: string): string | null {
  const lower = word.toLowerCase();
  for (const w of customDictionary) {
    if (w.toLowerCase() === lower) return w;
  }
  return null;
}
