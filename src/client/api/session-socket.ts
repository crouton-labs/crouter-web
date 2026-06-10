/**
 * Session WebSocket client for `/ws/nodes/:id` (spec §6.2). Transport only: it
 * opens the socket, parses incoming JSON into `WsServerMsg`, and forwards each
 * to `onMessage`. Folding the stream into a message store is the store's job
 * (D12). Reconnects with bounded backoff while open so a server restart or a
 * transient drop re-establishes the session stream (§7 server-restart).
 */

import type { WsClientMsg, WsServerMsg } from '../../shared/protocol.js';

export interface SessionSocketCallbacks {
  onMessage: (msg: WsServerMsg) => void;
  /** Fired on every successful (re)open. */
  onOpen?: () => void;
  /** Fired on every close (transport-level), before a reconnect is scheduled. */
  onClose?: () => void;
}

function wsUrl(id: string): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws/nodes/${encodeURIComponent(id)}`;
}

export interface SessionSocket {
  send: (msg: WsClientMsg) => void;
  close: () => void;
}

/** Open a reconnecting session socket for node `id`. */
export function openSessionSocket(
  id: string,
  cb: SessionSocketCallbacks,
): SessionSocket {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = (): void => {
    if (closed) return;
    ws = new WebSocket(wsUrl(id));
    ws.addEventListener('open', () => {
      attempts = 0;
      cb.onOpen?.();
    });
    ws.addEventListener('message', (ev) => {
      let msg: WsServerMsg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as WsServerMsg;
      } catch {
        return; // ignore unparseable frames
      }
      cb.onMessage(msg);
    });
    ws.addEventListener('close', () => {
      cb.onClose?.();
      if (closed) return;
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      // 'close' fires after 'error'; reconnection is handled there.
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
    send(msg: WsClientMsg) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
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
