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
          if (req.url === '/demo') req.url = '/demo.html';
          if (req.url === '/pattern-demo') req.url = '/pattern-demo.html';
          if (req.url === '/background-stats-demo') req.url = '/background-stats-demo.html';
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
        demo:  resolve(__dirname, 'demo.html'),
        patternDemo: resolve(__dirname, 'pattern-demo.html'),
        backgroundStatsDemo: resolve(__dirname, 'background-stats-demo.html'),
      },
    },
  },
});
