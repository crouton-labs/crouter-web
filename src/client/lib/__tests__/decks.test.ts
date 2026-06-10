import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DECK_KIND_META, waitedFor } from '../deck-presentation.js';
import { totalAttention } from '../use-decks.js';
import type { DeckKind, NodeSummary } from '../../../shared/protocol.js';

test('every deck kind has presentation meta (glyph + label)', () => {
  const kinds: DeckKind[] = ['notify', 'validation', 'decision', 'context', 'error'];
  for (const k of kinds) {
    assert.ok(DECK_KIND_META[k], `missing meta for ${k}`);
    assert.ok(DECK_KIND_META[k].icon, `missing icon for ${k}`);
    assert.ok(DECK_KIND_META[k].label.length > 0, `missing label for ${k}`);
  }
});

test('waitedFor formats relative durations compactly', () => {
  const now = new Date('2026-01-01T01:00:00.000Z').getTime();
  assert.equal(waitedFor('2026-01-01T00:59:30.000Z', now), '30s');
  assert.equal(waitedFor('2026-01-01T00:55:00.000Z', now), '5m');
  assert.equal(waitedFor('2026-01-01T00:00:00.000Z', now), '1h');
  assert.equal(waitedFor('2025-12-30T01:00:00.000Z', now), '2d');
  assert.equal(waitedFor('not-a-date', now), '');
});

function node(id: string, attention: number): NodeSummary {
  return {
    node_id: id,
    name: id,
    kind: 'general',
    mode: 'base',
    lifecycle: 'resident',
    status: 'active',
    cwd: '/w',
    parent: null,
    created: '2026-01-01T00:00:00.000Z',
    host_kind: 'broker',
    enterable: true,
    attention_count: attention,
  };
}

test('totalAttention sums pending asks, clamping negatives', () => {
  assert.equal(totalAttention([]), 0);
  assert.equal(totalAttention([node('a', 2), node('b', 0), node('c', 3)]), 5);
  assert.equal(totalAttention([node('a', -1), node('b', 1)]), 1);
});
