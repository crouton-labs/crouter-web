/**
 * Canvas overview (spec §5.B). Renders the `subscribes_to` parent/child forest
 * with a distinct visual treatment per lifecycle status and a blocked-on-human
 * flag (attention_count > 0). Non-enterable nodes (host_kind !== 'broker') are
 * shown but marked with a reason and do not navigate; enterable nodes navigate
 * to /nodes/:id. A "Spawn a node" action (B.7/G.1) posts to rest.spawnNode —
 * the new node arrives via the canvas stream.
 *
 * Quiet Instrument restyle (Phase 1): Fraunces header, live clock, status spine,
 * tree connector lines, pulse animations, NeedsYouStrip triage above the forest.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  NodeLifeStatus,
  NodeMode,
  NodeSummary,
  SpawnRequest,
} from '../../shared/protocol.js';
import { RestError, spawnNode } from '../net/rest.js';
import { useCanvasStore } from '../lib/use-canvas-store.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.js';
import { Textarea } from '@/components/ui/textarea.js';
import { NeedsYouStrip } from '../canvas/needs-you-strip.js';

/** Inline `--i` reveal-stagger var without fighting the CSSProperties type. */
const rvStyle = (i: number): React.CSSProperties => ({ ['--i' as string]: i }) as React.CSSProperties;

const NON_ENTERABLE_REASON = 'hosted in a tmux pane — open it in your terminal';

/** A node plus its resolved children (the `subscribes_to` forest, B.2). */
interface ForestNode {
  node: NodeSummary;
  children: ForestNode[];
}

/** Group nodes into a parent/child forest by their `parent` edge. */
function buildForest(nodes: NodeSummary[]): ForestNode[] {
  const byId = new Map<string, ForestNode>();
  for (const node of nodes) byId.set(node.node_id, { node, children: [] });
  const roots: ForestNode[] = [];
  for (const fn of byId.values()) {
    const parentId = fn.node.parent;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(fn);
    else roots.push(fn);
  }
  return roots;
}

// ─── filtering (§5.4) ──────────────────────────────────────────────

const STATUS_OPTIONS: NodeLifeStatus[] = ['active', 'idle', 'done', 'dead', 'canceled'];

interface CanvasFilter {
  query: string;
  status: NodeLifeStatus | 'all';
  blockedOnly: boolean;
}

const EMPTY_FILTER: CanvasFilter = { query: '', status: 'all', blockedOnly: false };

function isFilterActive(f: CanvasFilter): boolean {
  return f.query.trim() !== '' || f.status !== 'all' || f.blockedOnly;
}

