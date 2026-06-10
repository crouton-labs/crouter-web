/**
 * The `/ws/nodes/:id` session bridge endpoint (spec §6.2).
 *
 * Adapts one `ws` WebSocket to a `HubRegistry` tab: serialize `WsServerMsg`
 * out, parse `WsClientMsg` in, and clean up on close. All the live-session
 * logic lives in the hub — this file is the thin ws ↔ envelope pump the
 * orchestrator's `upgrade.ts` calls once per accepted session socket.
 */

import type { WebSocket } from 'ws';

import type { WsClientMsg } from '../../shared/protocol.js';
import type { HubRegistry } from '../session/hub-registry.js';

/**
 * Register an accepted session WebSocket with the hub registry and pump frames
 * both directions for the lifetime of the socket.
 */
export function attachSessionWs(ws: WebSocket, nodeId: string, registry: HubRegistry): void {
  const tab = registry.attachTab(nodeId, (msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  });

  ws.on('message', (data) => {
    const parsed = parseClientMsg(data.toString());
    if (parsed) tab.handleClientMsg(parsed);
  });

  ws.on('close', () => tab.close());
  ws.on('error', () => tab.close());
}

/** Parse + minimally validate an inbound client frame. Returns `null` (drop)
 *  for malformed JSON or a missing/invalid `type`, so a bad frame never throws
 *  on the hot path. */
function parseClientMsg(raw: string): WsClientMsg | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string') return null;
  if (!CLIENT_TYPES.has(type)) return null;
  return value as WsClientMsg;
}

const CLIENT_TYPES: ReadonlySet<string> = new Set<WsClientMsg['type']>([
  'prompt',
  'steer',
  'abort',
  'set_model',
  'cycle_model',
  'set_thinking_level',
  'compact',
  'request_control',
  'release_control',
  'dialog_response',
]);
