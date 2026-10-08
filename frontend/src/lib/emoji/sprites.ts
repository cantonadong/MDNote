import { emojiFont, supportedEmojiGroups, type EmojiGroup } from "./catalogue";

export interface EmojiSprite { url: string; x: number; y: number; width: number; height: number }

const sprites = new Map<string, EmojiSprite>();
const cell = 32;
const columns = 12;
const pageSize = 144;
let preparing: Promise<void> | undefined;

export function emojiSprite(emoji: string): EmojiSprite | undefined { return sprites.get(emoji); }

// Keep native colour-font shaping and rasterization out of category switches.
// Small, decoded atlas pages are reused by all picker instances in this session.
async function prepare(groups: EmojiGroup[]) {
  await document.fonts.ready;
  const scale = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
  // Prepare the initial viewport of every category before their later rows.
  const entries = groups.flatMap(group => group.entries.slice(0, 84)).concat(
    groups.flatMap(group => group.entries.slice(84)),
  );
  for (let offset = 0; offset < entries.length; offset += pageSize) {
    const page = entries.slice(offset, offset + pageSize);
    const rows = Math.ceil(page.length / columns);
    const canvas = document.createElement("canvas");
    canvas.width = columns * cell * scale;
    canvas.height = rows * cell * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.font = `23px ${emojiFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let sliceStart = performance.now();
    for (let i = 0; i < page.length; i++) {
      ctx.fillText(page[i].emoji, (i % columns + 0.5) * cell, (Math.floor(i / columns) + 0.5) * cell);
      if (performance.now() - sliceStart >= 4) {
        await new Promise(resolve => setTimeout(resolve, 0));
        sliceStart = performance.now();
      }
    }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.src = url;
    try { await image.decode(); }
    catch { URL.revokeObjectURL(url); continue; }
    for (let i = 0; i < page.length; i++) {
      sprites.set(page[i].emoji, {
        url, x: -(i % columns) * cell, y: -Math.floor(i / columns) * cell,
        width: columns * cell, height: rows * cell,
      });
    }
    // Atlas URLs live for the document lifetime, like the font-support cache.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

export function preloadEmojiSprites(): Promise<void> {
  return preparing ??= supportedEmojiGroups().then(prepare).catch(error => {
    preparing = undefined;
    throw error;
  });
}
