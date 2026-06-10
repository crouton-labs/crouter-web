// Node action routes (spec §6.1 actions, G.1–G.5). All four POSTs route ONLY through
// sanctioned crouter library calls (dependency-injected so tests mock them and the
// orchestrator wires the real ones from crouter-lib). Every failure returns a
// structured error per the taxonomy and never leaves the canvas inconsistent (G.5).
// Spawn is ALWAYS broker-hosted (hostKind:'broker'); `root` toggles a resident node.

import type {
  CloseResponse,
  MessageRequest,
  MessageResponse,
  ReviveRequest,
  ReviveResponse,
  SpawnRequest,
  SpawnResponse,
} from "../../shared/protocol.js";
import type {
  CloseNodeResult,
  InboxEntry,
  InboxTier,
  NodeMeta,
  ReviveResult,
  SpawnChildOpts,
  SpawnChildResult,
} from "../crouter-lib.js";
import { readJsonBody, sendError, sendJson } from "./router.js";
import type { RouterLike } from "./canvas-routes.js";

export interface ActionRoutesDeps {
  spawnChild: (opts: SpawnChildOpts) => SpawnChildResult;
  appendInbox: (id: string, entry: Omit<InboxEntry, "ts">) => InboxEntry;
  reviveNode: (id: string, opts: { resume: boolean }) => ReviveResult;
  closeNode: (id: string) => CloseNodeResult;
  getNode: (id: string) => NodeMeta | null;
  /** Default cwd for a spawn whose request omits one (orchestrator passes process.cwd()). */
  defaultCwd?: string;
}

/** Statuses with no live broker — a message to one of these wakes it (G.2). */
const DORMANT_STATUSES = new Set(["idle", "done", "dead", "canceled"]);
const VALID_TIERS = new Set<InboxTier>(["critical", "urgent", "normal", "deferred"]);

export function registerActionRoutes(router: RouterLike, deps: ActionRoutesDeps): void {
  // G.1 — Spawn (always broker-hosted; enterable).
  router.post("/api/nodes", async (req, res) => {
    let body: SpawnRequest;
    try {
      body = await readJsonBody<SpawnRequest>(req);
    } catch {
      sendError(res, 400, "bad_request", "Malformed JSON body");
      return;
    }
    if (!body || typeof body.prompt !== "string" || body.prompt.length === 0) {
      sendError(res, 400, "bad_request", "Missing required field: prompt");
      return;
    }
    if (typeof body.kind !== "string" || body.kind.length === 0) {
      sendError(res, 400, "bad_request", "Missing required field: kind");
      return;
    }
    const opts: SpawnChildOpts = {
      kind: body.kind,
      prompt: body.prompt,
      cwd: body.cwd ?? deps.defaultCwd ?? process.cwd(),
      hostKind: "broker",
      ...(body.mode ? { mode: body.mode } : {}),
      ...(body.name ? { name: body.name } : {}),
      ...(body.model ? { model: body.model } : {}),
      ...(body.parent ? { parent: body.parent } : {}),
      ...(body.root ? { root: true } : {}),
    };
    try {
      const result = deps.spawnChild(opts);
      const out: SpawnResponse = { ok: true, node_id: result.node.node_id };
      sendJson(res, 200, out);
    } catch (err) {
      sendError(res, 500, "spawn_failed", errMessage(err));
    }
  });

  // G.2 — Message (inbox; wakes a dormant target via the sanctioned revive path).
  router.post("/api/nodes/:id/message", async (req, res, params) => {
    const id = params.id!;
    let body: MessageRequest;
    try {
      body = await readJsonBody<MessageRequest>(req);
    } catch {
      sendError(res, 400, "bad_request", "Malformed JSON body");
      return;
    }
    if (!body || typeof body.body !== "string" || body.body.length === 0) {
      sendError(res, 400, "bad_request", "Missing required field: body");
      return;
    }
    const node = deps.getNode(id);
    if (!node) {
      sendError(res, 404, "node_not_found", `Unknown node: ${id}`);
      return;
    }
    const tier: InboxTier =
      body.tier && VALID_TIERS.has(body.tier as InboxTier) ? (body.tier as InboxTier) : "normal";
    const wakeNeeded = DORMANT_STATUSES.has(node.status);
    try {
      deps.appendInbox(id, {
        from: null,
        tier,
        kind: "message",
        label: body.body.slice(0, 80),
        data: { body: body.body },
      });
      if (wakeNeeded) {
        deps.reviveNode(id, { resume: true });
      }
      const out: MessageResponse = { ok: true, delivered: true, woke: wakeNeeded };
      sendJson(res, 200, out);
    } catch (err) {
      sendError(res, 500, "message_failed", errMessage(err));
    }
  });

  // G.3 — Revive (resume by default; `fresh` opts out of resume).
  router.post("/api/nodes/:id/revive", async (req, res, params) => {
    const id = params.id!;
    let body: ReviveRequest;
    try {
      body = await readJsonBody<ReviveRequest>(req);
    } catch {
      sendError(res, 400, "bad_request", "Malformed JSON body");
      return;
    }
    if (!deps.getNode(id)) {
      sendError(res, 404, "node_not_found", `Unknown node: ${id}`);
      return;
    }
    try {
      const result = deps.reviveNode(id, { resume: !body?.fresh });
      const out: ReviveResponse = { ok: true, resumed: result.resumed };
      sendJson(res, 200, out);
    } catch (err) {
      sendError(res, 500, "revive_failed", errMessage(err));
    }
  });

  // G.4 — Close (pause the node without finishing it).
  router.post("/api/nodes/:id/close", async (_req, res, params) => {
    const id = params.id!;
    if (!deps.getNode(id)) {
      sendError(res, 404, "node_not_found", `Unknown node: ${id}`);
      return;
    }
    try {
      deps.closeNode(id);
      const out: CloseResponse = { ok: true };
      sendJson(res, 200, out);
    } catch (err) {
      sendError(res, 500, "close_failed", errMessage(err));
    }
  });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
