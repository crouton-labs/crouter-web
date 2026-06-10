/**
 * The ControllerArbiter state machine (design D4, spec §5.D) without a socket:
 * observer→controller, tab-vs-tab demotion, external-attach denial, and
 * release-frees-slot — driven through injected callbacks.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { ClientToBroker } from '../../crouter-lib.js';
import type { WsServerMsg } from '../../../shared/protocol.js';
import { ControllerArbiter } from '../controller-arbiter.js';

const SERVER_ID = 'srv-1';

interface Harness {
  arbiter: ControllerArbiter;
  upstream: ClientToBroker[];
  notes: Array<{ tabId: string; msg: WsServerMsg }>;
}

function harness(): Harness {
  const upstream: ClientToBroker[] = [];
  const notes: Array<{ tabId: string; msg: WsServerMsg }> = [];
  const arbiter = new ControllerArbiter({
    clientId: SERVER_ID,
    sendUpstream: (frame) => upstream.push(frame),
    notifyTab: (tabId, msg) => notes.push({ tabId, msg }),
  });
  return { arbiter, upstream, notes };
}

test('observer→controller: lazy request, confirmed on broker grant', () => {
  const h = harness();
  // Welcome with no controller → slot free.
  h.arbiter.onBrokerControlChanged(null);
  assert.equal(h.arbiter.roleOf('A'), 'observer');

  h.arbiter.requestControl('A');
  // Lazy acquire: request_control went upstream, NOT yet a controller.
  assert.deepEqual(h.upstream, [{ type: 'request_control' }]);
  assert.equal(h.arbiter.roleOf('A'), 'observer');
  assert.equal(h.notes.length, 0);

  // Broker grants the slot to our server client id.
  h.arbiter.onBrokerControlChanged(SERVER_ID);
  assert.equal(h.arbiter.roleOf('A'), 'controller');
  assert.deepEqual(h.notes.at(-1), {
    tabId: 'A',
    msg: { type: 'control_changed', controller: SERVER_ID, you_are: 'controller' },
  });
});

test('tab-vs-tab: second request demotes the first, no second upstream request', () => {
  const h = harness();
  h.arbiter.onBrokerControlChanged(null);
  h.arbiter.requestControl('A');
  h.arbiter.onBrokerControlChanged(SERVER_ID);
  h.upstream.length = 0;
  h.notes.length = 0;

  // Second tab takes control while we already hold the broker slot.
  h.arbiter.requestControl('B');
  assert.equal(h.arbiter.roleOf('B'), 'controller');
  assert.equal(h.arbiter.roleOf('A'), 'observer');
  // No new upstream request — pure tab handoff.
  assert.deepEqual(h.upstream, []);
  // A is demoted + notified; B is promoted + notified.
  const demote = h.notes.find((n) => n.tabId === 'A');
  const promote = h.notes.find((n) => n.tabId === 'B');
  assert.deepEqual(demote?.msg, { type: 'control_changed', controller: SERVER_ID, you_are: 'observer' });
  assert.deepEqual(promote?.msg, { type: 'control_changed', controller: SERVER_ID, you_are: 'controller' });
});

test('external-attach denial: request_control while an external client holds the slot', () => {
  const h = harness();
  // Broker reports an external controller id.
  h.arbiter.onBrokerControlChanged('external-9');
  assert.ok(h.arbiter.hasExternalController());

  h.arbiter.requestControl('A');
  assert.deepEqual(h.upstream, []); // never reaches the broker
  assert.equal(h.arbiter.roleOf('A'), 'observer');
  assert.deepEqual(h.notes.at(-1)?.msg, {
    type: 'error',
    code: 'control_denied',
    message: 'An external attach client holds control of this node.',
  });
});

test('external takeover demotes a sitting web-controller', () => {
  const h = harness();
  h.arbiter.onBrokerControlChanged(null);
  h.arbiter.requestControl('A');
  h.arbiter.onBrokerControlChanged(SERVER_ID);
  h.notes.length = 0;

  // An external attach steals the broker slot.
  h.arbiter.onBrokerControlChanged('external-9');
  assert.equal(h.arbiter.roleOf('A'), 'observer');
  assert.ok(h.arbiter.hasExternalController());
  assert.deepEqual(h.notes.at(-1), {
    tabId: 'A',
    msg: { type: 'control_changed', controller: 'external-9', you_are: 'observer' },
  });
});

test('release frees the broker slot upstream', () => {
  const h = harness();
  h.arbiter.onBrokerControlChanged(null);
  h.arbiter.requestControl('A');
  h.arbiter.onBrokerControlChanged(SERVER_ID);
  h.upstream.length = 0;
  h.notes.length = 0;

  h.arbiter.releaseControl('A');
  assert.equal(h.arbiter.roleOf('A'), 'observer');
  assert.deepEqual(h.upstream, [{ type: 'release_control' }]);
  assert.deepEqual(h.notes.at(-1), {
    tabId: 'A',
    msg: { type: 'control_changed', controller: null, you_are: 'observer' },
  });

  // Broker echoes the freed slot.
  h.arbiter.onBrokerControlChanged(null);
  assert.equal(h.arbiter.hasExternalController(), false);

  // A fresh request now re-acquires upstream.
  h.arbiter.requestControl('B');
  assert.deepEqual(h.upstream.at(-1), { type: 'request_control' });
});

test('release-then-request across two tabs re-acquires the slot (no phantom controller)', () => {
  const h = harness();
  // Tab A acquires and holds the broker slot.
  h.arbiter.onBrokerControlChanged(null);
  h.arbiter.requestControl('A');
  h.arbiter.onBrokerControlChanged(SERVER_ID);
  assert.equal(h.arbiter.roleOf('A'), 'controller');

  // A releases (lazy: brokerSlotHeld stays true until the broker echoes null),
  // and tab B requests control INSIDE that window — a pure tab handoff over the
  // still-held slot.
  h.arbiter.releaseControl('A');
  h.arbiter.requestControl('B');
  assert.equal(h.arbiter.roleOf('B'), 'controller');

  h.upstream.length = 0;
  h.notes.length = 0;

  // The broker finally processes A's earlier release and echoes the freed slot.
  // B still holds the web slot, so the arbiter MUST re-acquire upstream rather
  // than leave a phantom web-controller with no broker slot.
  h.arbiter.onBrokerControlChanged(null);
  assert.deepEqual(h.upstream, [{ type: 'request_control' }]);
  // Until the broker re-grants, B is not (yet) a real controller.
  assert.equal(h.arbiter.roleOf('B'), 'observer');

  // Broker grants — B is a real, slot-backed controller again.
  h.arbiter.onBrokerControlChanged(SERVER_ID);
  assert.equal(h.arbiter.roleOf('B'), 'controller');
});

test('handleTabClose on the controller frees the slot', () => {
  const h = harness();
  h.arbiter.onBrokerControlChanged(null);
  h.arbiter.requestControl('A');
  h.arbiter.onBrokerControlChanged(SERVER_ID);
  h.upstream.length = 0;

  h.arbiter.handleTabClose('A');
  assert.deepEqual(h.upstream, [{ type: 'release_control' }]);
  // A non-controller tab closing is a no-op.
  h.upstream.length = 0;
  h.arbiter.handleTabClose('Z');
  assert.deepEqual(h.upstream, []);
});
