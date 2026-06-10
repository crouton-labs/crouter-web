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
  const v = value as Record<string, unknown>;
  const type = v.type;
  if (typeof type !== 'string') return null;
  if (!CLIENT_TYPES.has(type)) return null;
  if (!hasValidPayload(type, v)) return null;
  return value as WsClientMsg;
}

/** Per-type payload check so structurally-invalid driving frames (e.g.
 *  `{type:'prompt'}` with no `text`) are dropped here, not forwarded to the
 *  broker only to be rejected (spec §6.2 defensive gate). */
function hasValidPayload(type: string, v: Record<string, unknown>): boolean {
  switch (type) {
    case 'prompt':
    case 'steer':
      return typeof v.text === 'string';
    case 'set_model':
      return typeof v.model === 'string';
    case 'set_thinking_level':
      return typeof v.level === 'string';
    case 'dialog_response':
      return typeof v.request_id === 'string' && typeof v.response === 'object' && v.response !== null;
    case 'abort':
    case 'cycle_model':
    case 'compact':
    case 'request_control':
    case 'release_control':
      return true;
    default:
      return false;
  }
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
