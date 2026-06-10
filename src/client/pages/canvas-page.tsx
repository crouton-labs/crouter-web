/**
 * Canvas overview (spec §5.B). Renders the `subscribes_to` parent/child forest
 * with a distinct visual treatment per lifecycle status and a blocked-on-human
 * flag (attention_count > 0). Non-enterable nodes (host_kind !== 'broker') are
 * shown but marked with a reason and do not navigate; enterable nodes navigate
 * to /nodes/:id. A "Spawn a node" action (B.7/G.1) posts to rest.spawnNode —
 * the new node arrives via the canvas stream.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NodeMode, NodeSummary, SpawnRequest } from '../../shared/protocol.js';
import { RestError, spawnNode, getCanvas } from '../api/rest.js';
import { openCanvasSocket } from '../api/canvas-socket.js';
import type { CanvasSocket } from '../api/canvas-socket.js';
import { useServerStatus } from '../lib/server-status.js';
import { cn } from '@/lib/utils.js';
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
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

const NON_ENTERABLE_REASON = 'hosted in a tmux pane — open it in your terminal';
const POLL_INTERVAL_MS = 2000;

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

/** Self-managing canvas store hook. Connects on mount, disposes on unmount. */
function useCanvasStore(): { forest: ForestNode[]; generatedAt: string | null } {
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let wsLive = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let socket: CanvasSocket | null = null;

    const apply = (rows: NodeSummary[], at: string): void => {
      if (disposed) return;
      setNodes(rows);
      setGeneratedAt(at);
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

  return { forest: buildForest(nodes), generatedAt };
}

// ─── status color tokens ────────────────────────────────────────────────────

const statusColor = (status: string, blocked: boolean): string =>
  `var(--status-${blocked ? 'blocked' : status})`;

function StatusBadge({
  status,
  blocked,
}: {
  status: string;
  blocked: boolean;
}): React.ReactElement {
  return (
    <Badge
      variant="outline"
      className="font-mono text-xs"
      style={{ color: statusColor(status, blocked), borderColor: statusColor(status, blocked) + '66' }}
    >
      {status}
    </Badge>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

export function CanvasPage(): React.ReactElement {
  const { forest, generatedAt } = useCanvasStore();
  const [spawnOpen, setSpawnOpen] = useState(false);
  // Bumped on each open so the dialog remounts with fresh form state (matches
  // the SolidJS <Show> remount semantics; avoids a stale prefilled prompt).
  const [spawnKey, setSpawnKey] = useState(0);

  return (
    <div className="flex flex-col gap-4 p-4 min-h-0 overflow-auto">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-semibold">Canvas</h1>
        <div className="flex items-center gap-3">
          {generatedAt && (
            <span className="text-xs text-muted-foreground">
              updated {fmtTime(generatedAt)}
            </span>
          )}
          <Button size="sm" onClick={() => { setSpawnKey((k) => k + 1); setSpawnOpen(true); }}>
            Spawn a node
          </Button>
        </div>
      </header>

      {forest.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No nodes on the canvas yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {forest.map((fn) => (
            <ForestRow key={fn.node.node_id} node={fn} depth={0} />
          ))}
        </ul>
      )}

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

  const activate = (): void => {
    if (node.enterable) navigate(`/nodes/${encodeURIComponent(node.node_id)}`);
  };

  return (
    <li className="list-none" style={{ paddingLeft: `${depth * 1.25}rem` }}>
      {depth > 0 && (
        <div
          className="absolute w-px bg-border"
          style={{ left: `${(depth - 1) * 1.25 + 0.625}rem` }}
        />
      )}
      <Card
        className={cn(
          'relative flex flex-col gap-0 rounded-md border py-0 shadow-none transition-colors duration-100',
          node.enterable
            ? 'cursor-pointer hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring'
            : 'cursor-default',
          blocked && 'bg-[--status-blocked]/5',
        )}
        style={{ borderLeftColor: statusColor(node.status, blocked), borderLeftWidth: '2px' }}
        onClick={activate}
        role={node.enterable ? 'button' : undefined}
        tabIndex={node.enterable ? 0 : undefined}
        onKeyDown={(e) => {
          if (node.enterable && (e.key === 'Enter' || e.key === ' ')) activate();
        }}
      >
        {/* Primary row: name · kind · mode · status */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="font-medium text-sm min-w-0 truncate">{node.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">{node.kind}</span>
          <span className="text-xs text-muted-foreground/60 shrink-0">{node.mode}</span>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {blocked && (
              <span
                className="text-xs font-medium"
                style={{ color: 'var(--status-blocked)' }}
                title="blocked on a human ask"
              >
                ⚑ {node.attention_count} waiting on human
              </span>
            )}
            <StatusBadge status={node.status} blocked={blocked} />
          </div>
        </div>

        {/* Secondary row: cwd · lifecycle */}
        <div className="flex items-center justify-between gap-3 px-3 pb-1.5 border-t border-border/20">
          <span
            className="font-mono text-xs text-muted-foreground/60 min-w-0 truncate"
            title={node.cwd}
          >
            {node.cwd}
          </span>
          <span className="font-mono text-xs text-muted-foreground/40 shrink-0">
            {node.lifecycle}
          </span>
        </div>

        {/* Non-enterable notice */}
        {!node.enterable && (
          <div className="px-3 pb-1.5 text-xs text-muted-foreground/50 italic">
            {NON_ENTERABLE_REASON}
          </div>
        )}
      </Card>

      {fn.children.length > 0 && (
        <ul className="flex flex-col gap-1.5 mt-1.5 relative">
          {fn.children.map((child) => (
            <ForestRow key={child.node.node_id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
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
              value={mode || '__none__'}
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
