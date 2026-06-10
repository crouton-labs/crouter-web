/**
 * Canvas store: opens the canvas WS and exposes the node list + a parent/child
 * forest for the overview. Falls back to polling `GET /api/canvas` every ~2s if
 * the WS drops or is unavailable (spec §6.3 — the freshness contract holds
 * either way). The WS transport is fire-and-forget; the polling fallback lives
 * here because only the store knows whether the WS is feeding it.
 */

import { createSignal } from 'solid-js';
import type { NodeSummary } from '../../shared/protocol.js';
import { getCanvas } from '../api/rest.js';
import { openCanvasSocket, type CanvasSocket } from '../api/canvas-socket.js';

/** A node plus its resolved children (the `subscribes_to` forest, B.2). */
export interface ForestNode {
  node: NodeSummary;
  children: ForestNode[];
}

const POLL_INTERVAL_MS = 2000;

export interface CanvasStoreOptions {
  /** Notified true on canvas-WS open, false on close — drives the shell banner. */
  onConnectivity?: (up: boolean) => void;
}

export interface CanvasStore {
  nodes: () => NodeSummary[];
  generatedAt: () => string | null;
  /** Parent/child forest built from `parent` edges (roots first). */
  forest: () => ForestNode[];
  connect: () => void;
  dispose: () => void;
}

/** Build the canvas store. Call `connect()` to start streaming/polling. */
export function createCanvasStore(opts: CanvasStoreOptions = {}): CanvasStore {
  const [nodes, setNodes] = createSignal<NodeSummary[]>([]);
  const [generatedAt, setGeneratedAt] = createSignal<string | null>(null);

  let socket: CanvasSocket | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let wsLive = false;
  let disposed = false;

  const apply = (rows: NodeSummary[], at: string): void => {
    setNodes(rows);
    setGeneratedAt(at);
  };

  const poll = async (): Promise<void> => {
    if (disposed || wsLive) return;
    try {
      const snap = await getCanvas();
      if (!wsLive) apply(snap.nodes, snap.generated_at);
    } catch {
      // transient — the next interval retries
    }
  };

  const startPolling = (): void => {
    if (pollTimer || disposed) return;
    void poll();
    pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  };

  const stopPolling = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  return {
    nodes,
    generatedAt,
    forest: () => buildForest(nodes()),
    connect() {
      if (socket || disposed) return;
      // Start polling immediately for first paint; the WS supersedes it on open.
      startPolling();
      socket = openCanvasSocket({
        onMessage: (msg) => apply(msg.nodes, msg.generated_at),
        onOpen: () => {
          wsLive = true;
          opts.onConnectivity?.(true);
          stopPolling();
        },
        onClose: () => {
          wsLive = false;
          opts.onConnectivity?.(false);
          startPolling();
        },
      });
    },
    dispose() {
      disposed = true;
      stopPolling();
      socket?.close();
      socket = null;
    },
  };
}

/** Group nodes into a parent/child forest by their `parent` edge. */
export function buildForest(nodes: NodeSummary[]): ForestNode[] {
  const byId = new Map<string, ForestNode>();
  for (const node of nodes) byId.set(node.node_id, { node, children: [] });

  const roots: ForestNode[] = [];
  for (const fn of byId.values()) {
    const parentId = fn.node.parent;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(fn);
    else roots.push(fn); // root, or parent not on the canvas
  }
  return roots;
}
