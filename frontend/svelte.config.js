// Wails embeds a static asset bundle (no Node server), so we run SvelteKit
// as a client-only SPA via adapter-static, output to dist/ to match the
// go:embed path in main.go.
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: "dist",
      assets: "dist",
      fallback: "index.html",
    }),
  },
};

export default config;
