/**
 * Light-Pattern Detector – WebSocket relay server
 *
 * Architecture
 * ────────────
 *  Sensor client  →  /ws  →  this server  →  /ws  →  Subscriber clients
 *
 * The browser running the webcam detection connects with role="sensor".
 * Any number of external consumers connect with role="subscriber".
 * The server relays every "sensor_reading" message to all subscribers.
 *
 * In production the server also serves the Vite-built static assets.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import type { WsMessage, IdentifyPayload } from '../shared/types.js';

const PORT = Number(process.env.PORT ?? 3001);
// Compiled output: dist/server/index.js  →  dist/client is one level up
const DIST_CLIENT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../client');

// ── HTTP server (serves built frontend in production) ────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.woff2':'font/woff2',
};

const httpServer = http.createServer((req, res) => {
  const rawUrl = req.url ?? '/';
  // Ignore query strings, avoid path traversal
  const urlPath = rawUrl.split('?')[0].replace(/\.\./g, '');
  const resolved =
    urlPath === '/'      ? '/index.html' :
    urlPath === '/flash' ? '/flash.html' :
    urlPath;
  const filePath = path.join(DIST_CLIENT, resolved);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback
    const index = path.join(DIST_CLIENT, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(index).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Light Pattern Detector server running. Build the client first: npm run build');
    }
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

// ── WebSocket server (noServer – we handle upgrades manually at /ws) ─────────

const wss = new WebSocketServer({ noServer: true });

interface ClientState {
  ws: WebSocket;
  role: 'sensor' | 'subscriber' | 'unknown';
  connectedAt: number;
}

const clients = new Set<ClientState>();

function broadcast(msg: string, exclude?: WebSocket): void {
  for (const c of clients) {
    if (c.role === 'subscriber' && c.ws !== exclude && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(msg);
    }
  }
}

wss.on('connection', (ws) => {
  const state: ClientState = { ws, role: 'unknown', connectedAt: Date.now() };
  clients.add(state);
  console.log(`[ws] client connected  total=${clients.size}`);

  ws.on('message', (raw) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(raw.toString()) as WsMessage;
    } catch {
      return; // ignore malformed
    }

    switch (msg.type) {
      case 'identify': {
        const p = msg.payload as IdentifyPayload | undefined;
        if (p?.role === 'sensor' || p?.role === 'subscriber') {
          state.role = p.role;
          console.log(`[ws] client identified as ${state.role}`);
        }
        break;
      }

      case 'sensor_reading': {
        if (state.role === 'sensor') {
          broadcast(raw.toString(), ws);
        }
        break;
      }

      case 'ping': {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    clients.delete(state);
    console.log(`[ws] client disconnected  total=${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[ws] error:', err.message);
  });
});

// Handle WebSocket upgrade only at /ws
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

httpServer.listen(PORT, () => {
  console.log(`Light Pattern Detector server  →  http://localhost:${PORT}`);
  console.log(`WebSocket endpoint             →  ws://localhost:${PORT}/ws`);
  console.log(`  • Connect as sensor:     { type:"identify", payload:{role:"sensor"} }`);
  console.log(`  • Connect as subscriber: { type:"identify", payload:{role:"subscriber"} }`);
});
