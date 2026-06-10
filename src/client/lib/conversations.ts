/**
 * Conversation derivation (design §4.3). A Studio "conversation" is exactly one
 * broker-hosted root node; the list is the spine-forest roots. Sub-nodes are
 * never shown — their existence only contributes to a conversation's "needs
 * you" indicator (any node in the sub-DAG with a pending ask) and its activity
 * count. This module is the pure mapping from a canvas snapshot to the
 * consumer-facing conversation rows; the page only renders what comes out.
 *
 * Data limits (honest, not blocked on server changes): the canvas snapshot
 * carries no per-conversation last-message text and no updated-at timestamp, so
 * the row preview is a plain-language status line (not a message excerpt) and
 * recency sorts on `created`. Both upgrade for free if the snapshot grows those
 * fields later.
 */

import type { NodeLifeStatus, NodeSummary } from '../../shared/protocol.js';

/** The four consumer-facing conversation states (design §5.1). */
export type ConversationState = 'needs-you' | 'active' | 'idle' | 'done';

export interface Conversation {
  id: string;
  title: string;
  state: ConversationState;
  /** Pending human asks anywhere in this conversation's sub-DAG. */
  attention: number;
  /** Count of working (active) nodes in the sub-DAG — drives the activity hint. */
  activeChildren: number;
  /** ISO-8601; the root's creation time (recency proxy — see module note). */
  lastActivity: string;
}

/** A node is a conversation root iff it's a broker-hosted spine root. */
function isConversationRoot(n: NodeSummary): boolean {
  return n.parent === null && n.host_kind === 'broker';
}

/** Map of parent id → child rows, for sub-DAG walks. */
function childIndex(nodes: NodeSummary[]): Map<string, NodeSummary[]> {
  const byParent = new Map<string, NodeSummary[]>();
  for (const n of nodes) {
    if (n.parent === null) continue;
    const list = byParent.get(n.parent);
    if (list) list.push(n);
    else byParent.set(n.parent, [n]);
  }
  return byParent;
}

/** Every node in `root`'s sub-DAG, including the root (cycle-safe). */
function subDag(root: NodeSummary, byParent: Map<string, NodeSummary[]>): NodeSummary[] {
  const out: NodeSummary[] = [];
  const seen = new Set<string>();
  const stack: NodeSummary[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (seen.has(n.node_id)) continue;
    seen.add(n.node_id);
    out.push(n);
    const kids = byParent.get(n.node_id);
    if (kids) for (const k of kids) stack.push(k);
  }
  return out;
}

/** A finished lifecycle status (the conversation reads "Finished"). */
function isDone(status: NodeLifeStatus): boolean {
  return status === 'done' || status === 'dead' || status === 'canceled';
}

/** Resolve a conversation's single state from the root + its sub-DAG. */
function deriveState(
  root: NodeSummary,
  attention: number,
  activeChildren: number,
): ConversationState {
  if (attention > 0) return 'needs-you';
  if (root.status === 'active' || activeChildren > 0) return 'active';
  if (isDone(root.status)) return 'done';
  return 'idle';
}

/** State sort rank — needs-you first, then active, then the rest. */
function stateRank(state: ConversationState): number {
  switch (state) {
    case 'needs-you':
      return 0;
    case 'active':
      return 1;
    case 'idle':
      return 2;
    case 'done':
      return 3;
  }
}

/**
 * Build the sorted conversation list from a canvas snapshot: roots only, each
 * enriched from its sub-DAG, ordered needs-you-first then most-recent.
 */
export function buildConversations(nodes: NodeSummary[]): Conversation[] {
  const byParent = childIndex(nodes);
  const convos: Conversation[] = [];

  for (const root of nodes) {
    if (!isConversationRoot(root)) continue;
    const dag = subDag(root, byParent);
    let attention = 0;
    let activeChildren = 0;
    for (const n of dag) {
      attention += Math.max(0, n.attention_count);
      if (n.node_id !== root.node_id && n.status === 'active') activeChildren += 1;
    }
    convos.push({
      id: root.node_id,
      title: root.name,
      state: deriveState(root, attention, activeChildren),
      attention,
      activeChildren,
      lastActivity: root.created,
    });
  }

  convos.sort((a, b) => {
    const byState = stateRank(a.state) - stateRank(b.state);
    if (byState !== 0) return byState;
    // Most-recent first (created proxy; descending ISO compares lexically).
    return b.lastActivity.localeCompare(a.lastActivity);
  });

  return convos;
}

/**
 * Every node beneath `rootId` in the spine forest (excluding the root itself).
 * The Studio ActivityRail summarizes these as plain-language activity instead of
 * showing the raw child graph.
 */
export function descendantsOf(nodes: NodeSummary[], rootId: string): NodeSummary[] {
  const byParent = childIndex(nodes);
  const root = nodes.find((n) => n.node_id === rootId);
  if (!root) return [];
  return subDag(root, byParent).filter((n) => n.node_id !== rootId);
}

/** A plain-language one-line preview for a conversation row (no message text in
 *  the snapshot — see module note). */
export function previewLine(c: Conversation): string {
  switch (c.state) {
    case 'needs-you':
      return c.attention > 1 ? `${c.attention} things need your input` : 'Needs your input';
    case 'active':
      return c.activeChildren > 0
        ? `Working — ${c.activeChildren} ${c.activeChildren === 1 ? 'task' : 'tasks'} in progress`
        : 'Working…';
    case 'done':
      return 'Finished';
    case 'idle':
      return 'Idle';
  }
}