/** True iff a node matches the active filter (free-text spans name/kind/mode/cwd/id/status). */
function matchesFilter(node: NodeSummary, f: CanvasFilter): boolean {
  if (f.status !== 'all' && node.status !== f.status) return false;
  if (f.blockedOnly && node.attention_count <= 0) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const haystack = `${node.name} ${node.kind} ${node.mode} ${node.cwd} ${node.node_id} ${node.status}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

/**
 * Keep every matching node plus its ancestor chain, so the forest stays a
 * coherent tree (a deep match still renders under its parents).
 */
function filterNodes(nodes: NodeSummary[], f: CanvasFilter): NodeSummary[] {
  if (!isFilterActive(f)) return nodes;
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const keep = new Set<string>();
  for (const node of nodes) {
    if (!matchesFilter(node, f)) continue;
    let cur: NodeSummary | undefined = node;
    while (cur && !keep.has(cur.node_id)) {
      keep.add(cur.node_id);
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
  }
  return nodes.filter((n) => keep.has(n.node_id));
}

// ─── status helpers ─────────────────────────────────────────────────────────

const DEAD_STATUSES = new Set<string>(['dead', 'canceled']);

// ─── live clock ─────────────────────────────────────────────────────────────

/** 24-hour HH:MM:SS, matching the QI mockup clock (`21:14:09`). */
function fmtClock(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

function useClock(): string {
  const [time, setTime] = useState(() => fmtClock(new Date()));
  useEffect(() => {
    const id = setInterval(() => setTime(fmtClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

// ─── page ────────────────────────────────────────────────────────────────────

export function CanvasPage(): React.ReactElement {
  const { nodes } = useCanvasStore();
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawnKey, setSpawnKey] = useState(0);
  const [filter, setFilter] = useState<CanvasFilter>(EMPTY_FILTER);
  const searchRef = useRef<HTMLInputElement>(null);
  const clock = useClock();

  const activeCount = nodes.filter((n) => n.status === 'active').length;

  const forest = useMemo(() => buildForest(filterNodes(nodes, filter)), [nodes, filter]);

  // `/` focuses the search box (unless already typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (typing) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="in relative z-[1] h-full min-h-0 overflow-auto"
      style={{ padding: '34px 44px 44px' }}
    >
      {/* ── canvas head ─────────────────────────────────────────────────── */}
      <div className="rv flex items-baseline gap-[18px]" style={rvStyle(1)}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 420,
            fontSize: '38px',
            letterSpacing: '-0.01em',
            fontVariationSettings: '"opsz" 60',
            color: 'var(--ink)',
          }}
        >
          Canvas
        </h1>
        <span style={{ color: 'var(--mut)', fontSize: '13px' }}>
          {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'}
          {activeCount > 0 && ` · ${activeCount} active`}
        </span>

        {/* live clock */}
        <div
          className="flex items-center gap-[9px]"
          style={{
            marginLeft: 'auto',
            fontFamily: 'var(--font-inst)',
            fontSize: '11px',
            color: 'var(--ink2)',
            letterSpacing: '0.1em',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--act)',
              animation: 'pulse 2.4s ease-out infinite',
            }}
          />
          <span>{clock}</span>
        </div>
      </div>

      {/* ── controls row ────────────────────────────────────────────────── */}
      <div
        className="rv flex items-center gap-[10px]"
        style={{ margin: '20px 0 22px', ...rvStyle(2) }}
      >
        {/* search */}
        <div className="search">
          <span style={{ fontSize: '12px' }}>⌕</span>
          <input
            ref={searchRef}
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.currentTarget.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilter((f) => ({ ...f, query: '' }));
                e.currentTarget.blur();
              }
            }}
            placeholder="Search name, kind, mode, cwd, id…"
            aria-label="Search nodes"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] outline-none"
            style={{ color: 'var(--ink)' }}
          />
          <span className="kbd">/</span>
        </div>

        {/* status filter */}
        <label className="selectish">
          <select
            value={filter.status}
            onChange={(e) =>
              setFilter((f) => ({ ...f, status: e.currentTarget.value as NodeLifeStatus | 'all' }))
            }
            aria-label="Filter by status"
            className="cursor-pointer appearance-none border-0 bg-transparent text-[13px] outline-none"
            style={{ color: 'var(--ink2)', fontFamily: 'inherit' }}
          >
            <option value="all">all statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="car">▾</span>
        </label>

        {/* blocked checkbox */}
        <label className="checkish select-none">
          <span
            className="box"
            style={
              filter.blockedOnly
                ? { background: 'var(--blk)', borderColor: 'var(--blk)' }
                : undefined
            }
          />
          blocked
          <input
            type="checkbox"
            checked={filter.blockedOnly}
            onChange={(e) => setFilter((f) => ({ ...f, blockedOnly: e.currentTarget.checked }))}
            className="sr-only"
          />
        </label>

        <button
          type="button"
          className="btn primary"
          style={{ marginLeft: 'auto' }}
          onClick={() => {
            setSpawnKey((k) => k + 1);
            setSpawnOpen(true);
          }}
        >
          + Spawn a node
        </button>
      </div>

      {/* triage strip — renders nothing when no blocked decks */}
      <NeedsYouStrip />

      {/* ── node forest ─────────────────────────────────────────────────── */}
      <div className="panel rv" style={{ padding: '6px 0', ...rvStyle(4) }}>
        <div
          className="flex items-center"
          style={{ padding: '10px 18px 9px', borderBottom: '1px solid var(--line)' }}
        >
          <span className="instlabel" style={{ color: 'var(--dim)' }}>
            Node forest
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-inst)',
              fontSize: '9px',
              color: 'var(--dim)',
              letterSpacing: '0.1em',
            }}
          >
            sorted · activity
          </span>
        </div>
        <div className="tree">
          {nodes.length === 0 ? (
            <p className="px-3 py-2 text-sm italic" style={{ color: 'var(--mut)' }}>
              No nodes on the canvas yet.
            </p>
          ) : forest.length === 0 ? (
            <p className="px-3 py-2 text-sm italic" style={{ color: 'var(--mut)' }}>
              No matching nodes.
            </p>
          ) : (
            forest.map((fn) => <ForestRow key={fn.node.node_id} node={fn} />)
          )}
        </div>
      </div>

      <SpawnDialog key={spawnKey} open={spawnOpen} onClose={() => setSpawnOpen(false)} />
    </div>
  );
}

// ─── forest row ──────────────────────────────────────────────────────────────

function ForestRow({ node: fn }: { node: ForestNode }): React.ReactElement {
  const navigate = useNavigate();
  const node = fn.node;
  const blocked = node.attention_count > 0;
  const dim = DEAD_STATUSES.has(node.status);
  const spineStatus = blocked ? 'blocked' : node.status;

  const activate = (): void => {
    if (node.enterable) navigate(`/nodes/${encodeURIComponent(node.node_id)}`);
  };

  return (
    <>
      <div
        className={cn(`node-row s-${spineStatus}`, dim && 'dimmed')}
        onClick={activate}
        role={node.enterable ? 'button' : undefined}
        tabIndex={node.enterable ? 0 : undefined}
        style={node.enterable ? undefined : { cursor: 'default' }}
        onKeyDown={(e) => {
          if (node.enterable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            activate();
          }
        }}
      >
        <div className="node-id">
          <div className="node-l1">
            <span className="node-name">{node.name}</span>
            <span className="node-kind">
              {node.kind} · {node.mode}
            </span>
          </div>
          <div className="node-l2">
            <span className="node-cwd" title={node.cwd}>
              {node.cwd}
            </span>
            {node.lifecycle && <span className="node-life">{node.lifecycle}</span>}
            {!node.enterable && <span className="node-note">{NON_ENTERABLE_REASON}</span>}
          </div>
        </div>
        <div className="node-right">
          {blocked && (
            <span className="waitflag">⚑ {node.attention_count} waiting on human</span>
          )}
          <StatusBadge status={node.status} blocked={blocked} />
        </div>
      </div>

      {fn.children.length > 0 && (
        <div className="kids">
          {fn.children.map((child) => (
            <ForestRow key={child.node.node_id} node={child} />
          ))}
        </div>
      )}
    </>
  );
}

// ─── status badge ────────────────────────────────────────────────────────────

// The badge keeps the node's real lifecycle status; only the dot flips to the
// blocked treatment (pulsing ember) when the node is waiting on a human.
function StatusBadge({
  status,
  blocked,
}: {
  status: string;
  blocked: boolean;
}): React.ReactElement {
  return (
    <span className={`badge ${status}`}>
      <span className={`dot ${blocked ? 'blocked' : status}`} />
      {status}
    </span>
  );
}

// ─── spawn dialog (B.7 / G.1) ────────────────────────────────────────────────

function SpawnDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState('developer');
  const [mode, setMode] = useState<NodeMode | ''>('');
  const [root, setRoot] = useState(false);
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!prompt.trim() || !kind.trim()) {
      setError('prompt and kind are required');
      return;
    }
    setBusy(true);
    setError(null);
    const req: SpawnRequest = {
      prompt: prompt.trim(),
      kind: kind.trim(),
      ...(mode ? { mode: mode as NodeMode } : {}),
      ...(root ? { root: true } : {}),
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(parent.trim() ? { parent: parent.trim() } : {}),
    };
    try {
      await spawnNode(req);
      onClose(); // the node surfaces via the canvas stream
    } catch (err) {
      console.error('[spawn] failed:', err);
      setError(err instanceof RestError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md overflow-y-auto max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle>Spawn a node</DialogTitle>
        </DialogHeader>

        <form id="spawn-form" onSubmit={submit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spawn-prompt">Prompt</Label>
            <Textarea
              id="spawn-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.currentTarget.value)}
              rows={4}
              required
              className="resize-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spawn-kind">Kind</Label>
            <Input
              id="spawn-kind"
              value={kind}
              onChange={(e) => setKind(e.currentTarget.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spawn-mode">Mode</Label>
            <Select
              value={mode !== '' ? mode : '__none__'}
              onValueChange={(v) => setMode(v === '__none__' ? '' : (v as NodeMode))}
            >
              <SelectTrigger id="spawn-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">(default)</SelectItem>
                <SelectItem value="base">base</SelectItem>
                <SelectItem value="orchestrator">orchestrator</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="spawn-root"
              checked={root}
              onChange={(e) => setRoot(e.currentTarget.checked)}
              className="size-4 rounded border border-input accent-primary"
            />
            <Label htmlFor="spawn-root" className="cursor-pointer">
              Resident root node
            </Label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spawn-cwd">cwd</Label>
            <Input
              id="spawn-cwd"
              value={cwd}
              onChange={(e) => setCwd(e.currentTarget.value)}
              placeholder="(inherit)"
              className="font-mono text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spawn-name">Name</Label>
            <Input
              id="spawn-name"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="(auto)"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spawn-model">Model</Label>
            <Input
              id="spawn-model"
              value={model}
              onChange={(e) => setModel(e.currentTarget.value)}
              placeholder="(default)"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spawn-parent">Parent node id</Label>
            <Input
              id="spawn-parent"
              value={parent}
              onChange={(e) => setParent(e.currentTarget.value)}
              placeholder="(this canvas root)"
              className="font-mono text-sm"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="spawn-form" disabled={busy}>
            {busy ? 'Spawning…' : 'Spawn'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


