/**
 * Inbox deck hooks. The pending-deck list is served by `GET /api/decks`; rather
 * than open a second socket, it re-fetches whenever the (already live) canvas
 * feed reports a change in total pending asks — `NodeSummary.attention_count`
 * rides the canvas WS, so a deck added or resolved anywhere flips the total and
 * triggers a refetch. The badge count is derived straight from that same total,
 * so it updates instantly with zero extra round-trips (design §4.1 badge,
 * §5.2 list). Polling fallback is inherited from the canvas store.
 */

import { useEffect, useState, useCallback } from 'react';
import type { DeckSummary, NodeSummary } from '../../shared/protocol.js';
import { getDecks } from '../net/rest.js';
import { useCanvasStore } from './use-canvas-store.js';

/** Total pending asks across the canvas (deduped by cwd at the source). */
export function totalAttention(nodes: NodeSummary[]): number {
  let sum = 0;
  for (const n of nodes) sum += Math.max(0, n.attention_count);
  return sum;
}

/** The inbox badge count, derived live from the canvas snapshot. */
export function useInboxCount(): number {
  const { nodes } = useCanvasStore();
  return totalAttention(nodes);
}

export interface DecksStore {
  decks: DeckSummary[];
  /** True until the first fetch resolves. */
  loading: boolean;
  refetch: () => void;
}

/** Self-managing pending-deck list. Refetches when the canvas attention total
 *  changes (a deck appeared or was handled) and on demand. */
export function useDecks(): DecksStore {
  const { nodes } = useCanvasStore();
  const total = totalAttention(nodes);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let disposed = false;
    getDecks()
      .then((d) => {
        if (!disposed) {
          setDecks(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
    // Re-fetch on an attention-total change (live signal from the canvas feed)
    // and on explicit refetch (e.g. after resolving a deck).
  }, [total, nonce]);

  return { decks, loading, refetch };
}

/** Pending decks belonging to one conversation (its spine root id) — for the
 *  inline ask card in the conversation view (design §4.3/§5.1). */
export function useConversationDecks(conversationId: string): DeckSummary[] {
  const { decks } = useDecks();
  return decks.filter((d) => d.conversation_id === conversationId);
}
