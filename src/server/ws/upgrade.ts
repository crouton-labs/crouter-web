// WebSocket upgrade router (design D7 / Flow 4 + Flow 1). One `ws` server in
// `noServer` mode per endpoint; the HTTP server's `upgrade` event is matched on
// pathname and handed to the right attach fn. `/ws/canvas` → the shared
// CanvasWatcher; `/ws/nodes/:id` → a per-node hub tab. Anything else is rejected
// with a 404 handshake so a stray client never hangs half-open.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";

import type { CanvasWatcher } from "../canvas/canvas-watcher.js";
import type { HubRegistry } from "../session/hub-registry.js";
import { attachCanvasWs } from "./canvas-ws.js";
import { attachSessionWs } from "./session-ws.js";

export interface UpgradeDeps {
  watcher: CanvasWatcher;
  hubRegistry: HubRegistry;
}

// One reusable WSS per endpoint kind; we drive the handshake ourselves and never
// let it attach to the HTTP server (noServer), so a single http.Server multiplexes
// both endpoints by pathname.
const canvasWss = new WebSocketServer({ noServer: true });
const sessionWss = new WebSocketServer({ noServer: true });

// `/ws/nodes/:id` — capture the id segment.
const SESSION_RE = /^\/ws\/nodes\/([^/]+)\/?$/;

export function upgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  deps: UpgradeDeps,
): void {
  const pathname = (req.url ?? "/").split("?")[0]!;

  if (pathname === "/ws/canvas") {
    canvasWss.handleUpgrade(req, socket, head, (ws) => {
      attachCanvasWs(ws, deps.watcher);
    });
    return;
  }

  const m = SESSION_RE.exec(pathname);
  if (m) {
    const nodeId = decodeURIComponent(m[1]!);
    // Reject the session-WS for a non-enterable node at the API boundary (§7,
    // AC-5): a tmux-hosted (or unknown) node has no broker socket to drive, so
    // we never open a hub/tab and serve a misleading static "session" — mirror
    // the REST `…/commands` 409. Only `host_kind === 'broker'` is enterable.
    if (deps.hubRegistry.hostKind(nodeId) !== "broker") {
      socket.write("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    sessionWss.handleUpgrade(req, socket, head, (ws) => {
      attachSessionWs(ws, nodeId, deps.hubRegistry);
    });
    return;
  }

  // Unknown upgrade path — reject the handshake cleanly.
  socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  socket.destroy();
}
