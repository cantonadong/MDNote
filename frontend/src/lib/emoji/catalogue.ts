import catalogue from "./catalogue.json";

export interface EmojiEntry { emoji: string; name: string }
export interface EmojiGroup { name: string; entries: EmojiEntry[] }

export const emojiFont = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

const defaultCatalogue: EmojiGroup[] = catalogue.map(group => ({
  ...group,
  entries: group.entries.filter(entry => !/[\u{1F3FB}-\u{1F3FF}]/u.test(entry.emoji)),
})).filter(group => group.entries.length);

// Unicode defines the categories; Windows supplies the glyphs, not a public
// picker-category API. Match the actual WebView font rendering, including
// whether multi-codepoint sequences compose into one icon.
function makeSupportProbe() {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 52;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Emoji rendering unavailable");
  context.font = `28px ${emojiFont}`;
  context.textBaseline = "top";

  function fingerprint(value: string): string {
    context!.clearRect(0, 0, canvas.width, canvas.height);
    context!.fillText(value, 4, 4);
    const pixels = context!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i], 16777619);
    return `${context!.measureText(value).width}:${hash}`;
  }

  const missing = new Set(["\uFFFF", "\u{10FFFF}", "\u0378"].map(fingerprint));
  const singleSupport = new Map<string, boolean>();
  const maxWidth = context.measureText("😀").width * 1.5;
  const supports = (emoji: string): boolean => {
    const points = Array.from(emoji);
    // Ignore joiners, variation selectors and tag characters for glyph checks.
    const visible = points.filter(point => !/[\u200D\uFE0F\u{E0020}-\u{E007F}]/u.test(point));
    for (const point of visible) {
      if (!singleSupport.has(point)) singleSupport.set(point, !missing.has(fingerprint(point)));
      if (!singleSupport.get(point)) return false;
    }
    if (context.measureText(emoji).width > maxWidth) return false;
    if (points.length === 1 || (points.length === 2 && points[1] === "\uFE0F")) return true;
    const rendered = fingerprint(emoji);
    if (emoji.includes("\u200D")) {
      if (rendered === fingerprint(emoji.replaceAll("\u200D", ""))) return false;
    }
    // Unsupported regional flags otherwise appear as two letter glyphs.
    if (/^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(emoji)) {
      if (rendered === fingerprint(points.join("\u200C"))) return false;
    }
    // Unsupported subdivision flags silently fall back to a plain black flag.
    if (/[\u{E0020}-\u{E007F}]/u.test(emoji)) {
      if (rendered === fingerprint(emoji.replace(/[\u{E0020}-\u{E007F}]/gu, ""))) return false;
    }
    return true;
  };
  // Invalidate persisted support results when the WebView or actual emoji
  // font rendering changes, including OS font updates without a browser update.
  const signature = navigator.userAgent + ["😀", "🫩", "🫪", "🫨", "🫠", "👩‍🚀", "🇺🇸", "🏳️‍🌈"].map(fingerprint).join("|");
  return { supports, signature };
}

let supported: Promise<EmojiGroup[]> | undefined;
let readyGroups: EmojiGroup[] | undefined;
let probe: ReturnType<typeof makeSupportProbe> | undefined;
const cacheKey = "mdnote-emoji-support-17-default-skin-v1";

// A synchronous snapshot lets Svelte paint actual buttons on its first render.
// On a fresh installation the small first category is prepared at app startup;
// the remaining categories are scanned in the background.
export function cachedEmojiGroups(): EmojiGroup[] {
  if (readyGroups) return readyGroups;
  probe ??= makeSupportProbe();
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
    if (cached?.signature === probe.signature && Array.isArray(cached.emojis)) {
      const allowed = new Set(cached.emojis);
      readyGroups = defaultCatalogue.map(group => ({
        ...group, entries: group.entries.filter(entry => allowed.has(entry.emoji)),
      })).filter(group => group.entries.length);
      supported = Promise.resolve(readyGroups);
      return readyGroups;
    }
  } catch { /* Unavailable or damaged cache: rebuild from the system font. */ }
  const first = defaultCatalogue[0];
  readyGroups = [{ ...first, entries: first.entries.filter(entry => probe!.supports(entry.emoji)) }];
  return readyGroups;
}

export function supportedEmojiGroups(): Promise<EmojiGroup[]> {
  cachedEmojiGroups();
  return supported ??= (async () => {
    await document.fonts.ready;
    const { supports, signature } = probe!;
    const result: EmojiGroup[] = [];
    let count = 0;
    for (const group of defaultCatalogue) {
      const entries: EmojiEntry[] = [];
      for (const entry of group.entries) {
        if (supports(entry.emoji)) entries.push(entry);
        // Yield during startup scanning so the main UI stays responsive.
        if (++count % 64 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (entries.length) result.push({ name: group.name, entries });
    }
    readyGroups = result;
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        signature, emojis: result.flatMap(group => group.entries.map(entry => entry.emoji)),
      }));
    } catch { /* Memory cache still serves subsequent opens in this session. */ }
    return result;
  })().catch(error => { supported = undefined; throw error; });
}

export function pickerPosition(anchor: DOMRect, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const left = anchor.right + 6 + width <= viewportWidth - 8 ? anchor.right + 6 : anchor.left - width - 6;
  return {
    left: Math.max(8, Math.min(left, viewportWidth - width - 8)),
    top: Math.max(8, Math.min(anchor.top, viewportHeight - height - 8)),
  };
}
