/**
 * Graph rail (2a) — left sidebar showing the current node's graph tree and
 * roots of other active graphs ("ELSEWHERE"). Gated on `node.graphRail`.
 * Alt+ArrowUp/Down cycles through the current graph's nodes.
 */

import { useEffect, type ReactNode } from 'react';
import { useCapability } from '../profile/provider.js';
import { useCanvasStore } from '../lib/use-canvas-store.js';
import { buildGraphTree } from '../lib/graph.js';
import { cn } from '@/lib/utils.js';
import type { NodeSummary } from '../../shared/protocol.js';

interface Props {
  currentId: string;
  onNavigate: (id: string) => void;
}

export function GraphRail({ currentId, onNavigate }: Props): ReactNode {
  const canRender = useCapability('node.graphRail');
  const { nodes } = useCanvasStore();

  const { thisGraph, otherGraphs } = buildGraphTree(nodes, currentId);

  // Alt+ArrowUp/Down: navigate thisGraph order
  useEffect(() => {
    if (!canRender) return;
    const handler = (e: KeyboardEvent): void => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const idx = thisGraph.findIndex((g) => g.node.node_id === currentId);
      if (idx === -1) return;
      e.preventDefault();
      const next =
        e.key === 'ArrowUp'
          ? thisGraph[idx - 1]
          : thisGraph[idx + 1];
      if (next) onNavigate(next.node.node_id);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canRender, thisGraph, currentId, onNavigate]);

  if (!canRender) return null;

  return (
    <aside
      className="flex w-[230px] shrink-0 flex-col overflow-y-auto border-r border-border bg-card/50 backdrop-blur-sm"
      style={{ zIndex: 1 }}
    >
      {/* THIS GRAPH */}
      <SectionHeader label="THIS GRAPH" kbdHint="⌥↑↓" />
      <div className="flex flex-col py-1">
        {thisGraph.map(({ node, depth }) => (
          <NodeRow
            key={node.node_id}
            node={node}
            depth={depth}
            current={node.node_id === currentId}
            onClick={() => onNavigate(node.node_id)}
          />
        ))}
        {thisGraph.length === 0 && (
          <span className="px-3 py-1 font-mono text-[10px] text-muted-foreground/40">—</span>
        )}
      </div>

      {/* ELSEWHERE */}
      {otherGraphs.length > 0 && (
        <>
          <SectionHeader label="ELSEWHERE" kbdHint="" />
          <div className="flex flex-col py-1">
            {otherGraphs.map((n) => (
              <NodeRow
                key={n.node_id}
                node={n}
                depth={0}
                current={false}
                elsewhere
                onClick={() => onNavigate(n.node_id)}
              />
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

function SectionHeader({ label, kbdHint }: { label: string; kbdHint: string }): ReactNode {
  return (
    <div className="instlabel flex items-center gap-1.5 border-b border-border/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60">
      {label}
      {kbdHint && (
        <kbd className="font-mono text-[9px] opacity-40">{kbdHint}</kbd>
      )}
    </div>
  );
}

function NodeRow({
  node,
  depth,
  current,
  elsewhere = false,
  onClick,
}: {
  node: NodeSummary;
  depth: number;
  current: boolean;
  elsewhere?: boolean;
  onClick: () => void;
}): ReactNode {
  const isDead =
    node.status === 'done' || node.status === 'dead' || node.status === 'canceled';
  const isActive = node.status === 'active';
  const hasAttention = node.attention_count > 0;

  return (
    <button
      type="button"
      className={cn(
        'group flex min-w-0 items-center gap-1.5 px-2 py-1 text-left text-xs transition-colors hover:bg-muted/40',
        current &&
          'border-l-2 bg-[var(--bone,hsl(45,20%,88%))]/15 border-[var(--bone,hsl(45,20%,88%))]',
        isDead && 'opacity-40',
      )}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      onClick={onClick}
    >
      {/* Status dot */}
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          isActive || elsewhere ? 'animate-pulse' : '',
        )}
        style={{
          backgroundColor: elsewhere
            ? 'var(--status-idle)'
            : `var(--status-${node.status})`,
        }}
      />
      {/* Name */}
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{node.name}</span>
      {/* Attention pill */}
      {hasAttention && (
        <span
          className="shrink-0 rounded px-1 py-0.5 font-mono text-[9px]"
          style={{
            color: 'var(--status-idle)',
            backgroundColor: 'color-mix(in srgb, var(--status-idle) 15%, transparent)',
          }}
        >
          ⚑{node.attention_count}
        </span>
      )}
    </button>
  );
}
