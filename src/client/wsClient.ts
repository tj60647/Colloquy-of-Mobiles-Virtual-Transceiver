import type { LightReading, WsMessage } from '../shared/types.js';

/**
 * WsClient
 *
 * Thin wrapper around the browser WebSocket API.
 * Identifies itself to the server as role="sensor" and sends LightReadings.
 * Reconnects automatically with exponential back-off on disconnection.
 */
export class WsClient {
  private ws: WebSocket | null = null;
  private retryDelay = 1000; // ms, doubles on each failure up to 16 s
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private hasNetworkListeners = false;

  connected = false;
  /** Called whenever a message arrives from the server (e.g. pong) */
  onMessage?: (msg: WsMessage) => void;

  constructor(private readonly url: string) {}

  connect(): void {
    this.ensureNetworkListeners();
    this.tryConnect();
  }

  private tryConnect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.connected = true;
        this.retryDelay = 1000; // reset back-off
        this.send({ type: 'identify', payload: { role: 'sensor' } });
      };

      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as WsMessage;
          this.onMessage?.(msg);
        } catch { /* ignore */ }
      };

      this.ws.onerror = () => {
        // onclose fires after onerror, so reconnect logic lives there
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.retryTimer !== null) return;
    const jitterMs = Math.floor(Math.random() * 300);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryDelay = Math.min(this.retryDelay * 2, 16_000);
      this.tryConnect();
    }, this.retryDelay + jitterMs);
  }

  private ensureNetworkListeners(): void {
    if (this.hasNetworkListeners) return;
    this.hasNetworkListeners = true;

    window.addEventListener('online', () => {
      if (!this.connected) {
        this.retryDelay = 1000;
        this.tryConnect();
      }
    });
  }

  /** Send a detection reading to the server */
  sendReading(reading: LightReading): void {
    this.send({ type: 'sensor_reading', payload: reading });
  }

  private send(msg: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.ws?.close();
  }
}
