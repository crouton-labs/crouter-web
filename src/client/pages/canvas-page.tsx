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
import { RestError, spawnNode } from '../api/rest.js';
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
import { Search, X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.js';
import { Textarea } from '@/components/ui/textarea.js';
import { NeedsYouStrip } from '../canvas/needs-you-strip.js';

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

const statusColor = (status: string, blocked: boolean): string =>
  `var(--status-${blocked ? 'blocked' : status})`;

const DEAD_STATUSES = new Set<string>(['dead', 'canceled']);

// ─── live clock ─────────────────────────────────────────────────────────────

function useClock(): string {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

// ─── page ────────────────────────────────────────────────────────────────────

export function CanvasPage(): React.ReactElement {
  const { nodes, generatedAt } = useCanvasStore();
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
    <div className="relative z-[1] flex h-full min-h-0 flex-col">
      {/* ── canvas header ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 shrink-0 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="mb-3 flex items-end justify-between gap-4">
          {/* title */}
          <div>
            <h1
              className="leading-none tracking-tight"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '38px',
                fontWeight: 420,
                color: 'var(--foreground)',
              }}
            >
              Canvas
            </h1>
            <p className="instlabel mt-1">
              {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'}
              {activeCount > 0 && ` · ${activeCount} active`}
            </p>
          </div>

          {/* live clock */}
          <div className="flex items-center gap-2 pb-0.5">
            {/* pulsing active dot */}
            <span
              className="size-1.5 rounded-full shrink-0"
              style={{
                backgroundColor: 'var(--status-active)',
                animation: 'pulse-active 2.4s ease-out infinite',
              }}
            />
            <span
              style={{
                fontFamily: 'var(--font-inst)',
                fontSize: '11px',
                color: 'var(--muted-foreground)',
                letterSpacing: '0.06em',
              }}
            >
              {clock}
            </span>
          </div>
        </div>

        {/* controls row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* search */}
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
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
              className="h-8 pl-7 pr-7 font-mono text-xs"
            />
            {filter.query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setFilter((f) => ({ ...f, query: '' }))}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
            {/* / kbd hint when empty */}
            {!filter.query && (
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                <kbd
                  className="rounded border border-border px-1 py-px text-muted-foreground/40"
                  style={{ fontFamily: 'var(--font-inst)', fontSize: '9px' }}
                >
                  /
                </kbd>
              </span>
            )}
          </div>

          {/* status filter */}
          <Select
            value={filter.status}
            onValueChange={(v) =>
              setFilter((f) => ({ ...f, status: v as NodeLifeStatus | 'all' }))
            }
          >
            <SelectTrigger size="sm" className="h-8 w-[8.5rem] font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">all statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* blocked checkbox */}
          <label className="flex items-center gap-1.5 select-none instlabel cursor-pointer">
            <input
              type="checkbox"
              checked={filter.blockedOnly}
              onChange={(e) => setFilter((f) => ({ ...f, blockedOnly: e.currentTarget.checked }))}
              className="size-3.5 rounded border border-input accent-primary"
            />
            blocked
          </label>

          {/* snapshot time */}
          {generatedAt && (
            <span
              className="shrink-0"
              style={{
                fontFamily: 'var(--font-inst)',
                fontSize: '9px',
                color: 'var(--muted-foreground)',
                opacity: 0.6,
              }}
            >
              {fmtTime(generatedAt)}
            </span>
          )}

          {/* spawn */}
          <Button
            size="sm"
            className="h-8 shrink-0"
            onClick={() => {
              setSpawnKey((k) => k + 1);
              setSpawnOpen(true);
            }}
          >
            Spawn a node
          </Button>
        </div>
      </header>

      {/* ── body ────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {/* triage strip — renders nothing when no blocked decks */}
        <NeedsYouStrip />

        {/* forest */}
        {nodes.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No nodes on the canvas yet.</p>
        ) : forest.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No matching nodes.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {forest.map((fn) => (
              <ForestRow key={fn.node.node_id} node={fn} depth={0} />
            ))}
          </ul>
        )}
      </div>

      <SpawnDialog key={spawnKey} open={spawnOpen} onClose={() => setSpawnOpen(false)} />
    </div>
  );
}

