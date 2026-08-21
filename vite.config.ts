import { defineConfig } from 'vite';
import typegpu from 'unplugin-typegpu/vite';

export default defineConfig({
  // Root by default (Vercel / Netlify / Cloudflare Pages). The GitHub Pages
  // workflow sets the repo subpath, e.g. BASE_PATH=/monocular-light-injection/
  base: process.env.BASE_PATH ?? '/',
  plugins: [typegpu()],
});
