import { api } from "$lib/api";

let root = "";
let recent: string[] = [];
let pending: Promise<string[]> | undefined;

export function cachedRecentEmojis(): string[] { return recent; }

export function preloadRecentEmojis(nextRoot: string): Promise<string[]> {
  if (nextRoot !== root) {
    root = nextRoot;
    recent = [];
    pending = undefined;
  }
  return pending ??= api.getRecentFileEmojis().then(values => {
    if (root === nextRoot) recent = values ?? [];
    return values ?? [];
  }).catch(error => {
    if (root === nextRoot) pending = undefined;
    throw error;
  });
}

export function rememberEmoji(emoji: string) {
  if (!emoji) return;
  recent = [emoji, ...recent.filter(value => value !== emoji)].slice(0, 6);
  pending = Promise.resolve(recent);
}
