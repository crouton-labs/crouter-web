// Canvas WebSocket attach (spec §6.3, design Flow 4). Subscribes one `/ws/canvas`
// browser client to the shared CanvasWatcher: the current snapshot is sent
// immediately on subscribe, and every changed snapshot thereafter is pushed as a
// `CanvasMsg`. Cleans up its subscription when the socket closes/errors. The server
// fans out from ONE watcher, so cost is flat regardless of viewer count.

import type { WebSocket } from "ws";
import type { CanvasMsg } from "../../shared/protocol.js";
import type { CanvasWatcher } from "../canvas/canvas-watcher.js";

/** Attach a browser canvas socket to the watcher; tears down on close/error. */
export function attachCanvasWs(ws: WebSocket, watcher: CanvasWatcher): void {
  const send = (msg: CanvasMsg): void => {
    // ws.OPEN === 1; guard against sends after the socket is closing/closed.
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const unsubscribe = watcher.subscribe(send);

  const cleanup = (): void => {
    unsubscribe();
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
}
