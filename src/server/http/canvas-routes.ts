// Canvas read routes (spec §6.1 reads). Mounts GET /api/canvas (served from the
// CanvasWatcher's shared snapshot), GET /api/nodes/:id (ChromeAssembler →
// NodeDetailResponse, 404 node_not_found), and GET /api/nodes/:id/commands
// (delegated to the injected hub seam `getCommandsFor`; absent / no live broker →
// 409 no_command_source). The router and its JSON helpers are orchestrator-owned
// (./router.js) — this module only registers handlers.

import type { Command, CommandsResponse, NodeDetailResponse } from "../../shared/protocol.js";
import type { ChromeAssembler } from "../canvas/chrome-assembler.js";
import type { CanvasWatcher } from "../canvas/canvas-watcher.js";
import { sendError, sendJson, type RouteHandler } from "./router.js";

/** Minimal router surface these registrars need — satisfied by `Router` (./router.js). */
export interface RouterLike {
  get(path: string, handler: RouteHandler): void;
  post(path: string, handler: RouteHandler): void;
}

export interface CanvasRoutesDeps {
  watcher: CanvasWatcher;
  assembler: ChromeAssembler;
  /**
   * Live command inventory for a node (the hub's `get_commands` reply, spec §6.1).
   * Returns `null` when there is no live broker / command source. When the whole
   * dep is absent the route always answers 409 no_command_source (hub not wired).
   */
  getCommandsFor?: (nodeId: string) => Promise<Command[] | null> | Command[] | null;
}

export function registerCanvasRoutes(router: RouterLike, deps: CanvasRoutesDeps): void {
  router.get("/api/canvas", (_req, res) => {
    sendJson(res, 200, deps.watcher.getSnapshot());
  });

  router.get("/api/nodes/:id", async (_req, res, params) => {
    const detail = await deps.assembler.assemble(params.id!);
    if (!detail) {
      sendError(res, 404, "node_not_found", `Unknown node: ${params.id}`);
      return;
    }
    const body: NodeDetailResponse = { node: detail };
    sendJson(res, 200, body);
  });

  router.get("/api/nodes/:id/commands", async (_req, res, params) => {
    if (!deps.getCommandsFor) {
      sendError(res, 409, "no_command_source", "No live command source for this node");
      return;
    }
    const commands = await deps.getCommandsFor(params.id!);
    if (commands == null) {
      sendError(res, 409, "no_command_source", "No live command source for this node");
      return;
    }
    const body: CommandsResponse = { commands };
    sendJson(res, 200, body);
  });
}
