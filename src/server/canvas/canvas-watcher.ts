// CanvasWatcher (design D6, Flow 4) — ONE shared poller of `listNodes` +
// `asksAcrossCanvas`, run on an interval (~1.5s). Each poll builds the full
// `NodeSummary[]`, diffs it against the last snapshot, and — only when something
// changed — pushes a `CanvasMsg` to every subscribed `/ws/canvas` socket. The same
// last snapshot backs the `GET /api/canvas` poll-fallback. Cost is flat regardless
// of viewer count (one poller, fanned out). No per-node chrome here.

import { join } from "node:path";

import type { CanvasMsg, CanvasSnapshot, NodeSummary } from "../../shared/protocol.js";
import type { AskEntry, NodeMeta, NodeRow } from "../crouter-lib.js";
import { type NodeIdentityLike, nodeLastActivity, toNodeSummary } from "./chrome-assembler.js";

export interface CanvasWatcherDeps {
  listNodes: (filter?: { status?: NodeRow["status"] | NodeRow["status"][] }) => NodeRow[];
  asksAcrossCanvas: () => AskEntry[];
  /** Full node identity resolver (for `cycles` + the pi session-file path); optional.
   *  When absent, summaries omit `cycles` + `last_activity` (back-compat). */
  getNode?: (id: string) => NodeMeta | null;
  /** Node state-dir resolver (for the `meta.json` mtime fallback of `last_activity`). */
  nodeDir?: (id: string) => string;
  /** Poll interval in ms (design D6 ~1.5s). */
  intervalMs?: number;
  /** Clock injection for `generated_at` (tests). */
  now?: () => Date;
}

type Subscriber = (msg: CanvasMsg) => void;

/** Result of diffing two summary lists — drives the push decision. */
export interface CanvasDelta {
  added: string[];
  removed: string[];
  changed: string[];
  hasChanges: boolean;
}

/** Pure diff of two `NodeSummary` lists, keyed by node id. */
export function diffSummaries(prev: NodeSummary[], next: NodeSummary[]): CanvasDelta {
  const prevById = new Map(prev.map((n) => [n.node_id, n]));
  const nextById = new Map(next.map((n) => [n.node_id, n]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [id, n] of nextById) {
    const before = prevById.get(id);
    if (!before) added.push(id);
    else if (!summaryEqual(before, n)) changed.push(id);
  }
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) removed.push(id);
  }
  return {
    added,
    removed,
    changed,
    hasChanges: added.length > 0 || removed.length > 0 || changed.length > 0,
  };
}

function summaryEqual(a: NodeSummary, b: NodeSummary): boolean {
  return (
    a.name === b.name &&
    a.kind === b.kind &&
    a.mode === b.mode &&
    a.lifecycle === b.lifecycle &&
    a.status === b.status &&
    a.cwd === b.cwd &&
    a.parent === b.parent &&
    a.created === b.created &&
    a.host_kind === b.host_kind &&
    a.enterable === b.enterable &&
    a.attention_count === b.attention_count &&
    a.cycles === b.cycles
    // `last_activity` is intentionally excluded: it advances on every turn (session
    // mtime), so comparing it would defeat the change-only push and the client
    // derives a relative time from it regardless.
  );
}

export class CanvasWatcher {
  private readonly deps: CanvasWatcherDeps;
  private readonly intervalMs: number;
  private readonly now: () => Date;
  private readonly subscribers = new Set<Subscriber>();
  private last: CanvasSnapshot | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: CanvasWatcherDeps) {
    this.deps = deps;
    this.intervalMs = deps.intervalMs ?? 1500;
    this.now = deps.now ?? (() => new Date());
  }

  /** Begin the shared poll loop (idempotent). */
  start(): void {
    if (this.timer) return;
    this.pollOnce();
    this.timer = setInterval(() => this.pollOnce(), this.intervalMs);
    // Don't keep the process alive on the watcher alone.
    this.timer.unref?.();
  }

  /** Stop polling. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run one poll: build summaries, diff vs last, push a `CanvasMsg` to all
   * subscribers when (and only when) the snapshot changed. Returns the delta.
   */
  pollOnce(): CanvasDelta {
    const nodes = this.build();
    const isFirst = this.last === null;
    const delta = diffSummaries(this.last?.nodes ?? [], nodes);
    if (delta.hasChanges || isFirst) {
      this.last = { nodes, generated_at: this.now().toISOString() };
    }
    // The priming poll (no prior snapshot) never pushes — subscribers get the
    // current snapshot on subscribe; only real subsequent changes are pushed.
    if (delta.hasChanges && !isFirst) {
      const msg = this.toMsg();
      for (const send of this.subscribers) send(msg);
    }
    return delta;
  }

  /** The current snapshot for `GET /api/canvas` (polls once if never polled). */
  getSnapshot(): CanvasSnapshot {
    if (this.last === null) this.pollOnce();
    return this.last!;
  }

  /**
   * Subscribe a `/ws/canvas` client. The current snapshot is sent immediately;
   * subsequent changes are pushed by the poll loop. Returns an unsubscribe fn.
   */
  subscribe(send: Subscriber): () => void {
    // Prime the snapshot BEFORE registering so the priming poll can't fan out to us.
    const msg = this.toMsg();
    this.subscribers.add(send);
    send(msg);
    return () => {
      this.subscribers.delete(send);
    };
  }

  private toMsg(): CanvasMsg {
    const snap = this.getSnapshot();
    return { type: "canvas", nodes: snap.nodes, generated_at: snap.generated_at };
  }

  private build(): NodeSummary[] {
    const rows = this.deps.listNodes();
    const asks = this.deps.asksAcrossCanvas();
    // asksAcrossCanvas() is cwd-deduped; each entry is stamped with the node id it
    // is attributed to (the first node encountered for that cwd). Attribute by id.
    const byNode = new Map<string, number>();
    for (const a of asks) {
      if (a.node_id) byNode.set(a.node_id, a.count);
    }
    return rows.map((row) => {
      // The bare NodeRow lacks `cycles` + the session-file path; enrich from the
      // hydrated meta when a resolver is wired (one cheap read/stat per node, flat
      // in viewer count). Both fields are additive — absent resolver ⇒ omitted.
      const meta = this.deps.getNode?.(row.node_id) ?? null;
      const metaPath = this.deps.nodeDir ? join(this.deps.nodeDir(row.node_id), "meta.json") : null;
      const lastActivity = nodeLastActivity(meta?.pi_session_file, metaPath);
      const identity: NodeIdentityLike =
        meta?.cycles != null ? { ...row, cycles: meta.cycles } : row;
      return toNodeSummary(identity, byNode.get(row.node_id) ?? 0, lastActivity);
    });
  }
}
