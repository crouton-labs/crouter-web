/**
 * NodeSessionHub dormant-fallback path (design D14, spec §7). A node whose
 * `view.sock` exists at check time but whose broker is dead (a STALE socket)
 * must serve the static snapshot ONCE and stay dormant — never flap a
 * `down`/`reconnecting` reconnect storm (§7: never fabricate a live session).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';

import { BrokerUnavailableError, type ViewSocketClient } from '../../crouter-lib.js';
import type { WsServerMsg } from '../../../shared/protocol.js';
import { NodeSessionHub, type HubDeps } from '../node-session-hub.js';

/** A stale `view.sock`: emits `error(BrokerUnavailableError)` then the `close`
 *  that always follows it (mirrors crouter `view-socket.js`). */
class StaleSocket extends EventEmitter {
  constructor(private readonly nodeId: string) {
    super();
  }
  connect(): void {
    this.emit('error', new BrokerUnavailableError(this.nodeId));
    this.emit('close');
  }
  send(): void {}
  close(): void {}
}

/** A live broker socket that completes the handshake and replies to `hello`
 *  with a `welcome` carrying the given history snapshot. */
class LiveSocket extends EventEmitter {
  constructor(private readonly snapshotMessages: unknown[]) {
    super();
  }
  connect(): void {
    setImmediate(() => this.emit('connect'));
  }
  send(frame: { type: string }): void {
    if (frame.type === 'hello') {
      setImmediate(() =>
        this.emit('frame', {
          type: 'welcome',
          controller_id: null,
          snapshot: {
            messages: this.snapshotMessages,
            stats: {
              sessionId: 'node-1',
              userMessages: 1,
              assistantMessages: 1,
              toolCalls: 0,
              toolResults: 0,
              totalMessages: 2,
              tokens: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, total: 7 },
              cost: 0,
            },
            state: {},
          },
        }),
      );
    }
  }
  close(): void {}
}

function tick(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

test('stale view.sock serves the static snapshot once, with no reconnect storm', async () => {
  let socketsMade = 0;
  const deps: HubDeps = {
    createSocket: (nodeId) => {
      socketsMade += 1;
      return new StaleSocket(nodeId) as unknown as ViewSocketClient;
    },
    resolveNode: () => ({ status: 'active', hostKind: 'broker' }),
    viewSockExists: () => true, // stale socket present at check time → "live"
    resolveSessionFile: () => '/fake/session.jsonl',
    normalizeDormantSession: async () => ({ history: [], model: 'gpt-x', thinkingLevel: 'off' }),
    newClientId: () => 'srv-1',
    backoff: { baseMs: 1, maxMs: 2, maxAttempts: 8 },
  };

  const hub = new NodeSessionHub('node-1', deps);
  const msgs: WsServerMsg[] = [];
  hub.addTab((m) => msgs.push(m));

  // Let the async loadStatic resolve, then give any (erroneous) reconnect timers
  // ample time to fire — with maxMs=2ms a storm would emit many frames here.
  await tick();
  await new Promise((r) => setTimeout(r, 30));

  const snapshots = msgs.filter((m) => m.type === 'snapshot');
  const statuses = msgs.filter((m) => m.type === 'broker_status');

  // Exactly one static snapshot, and NOT a single down/reconnecting frame.
  assert.equal(snapshots.length, 1, `expected one snapshot, got ${snapshots.length}`);
  assert.equal((snapshots[0] as { source?: string }).source, 'static');
  assert.deepEqual(
    statuses,
    [],
    `dormant fallback must not flap broker_status; got ${JSON.stringify(statuses)}`,
  );
  // One connect attempt only — no reconnect loop spun up fresh sockets.
  assert.equal(socketsMade, 1);

  hub.dispose();
});

test('revive() transitions a dormant tab live over the same socket (no reload)', async () => {
  let sockExists = false; // dormant at entry; the revive boots the broker
  const liveHistory = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'live again' }] },
  ];
  const deps: HubDeps = {
    createSocket: () => new LiveSocket(liveHistory) as unknown as ViewSocketClient,
    resolveNode: () => ({ status: 'active', hostKind: 'broker' }),
    viewSockExists: () => sockExists,
    resolveSessionFile: () => '/fake/session.jsonl',
    normalizeDormantSession: async () => ({
      history: [{ role: 'user', content: 'hi' } as never],
      model: 'gpt-x',
      thinkingLevel: 'off',
    }),
    newClientId: () => 'srv-1',
    backoff: { baseMs: 1, maxMs: 2, maxAttempts: 8 },
  };

  const hub = new NodeSessionHub('node-1', deps);
  const msgs: WsServerMsg[] = [];
  hub.addTab((m) => msgs.push(m));

  // Dormant render first: one static snapshot, no broker_status flap.
  await tick();
  await new Promise((r) => setTimeout(r, 10));
  const firstSnap = msgs.find((m) => m.type === 'snapshot') as { source?: string } | undefined;
  assert.equal(firstSnap?.source, 'static');

  // The broker comes online, then the server kicks the hub.
  sockExists = true;
  hub.revive();
  await new Promise((r) => setTimeout(r, 20));

  // The same open tab received a `revived` status and a fresh LIVE snapshot,
  // with no second static snapshot in between (one render path, no reload).
  const statuses = msgs.filter((m) => m.type === 'broker_status') as Array<{ state: string }>;
  assert.ok(
    statuses.some((s) => s.state === 'revived'),
    `expected a 'revived' status; got ${JSON.stringify(statuses)}`,
  );
  const snaps = msgs.filter((m) => m.type === 'snapshot') as Array<{ source?: string }>;
  const liveSnap = snaps.find((s) => s.source === 'broker');
  assert.ok(liveSnap, 'expected a live broker snapshot after revive');
  assert.equal(
    (liveSnap as { history: unknown[] }).history.length,
    2,
    'live snapshot replaces dormant history from the broker (no dup/loss)',
  );

  hub.dispose();
});
