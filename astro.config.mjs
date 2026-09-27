// @ts-check
import { defineConfig } from 'astro/config';
import exifEntfernen from './integrations/exif-entfernen.mjs';

// Für GitHub Pages setzt der Deploy-Workflow SITE und BASE_PATH
// (z. B. SITE=https://name.github.io, BASE_PATH=/RadSeite).
export default defineConfig({
  site: process.env.SITE || undefined,
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'ignore',
  integrations: [exifEntfernen()],
});
