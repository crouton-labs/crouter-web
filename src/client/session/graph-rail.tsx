/**
 * Graph rail (2a) — left sidebar showing the current node's graph tree and
 * roots of other active graphs ("ELSEWHERE"). Gated on `node.graphRail`.
 * Alt+ArrowUp/Down cycles through the current graph's nodes. Quiet Instrument:
 * `.graphrail` column with `.gr-sec` headings, `.gnode` rows (`.cur` current,
 * `.dimmed` dead), `.gd` status dots, `.gflag` blocked/attention pills.
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
    <aside className="graphrail rv" style={GRAPHRAIL}>
      {/* THIS GRAPH */}
      <SectionHeader label="This graph" kbdHint="⌥↑↓" />
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
        <span className="px-[9px] py-1 font-mono text-[10px]" style={{ color: 'var(--dim)' }}>
          —
        </span>
      )}

      {/* ELSEWHERE */}
      {otherGraphs.length > 0 && (
        <>
          <div className="gr-gap" />
          <SectionHeader label="Elsewhere" />
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
        </>
      )}
    </aside>
  );
}

// `.graphrail` carries no CSS — the column geometry lives here (mockup: 228px,
// padding 14px 9px, right rule, faint inset background).
const GRAPHRAIL = {
  width: '228px',
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  borderRight: '1px solid var(--line)',
  background: 'rgba(0,0,0,.16)',
  padding: '14px 9px',
  overflowY: 'auto',
  zIndex: 1,
  ['--i' as string]: 2,
} as const;

function SectionHeader({ label, kbdHint }: { label: string; kbdHint?: string }): ReactNode {
  return (
    <div className="gr-sec">
      <span className="instlabel">{label}</span>
      <div className="rule" />
      {kbdHint && <span className="hint">{kbdHint}</span>}
    </div>
  );
}

const DEPTH_CLASS: Record<number, string> = { 1: 'g1', 2: 'g2' };

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
  const blocked = node.attention_count > 0;

  // g1/g2 atoms cover the first two levels; deeper nesting falls back to an
  // inline indent (14px per level) so the tree never collapses.
  const depthClass = DEPTH_CLASS[depth];
  const depthStyle =
    depth > 2 ? { marginLeft: `${depth * 14}px` } : undefined;

  return (
    <button
      type="button"
      className={cn('gnode', depthClass, current && 'cur', isDead && 'dimmed')}
      style={depthStyle}
      onClick={onClick}
    >
      <span
        className={cn('gd', (isActive && elsewhere) && 'dot active')}
        style={
          blocked
            ? { background: 'var(--blk)', boxShadow: '0 0 7px rgba(255,94,54,.5)' }
            : { background: `var(--status-${node.status})` }
        }
      />
      <span className="gname">{node.name}</span>
      {blocked && <span className="gflag">⚑ {node.attention_count}</span>}
    </button>
  );
}
