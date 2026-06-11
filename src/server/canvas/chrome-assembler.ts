// ChromeAssembler (design D12, spec F.*) — builds a `NodeDetail` (identity + chrome)
// for one node, from EITHER a live broker snapshot (stats + state) OR a dormant
// node's persisted telemetry + (optionally) the static-session parse. Merges the
// git branch (via GitBranchCache) and presence. Honors the F.4 dormant omissions:
// a dormant node shows model + token burn + raw context tokens, but NOT tool-call
// activity, context-usage percent, or live session stats (those only come live or,
// for stats, from the static parse).

import { statSync } from "node:fs";
import { join } from "node:path";

import type { GitStatus, NodeDetail, NodeSummary, Presence, SessionStatsSummary } from "../../shared/protocol.js";
import type { BrokerSnapshot, NodeMeta, SessionStats, Telemetry } from "../crouter-lib.js";
import type { NormalizedDormantSession } from "../static-session/normalizer.js";

/** A node's queryable identity shape, common to `NodeRow` (listNodes) and `NodeMeta` (getNode). */
export interface NodeIdentityLike {
  node_id: string;
  name: string;
  kind: string;
  mode: NodeSummary["mode"];
  lifecycle: NodeSummary["lifecycle"];
  status: NodeSummary["status"];
  cwd: string;
  host_kind?: "tmux" | "broker" | null;
  parent?: string | null;
  created: string;
  /** Canvas cycle count (revive generations). Present on `NodeMeta`; absent on a
   *  bare `NodeRow`, in which case the summary omits it (back-compat). */
  cycles?: number;
}

/** Map a crouter node identity row to the wire `NodeSummary` (spec §6.1). The
 *  optional `lastActivity` (ISO) is sourced by the caller via {@link nodeLastActivity};
 *  both `cycles` and `last_activity` are emitted only when known. */
export function toNodeSummary(
  node: NodeIdentityLike,
  attentionCount: number,
  lastActivity?: string,
): NodeSummary {
  const host_kind = node.host_kind === "broker" ? "broker" : "tmux";
  const summary: NodeSummary = {
    node_id: node.node_id,
    name: node.name,
    kind: node.kind,
    mode: node.mode,
    lifecycle: node.lifecycle,
    status: node.status,
    cwd: node.cwd,
    parent: node.parent ?? null,
    created: node.created,
    host_kind,
    enterable: host_kind === "broker",
    attention_count: attentionCount,
  };
  if (typeof node.cycles === "number") summary.cycles = node.cycles;
  if (lastActivity) summary.last_activity = lastActivity;
  return summary;
}

/** Cheapest available "most recent work" timestamp for a node, or undefined when
 *  unknown. Prefers the pi session `.jsonl` mtime (the broker rewrites it every
 *  turn), then the node's `meta.json` mtime. Stat-only — never reads a file — and
 *  tolerant: any missing/unreadable candidate is skipped, so a node with neither
 *  simply omits the field. */
export function nodeLastActivity(
  sessionFile: string | null | undefined,
  metaPath: string | null | undefined,
): string | undefined {
  for (const p of [sessionFile, metaPath]) {
    if (!p) continue;
    try {
      return statSync(p).mtime.toISOString();
    } catch {
      // missing/unreadable → fall through to the next candidate
    }
  }
  return undefined;
}

/** The live chrome inputs the hub hands the assembler for an entered node. */
export interface LiveChromeInput {
  stats: SessionStats;
  state: BrokerSnapshot["state"];
}

export interface ChromeAssemblerDeps {
  getNode: (id: string) => NodeMeta | null;
  /** Node state-dir resolver, for the `meta.json` mtime fallback of `last_activity`. */
  nodeDir?: (id: string) => string;
  readTelemetry: (id: string) => Telemetry;
  /** Branch resolver (GitBranchCache.getBranch.bind(cache)). */
  getBranch: (cwd: string) => Promise<string | null>;
  /** Working-tree status resolver (GitStatusCache.getStatus.bind(cache)); optional. */
  getStatus?: (cwd: string) => Promise<GitStatus | null>;
  /** Live snapshot from the session hub when a broker is connected; absent ⇒ dormant. */
  getLiveSnapshot?: (id: string) => LiveChromeInput | null;
  /** Presence reader (server tab count blended with attach.json); null when unknown. */
  getPresence?: (id: string) => Presence | null;
  /** Pending human-ask count for the node; defaults to 0. */
  getAttention?: (id: string) => number;
  /** Static-session parse for a dormant node, to derive session stats (F.4). */
  normalizeDormant?: (id: string) => Promise<NormalizedDormantSession | null>;
}

