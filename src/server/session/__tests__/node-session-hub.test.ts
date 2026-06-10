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

/** A socket whose liveness is decided at `connect()`-time by an external flag,
 *  so a single factory can model a broker that dies and is later auto-revived.
 *  Live ⇒ handshake + `welcome`; dead ⇒ `error(BrokerUnavailableError)`+`close`
 *  (a stale/absent `view.sock`). The test keeps the instance to kill it later. */
class FlakySocket extends EventEmitter {
  constructor(
    private readonly nodeId: string,
    private readonly isUp: () => boolean,
    private readonly history: unknown[],
  ) {
    super();
  }
  connect(): void {
    if (this.isUp()) {
      setImmediate(() => this.emit('connect'));
    } else {
      setImmediate(() => {
        this.emit('error', new BrokerUnavailableError(this.nodeId));
        this.emit('close');
      });
    }
  }
  send(frame: { type: string }): void {
    if (frame.type === 'hello' && this.isUp()) {
      setImmediate(() =>
        this.emit('frame', {
          type: 'welcome',
          controller_id: null,
          snapshot: {
            messages: this.history,
            stats: {
              sessionId: 'node-1',
              userMessages: 1,
              assistantMessages: 1,
              toolCalls: 0,
              toolResults: 0,
              totalMessages: this.history.length,
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

test('AC-21: an OPEN live hub auto-resumes live (broker_status:revived) when the daemon re-creates view.sock after a broker crash', async () => {
  // A single flaky factory: the broker is up at entry, killed mid-view, then
  // auto-revived by the daemon. `sockPresent` mirrors `view.sock` existence.
  let brokerUp = true;
  let sockPresent = true;
  const sockets: FlakySocket[] = [];
  const liveHistory = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'live' }] },
  ];
  const deps: HubDeps = {
    createSocket: (nodeId) => {
      const s = new FlakySocket(nodeId, () => brokerUp, liveHistory);
      sockets.push(s);
      return s as unknown as ViewSocketClient;
    },
    resolveNode: () => ({ status: 'active', hostKind: 'broker' }),
    viewSockExists: () => sockPresent,
    resolveSessionFile: () => '/fake/session.jsonl',
    normalizeDormantSession: async () => ({
      history: [{ role: 'user', content: 'hi' } as never],
      model: 'gpt-x',
      thinkingLevel: 'off',
    }),
    newClientId: () => 'srv-1',
    // Tiny backoff with a low attempt cap so the bounded live-reconnect exhausts
    // fast and we exercise the post-give-up auto-resume watch.
    backoff: { baseMs: 1, maxMs: 2, maxAttempts: 3 },
  };

  const hub = new NodeSessionHub('node-1', deps);
  const msgs: WsServerMsg[] = [];
  hub.addTab((m) => msgs.push(m));

  // 1) Live entry over the open tab.
  await new Promise((r) => setTimeout(r, 20));
  const firstSnap = msgs.find((m) => m.type === 'snapshot') as { source?: string } | undefined;
  assert.equal(firstSnap?.source, 'broker', 'entered live');

  // 2) Broker crashes mid-view: kill the live socket + drop its view.sock.
  brokerUp = false;
  sockPresent = false;
  sockets[0]!.emit('close');

  // Bounded live-reconnect runs and exhausts → down + static fallback.
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(
    msgs.some((m) => m.type === 'broker_status' && (m as { state: string }).state === 'down'),
    'broker down was broadcast',
  );
  assert.ok(
    (msgs.filter((m) => m.type === 'snapshot') as Array<{ source?: string }>).some(
      (s) => s.source === 'static',
    ),
    'fell back to a static snapshot while the broker is down',
  );
  const beforeRevive = msgs.length;

  // 3) The daemon auto-revives the broker — NO manual revive() call. The OPEN
  //    hub must detect the reappeared view.sock on its own and resume live.
  brokerUp = true;
  sockPresent = true;
  await new Promise((r) => setTimeout(r, 60));

  const after = msgs.slice(beforeRevive);
  assert.ok(
    after.some((m) => m.type === 'broker_status' && (m as { state: string }).state === 'revived'),
    `open view must auto-resume with broker_status:'revived'; got ${JSON.stringify(after)}`,
  );
  const liveSnap = (after.filter((m) => m.type === 'snapshot') as Array<{ source?: string }>).find(
    (s) => s.source === 'broker',
  );
  assert.ok(liveSnap, 'a fresh LIVE broker snapshot was delivered over the open tab');

  hub.dispose();
});
