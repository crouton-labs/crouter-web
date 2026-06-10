// ChromeAssembler (design D12, spec F.*) — builds a `NodeDetail` (identity + chrome)
// for one node, from EITHER a live broker snapshot (stats + state) OR a dormant
// node's persisted telemetry + (optionally) the static-session parse. Merges the
// git branch (via GitBranchCache) and presence. Honors the F.4 dormant omissions:
// a dormant node shows model + token burn + raw context tokens, but NOT tool-call
// activity, context-usage percent, or live session stats (those only come live or,
// for stats, from the static parse).

import type { NodeDetail, NodeSummary, Presence, SessionStatsSummary } from "../../shared/protocol.js";
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
}

/** Map a crouter node identity row to the wire `NodeSummary` (spec §6.1). */
export function toNodeSummary(node: NodeIdentityLike, attentionCount: number): NodeSummary {
  const host_kind = node.host_kind === "broker" ? "broker" : "tmux";
  return {
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
}

/** The live chrome inputs the hub hands the assembler for an entered node. */
export interface LiveChromeInput {
  stats: SessionStats;
  state: BrokerSnapshot["state"];
}

export interface ChromeAssemblerDeps {
  getNode: (id: string) => NodeMeta | null;
  readTelemetry: (id: string) => Telemetry;
  /** Branch resolver (GitBranchCache.getBranch.bind(cache)). */
  getBranch: (cwd: string) => Promise<string | null>;
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
    const summary = toNodeSummary(node, attention);
    const branch = await this.deps.getBranch(node.cwd);
    const presence = this.deps.getPresence?.(id) ?? null;

    const live = node.host_kind === "broker" ? this.deps.getLiveSnapshot?.(id) ?? null : null;
    if (live) {
      return this.assembleLive(summary, branch, presence, live);
    }
    const telemetry = this.deps.readTelemetry(id);
    const staticSession = this.deps.normalizeDormant
      ? await this.deps.normalizeDormant(id).catch(() => null)
      : null;
    return this.assembleDormant(summary, branch, presence, telemetry, staticSession);
  }

  /** Live chrome from a broker snapshot's stats + state. */
  assembleLive(
    summary: NodeSummary,
    branch: string | null,
    presence: Presence | null,
    input: LiveChromeInput,
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
    };
  }

  /** Dormant chrome from persisted telemetry (+ optional static-session stats), per F.4. */
  assembleDormant(
    summary: NodeSummary,
    branch: string | null,
    presence: Presence | null,
    telemetry: Telemetry,
    staticSession: NormalizedDormantSession | null,
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
