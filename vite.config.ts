import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: '.',
  plugins: [
    {
      // Rewrite bare MPA routes to their .html files in dev mode
      name: 'mpa-routes',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/flash') req.url = '/flash.html';
          next();
        });
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist/client',
    rollupOptions: {
      input: {
        main:  resolve(__dirname, 'index.html'),
        flash: resolve(__dirname, 'flash.html'),
      },
    },
  },
});
