import { defineConfig } from 'astro/config';

// SITE_URL / BASE_PATH let the same build serve Cloudflare Pages (https://celticcoo.ca, base "/")
// or a sub-path preview if ever needed.
export default defineConfig({
  site: process.env.SITE_URL || 'https://celticcoo.ca',
  base: process.env.BASE_PATH || '/',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
