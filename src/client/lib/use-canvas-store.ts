/**
 * Shared canvas-snapshot store hook. Connects to the canvas WebSocket on mount
 * (falling back to polling `GET /api/canvas` while the socket is down) and
 * exposes the live node forest as plain reactive values. Both the Operator
 * canvas and the Studio Conversations list / ActivityRail read the same forest
 * from here — the canvas snapshot is the one source of truth for "what nodes
 * exist", regardless of how a profile renders them.
 */

import { useState, useEffect } from 'react';
import type { NodeSummary } from '../../shared/protocol.js';
import { getCanvas } from '../net/rest.js';
import { openCanvasSocket, type CanvasSocket } from '../net/canvas-socket.js';
import { useServerStatus } from './server-status.js';

const POLL_INTERVAL_MS = 2000;

export interface CanvasStore {
  nodes: NodeSummary[];
  generatedAt: string | null;
  /** True until the first snapshot (socket or poll) has been applied. */
  loading: boolean;
}

/** Self-managing canvas store hook. Connects on mount, disposes on unmount. */
export function useCanvasStore(): CanvasStore {
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let wsLive = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let socket: CanvasSocket | null = null;

    const apply = (rows: NodeSummary[], at: string): void => {
      if (disposed) return;
      setNodes(rows);
      setGeneratedAt(at);
      setLoading(false);
    };

    const poll = async (): Promise<void> => {
      if (disposed || wsLive) return;
      try {
        const snap = await getCanvas();
        if (!wsLive && !disposed) apply(snap.nodes, snap.generated_at);
      } catch {
        /* transient — the next interval retries */
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

    startPolling();

    socket = openCanvasSocket({
      onMessage: (msg) => apply(msg.nodes, msg.generated_at),
      onOpen: () => {
        wsLive = true;
        useServerStatus.getState().setReachable(true);
        stopPolling();
      },
      onClose: () => {
        wsLive = false;
        useServerStatus.getState().setReachable(false);
        startPolling();
      },
    });

    return () => {
      disposed = true;
      stopPolling();
      socket?.close();
    };
  }, []);

  return { nodes, generatedAt, loading };
}
