/**
 * Session-WS upgrade boundary (spec §7, AC-5). `/ws/nodes/:id` MUST be rejected
 * at the API boundary for a non-enterable (tmux-hosted or unknown) node — a
 * tmux node has no broker socket to drive, so a hub/tab (and the misleading
 * static "session" it would serve) must never be created. Only a
 * `host_kind === 'broker'` node upgrades.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';

import type { CanvasWatcher } from '../../canvas/canvas-watcher.js';
import { HubRegistry } from '../../session/hub-registry.js';
import type { HubRegistryDeps } from '../../session/hub-registry.js';
import { upgrade } from '../upgrade.js';

/** A registry whose only live fact is each node's host kind (the gate's input);
 *  the dormant deps are stubbed so an accepted (broker) node renders a static
 *  snapshot without a real broker. */
function makeRegistry(hostKindOf: Record<string, 'tmux' | 'broker'>): HubRegistry {
  const deps: HubRegistryDeps = {
    createSocket: () => {
      throw new Error('createSocket should not run in this test');
    },
    resolveNode: (id) =>
      hostKindOf[id] ? { status: 'active', hostKind: hostKindOf[id]! } : null,
    viewSockExists: () => false, // dormant → loadStatic, no broker needed
    resolveSessionFile: () => '/fake/session.jsonl',
    normalizeDormantSession: async () => ({ history: [], model: null, thinkingLevel: 'off' }),
  };
  return new HubRegistry(deps);
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('no address');
  return addr.port;
}

/** Resolve to `'open'` if the WS handshake succeeds, or the rejection status
 *  code parsed from the `ws` `unexpected-response`/`error` for a non-101. */
function connect(port: number, path: string): Promise<'open' | number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.on('open', () => {
      ws.close();
      resolve('open');
    });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? -1));
    ws.on('error', (err) => {
      const m = /Unexpected server response: (\d+)/.exec(String(err.message));
      if (m) resolve(Number(m[1]));
      else reject(err);
    });
  });
}

test('AC-5: session-WS upgrade is rejected (409) for a tmux-hosted node', async () => {
  const registry = makeRegistry({ 'tmux-1': 'tmux', 'broker-1': 'broker' });
  const watcher = {} as CanvasWatcher;
  const server = createServer();
  server.on('upgrade', (req, socket, head) => upgrade(req, socket, head, { watcher, hubRegistry: registry }));
  const port = await listen(server);

  try {
    // A tmux node is rejected at the boundary — no hub is ever opened.
    assert.equal(await connect(port, '/ws/nodes/tmux-1'), 409, 'tmux node must be rejected with 409');
    assert.equal(registry.has('tmux-1'), false, 'no hub created for the rejected tmux node');

    // An unknown node (no host_kind) is likewise rejected.
    assert.equal(await connect(port, '/ws/nodes/ghost'), 409, 'unknown node must be rejected with 409');

    // A broker-hosted node upgrades normally.
    assert.equal(await connect(port, '/ws/nodes/broker-1'), 'open', 'broker node must upgrade');
  } finally {
    registry.disposeAll();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
