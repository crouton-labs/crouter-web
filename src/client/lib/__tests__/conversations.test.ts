/**
 * Conversation derivation (design §4.3): roots-only, sub-DAG attention/activity
 * rollup, state precedence, and the needs-you-first / most-recent sort.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { NodeSummary } from '../../../shared/protocol.js';
import { buildConversations, previewLine } from '../conversations.js';

function node(over: Partial<NodeSummary> & { node_id: string }): NodeSummary {
  return {
    name: over.node_id,
    kind: 'general',
    mode: 'base',
    lifecycle: 'resident',
    status: 'idle',
    cwd: '/tmp',
    parent: null,
    created: '2024-01-01T00:00:00.000Z',
    host_kind: 'broker',
    enterable: true,
    attention_count: 0,
    ...over,
  };
}

test('only broker-hosted roots become conversations', () => {
  const nodes = [
    node({ node_id: 'root', name: 'Root chat' }),
    node({ node_id: 'child', parent: 'root' }),
    node({ node_id: 'tmuxroot', host_kind: 'tmux', enterable: false }),
  ];
  const convos = buildConversations(nodes);
  assert.equal(convos.length, 1);
  assert.equal(convos[0].id, 'root');
  assert.equal(convos[0].title, 'Root chat');
});

test('attention anywhere in the sub-DAG marks the conversation needs-you', () => {
  const nodes = [
    node({ node_id: 'root' }),
    node({ node_id: 'a', parent: 'root' }),
    node({ node_id: 'b', parent: 'a', attention_count: 2 }),
  ];
  const [c] = buildConversations(nodes);
  assert.equal(c.state, 'needs-you');
  assert.equal(c.attention, 2);
});

test('active root or active child yields active state', () => {
  const fromRoot = buildConversations([node({ node_id: 'r', status: 'active' })]);
  assert.equal(fromRoot[0].state, 'active');
  const fromChild = buildConversations([
    node({ node_id: 'r', status: 'idle' }),
    node({ node_id: 'c', parent: 'r', status: 'active' }),
  ]);
  assert.equal(fromChild[0].state, 'active');
  assert.equal(fromChild[0].activeChildren, 1);
});

test('done/dead/canceled roots read as done', () => {
  for (const status of ['done', 'dead', 'canceled'] as const) {
    const [c] = buildConversations([node({ node_id: 'r', status })]);
    assert.equal(c.state, 'done', `status=${status}`);
  }
});

test('needs-you outranks active; recency breaks ties within a state', () => {
  const nodes = [
    node({ node_id: 'old-active', status: 'active', created: '2024-01-01T00:00:00.000Z' }),
    node({ node_id: 'new-active', status: 'active', created: '2024-06-01T00:00:00.000Z' }),
    node({ node_id: 'blocked', status: 'idle', attention_count: 1, created: '2023-01-01T00:00:00.000Z' }),
  ];
  const convos = buildConversations(nodes);
  assert.deepEqual(convos.map((c) => c.id), ['blocked', 'new-active', 'old-active']);
});

test('previewLine speaks plain language per state', () => {
  assert.match(previewLine({ state: 'needs-you', attention: 3 } as never), /need your input/);
  assert.match(previewLine({ state: 'active', activeChildren: 2 } as never), /in progress/);
  assert.equal(previewLine({ state: 'done' } as never), 'Finished');
  assert.equal(previewLine({ state: 'idle' } as never), 'Idle');
});
