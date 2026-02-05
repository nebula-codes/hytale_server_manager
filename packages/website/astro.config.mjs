import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://nebula-codes.github.io',
  base: '/hytale_server_manager',
  integrations: [
    tailwind(),
    sitemap({
      filter: (page) => !page.includes('/docs/') && !page.includes('/features'),
    }),
  ],
  output: 'static',
});
