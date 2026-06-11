/**
 * Unit tests for buildGraphTree (2a graph rail logic).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { NodeSummary } from '../../../shared/protocol.js';
import { buildGraphTree } from '../graph.js';

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

test('root node: thisGraph contains just the root at depth 0', () => {
  const nodes = [node({ node_id: 'root' })];
  const { thisGraph, otherGraphs } = buildGraphTree(nodes, 'root');
  assert.equal(thisGraph.length, 1);
  assert.equal(thisGraph[0]!.node.node_id, 'root');
  assert.equal(thisGraph[0]!.depth, 0);
  assert.equal(otherGraphs.length, 0);
});

test('child node: thisGraph walks up to root, lists full subtree in DFS preorder', () => {
  const nodes = [
    node({ node_id: 'root' }),
    node({ node_id: 'child1', parent: 'root' }),
    node({ node_id: 'child2', parent: 'root' }),
    node({ node_id: 'grandchild', parent: 'child1' }),
  ];
  const { thisGraph } = buildGraphTree(nodes, 'grandchild');
  const ids = thisGraph.map((g) => g.node.node_id);
  // DFS preorder: root → child1 → grandchild → child2 (or child2 first dep on push order)
  assert.ok(ids.includes('root'));
  assert.ok(ids.includes('child1'));
  assert.ok(ids.includes('grandchild'));
  assert.ok(ids.includes('child2'));
  assert.equal(ids[0], 'root');

  const depths = Object.fromEntries(thisGraph.map((g) => [g.node.node_id, g.depth]));
  assert.equal(depths['root'], 0);
  assert.equal(depths['child1'], 1);
  assert.equal(depths['child2'], 1);
  assert.equal(depths['grandchild'], 2);
});

test('otherGraphs: only active or attention>0 broker roots from OTHER graphs', () => {
  const nodes = [
    node({ node_id: 'mine' }),
    node({ node_id: 'other-active', status: 'active' }),
    node({ node_id: 'other-attention', attention_count: 2 }),
    node({ node_id: 'other-idle' }), // idle, no attention — excluded
    node({ node_id: 'tmux-root', host_kind: 'tmux', enterable: false, status: 'active' }), // tmux — excluded
  ];
  const { otherGraphs } = buildGraphTree(nodes, 'mine');
  const ids = otherGraphs.map((n) => n.node_id);
  assert.ok(ids.includes('other-active'));
  assert.ok(ids.includes('other-attention'));
  assert.ok(!ids.includes('other-idle'));
  assert.ok(!ids.includes('tmux-root'));
  assert.ok(!ids.includes('mine'));
});

test('currentId not found: thisGraph is empty', () => {
  const nodes = [node({ node_id: 'root' })];
  const { thisGraph } = buildGraphTree(nodes, 'ghost');
  assert.equal(thisGraph.length, 0);
});

test('current root is not included in otherGraphs', () => {
  const nodes = [
    node({ node_id: 'root', status: 'active' }),
    node({ node_id: 'other', status: 'active' }),
  ];
  const { thisGraph, otherGraphs } = buildGraphTree(nodes, 'root');
  assert.equal(thisGraph.length, 1);
  assert.equal(otherGraphs.length, 1);
  assert.equal(otherGraphs[0]!.node_id, 'other');
});
