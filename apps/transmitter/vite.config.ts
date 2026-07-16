import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // Relative asset paths so the built app works standalone AND behind a
  // /transmitter rewrite-proxy.
  base: './',
  server: {
    fs: {
      // main.ts imports src/shared/dictionary.ts from the repo root — outside
      // this app root — until the shared core is extracted into its own package.
      allow: [resolve(__dirname, '../..')],
    },
  },
  build: {
    outDir: 'dist',
  },
});