export class ChromeAssembler {
  constructor(private readonly deps: ChromeAssemblerDeps) {}

  /** Build the full `NodeDetail` for `id`, or `null` when the node is unknown (route → 404). */
  async assemble(id: string): Promise<NodeDetail | null> {
    const node = this.deps.getNode(id);
    if (!node) return null;

    const attention = this.deps.getAttention?.(id) ?? 0;
    const metaPath = this.deps.nodeDir ? join(this.deps.nodeDir(id), "meta.json") : null;
    const lastActivity = nodeLastActivity(node.pi_session_file, metaPath);
    const summary = toNodeSummary(node, attention, lastActivity);
    const branch = await this.deps.getBranch(node.cwd);
    const gitStatus = this.deps.getStatus ? await this.deps.getStatus(node.cwd).catch(() => null) : null;
    const presence = this.deps.getPresence?.(id) ?? null;

    const live = node.host_kind === "broker" ? this.deps.getLiveSnapshot?.(id) ?? null : null;
    if (live) {
      return this.assembleLive(summary, branch, presence, live, gitStatus);
    }
    const telemetry = this.deps.readTelemetry(id);
    const staticSession = this.deps.normalizeDormant
      ? await this.deps.normalizeDormant(id).catch(() => null)
      : null;
    return this.assembleDormant(summary, branch, presence, telemetry, staticSession, gitStatus);
  }

  /** Live chrome from a broker snapshot's stats + state. */
  assembleLive(
    summary: NodeSummary,
    branch: string | null,
    presence: Presence | null,
    input: LiveChromeInput,
    gitStatus: GitStatus | null = null,
  ): NodeDetail {
    const { stats, state } = input;
    const context =
      stats.contextUsage && stats.contextUsage.tokens != null
        ? {
            tokens: stats.contextUsage.tokens,
            window: stats.contextUsage.contextWindow,
            percent: stats.contextUsage.percent ?? 0,
          }
        : null;
    const sessionStats: SessionStatsSummary = {
      // pi's SessionStats has no explicit turn counter; user messages are the
      // closest proxy (one user prompt opens one turn).
      turns: stats.userMessages,
      user_messages: stats.userMessages,
      assistant_messages: stats.assistantMessages,
      cost: stats.cost,
    };
    return {
      ...summary,
      branch,
      model: state.model ?? null,
      tokens: {
        input: stats.tokens.input,
        output: stats.tokens.output,
        cache: stats.tokens.cacheRead || undefined,
      },
      context,
      tool_calls: stats.toolCalls,
      stats: sessionStats,
      presence,
      live: true,
      git_status: gitStatus,
    };
  }

  /** Dormant chrome from persisted telemetry (+ optional static-session stats), per F.4. */
  assembleDormant(
    summary: NodeSummary,
    branch: string | null,
    presence: Presence | null,
    telemetry: Telemetry,
    staticSession: NormalizedDormantSession | null,
    gitStatus: GitStatus | null = null,
  ): NodeDetail {
    // Raw context-token count without a window denominator (F.4): window===0 is the
    // convention that signals "tokens known, percent unknown" to the client.
    const context =
      telemetry.context_tokens != null
        ? { tokens: telemetry.context_tokens, window: 0, percent: 0 }
        : null;
    const stats = staticSession ? deriveStaticStats(staticSession) : null;
    return {
      ...summary,
      branch,
      model: staticSession?.model ?? telemetry.model ?? null,
      tokens:
        telemetry.tokens_in != null || telemetry.tokens_out != null
          ? { input: telemetry.tokens_in ?? 0, output: telemetry.tokens_out ?? 0 }
          : null,
      context,
      // F.4 omissions: no tool-call activity for a dormant node.
      tool_calls: null,
      stats,
      presence,
      live: false,
      git_status: gitStatus,
    };
  }
}

/** Derive coarse session stats from a dormant node's parsed history (F.4). */
function deriveStaticStats(session: NormalizedDormantSession): SessionStatsSummary {
  let user = 0;
  let assistant = 0;
  for (const m of session.history) {
    if (m && typeof m === "object" && "role" in m) {
      if (m.role === "user") user++;
      else if (m.role === "assistant") assistant++;
    }
  }
  return { turns: user, user_messages: user, assistant_messages: assistant };
}