// ─── forest row ──────────────────────────────────────────────────────────────

function ForestRow({
  node: fn,
  depth,
}: {
  node: ForestNode;
  depth: number;
}): React.ReactElement {
  const navigate = useNavigate();
  const node = fn.node;
  const blocked = node.attention_count > 0;
  const dim = DEAD_STATUSES.has(node.status);

  const activate = (): void => {
    if (node.enterable) navigate(`/nodes/${encodeURIComponent(node.node_id)}`);
  };

  const spineColor = statusColor(node.status, blocked);

  return (
    <li className="list-none" style={{ paddingLeft: depth > 0 ? `${depth * 1.5}rem` : undefined }}>
      {/* tree guide line + stub for children */}
      {depth > 0 && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: `${(depth - 1) * 1.5 + 0.625}rem`,
            top: 0,
            bottom: 0,
            width: '1px',
            background: 'var(--border)',
          }}
        />
      )}

      {/* node row card */}
      <div
        className={cn(
          'relative flex flex-col gap-0 rounded-md border transition-colors duration-100',
          node.enterable
            ? 'cursor-pointer hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            : 'cursor-default',
          blocked && 'bg-[color:var(--status-blocked)]/5',
          dim && 'opacity-60',
        )}
        style={{
          background: 'var(--card)',
          borderColor: 'var(--border)',
          borderLeftColor: spineColor,
          borderLeftWidth: '2px',
        }}
        onClick={activate}
        role={node.enterable ? 'button' : undefined}
        tabIndex={node.enterable ? 0 : undefined}
        onKeyDown={(e) => {
          if (node.enterable && (e.key === 'Enter' || e.key === ' ')) activate();
        }}
      >
        {/* primary row: name · kind · mode */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm font-semibold',
              dim && 'text-muted-foreground',
            )}
          >
            {node.name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground/70">{node.kind}</span>
          <span className="shrink-0 text-xs text-muted-foreground/40">{node.mode}</span>

          {/* right cluster */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* ⚑ waiting pill */}
            {blocked && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                style={{
                  background: 'oklch(0.66 0.21 33 / 14%)',
                  color: 'var(--status-blocked)',
                }}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{
                    backgroundColor: 'var(--status-blocked)',
                    animation: 'pulse-blocked 1.6s ease-out infinite',
                  }}
                />
                <span
                  style={{ fontFamily: 'var(--font-inst)', fontSize: '9px', letterSpacing: '0.12em' }}
                >
                  ⚑ {node.attention_count} WAITING
                </span>
              </span>
            )}

            {/* status badge */}
            <StatusBadge status={node.status} blocked={blocked} />
          </div>
        </div>

        {/* secondary row: cwd · lifecycle · non-enterable note */}
        <div className="flex items-center gap-3 border-t border-border/20 px-3 pb-1.5 pt-1">
          <span
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground/50"
            style={{ fontFamily: 'var(--font-code)' }}
            title={node.cwd}
          >
            {node.cwd}
          </span>
          <span className="instlabel shrink-0">{node.lifecycle}</span>
          {!node.enterable && (
            <span className="shrink-0 text-xs italic text-muted-foreground/40">
              {NON_ENTERABLE_REASON}
            </span>
          )}
        </div>
      </div>

      {/* children with connector stubs */}
      {fn.children.length > 0 && (
        <ul className="relative mt-1.5 flex flex-col gap-1.5">
          {fn.children.map((child) => (
            <ForestRow key={child.node.node_id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ─── status badge ────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  blocked,
}: {
  status: string;
  blocked: boolean;
}): React.ReactElement {
  const color = statusColor(status, blocked);
  const isActive = status === 'active' && !blocked;
  const isBlocked = blocked;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5"
      style={{
        borderColor: color + '44',
        background: color + '14',
        color,
      }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{
          backgroundColor: color,
          animation: isBlocked
            ? 'pulse-blocked 1.6s ease-out infinite'
            : isActive
              ? 'pulse-active 2.4s ease-out infinite'
              : undefined,
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-inst)',
          fontSize: '9px',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        {blocked ? 'blocked' : status}
      </span>
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

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}
