/**
 * Canvas WebSocket client for `/ws/canvas` (spec §6.3). Transport only: parses
 * pushed `CanvasMsg` frames and forwards them via callback, reconnecting with
 * bounded backoff. If the WS is unavailable the canvas-store falls back to
 * polling `GET /api/canvas` — that fallback lives in the store, not here.
 */

import type { CanvasMsg } from '../../shared/protocol.js';

export interface CanvasSocketCallbacks {
  onMessage: (msg: CanvasMsg) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

function wsUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws/canvas`;
}

export interface CanvasSocket {
  close: () => void;
}

/** Open a reconnecting canvas socket. */
export function openCanvasSocket(cb: CanvasSocketCallbacks): CanvasSocket {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = (): void => {
    if (closed) return;
    ws = new WebSocket(wsUrl());
    ws.addEventListener('open', () => {
      attempts = 0;
      cb.onOpen?.();
    });
    ws.addEventListener('message', (ev) => {
      let msg: CanvasMsg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as CanvasMsg;
      } catch {
        return;
      }
      if (msg && msg.type === 'canvas') cb.onMessage(msg);
    });
    ws.addEventListener('close', () => {
      cb.onClose?.();
      if (closed) return;
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    });
  };

  const scheduleReconnect = (): void => {
    if (closed || reconnectTimer) return;
    attempts += 1;
    const delay = Math.min(15_000, 500 * 2 ** Math.min(attempts, 5));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        ws?.close();
      } catch {
        /* noop */
      }
      ws = null;
    },
  };
}
