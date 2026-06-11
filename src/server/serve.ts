// The server composition root (design D7). This is the ONE place the singletons
// are constructed and the DI seams are filled with the real crouter-lib +
// static-session implementations: every unit underneath stays broker-free and
// mockable. Boots an http.Server that runs the REST router first and falls back
// to the SPA bundle, multiplexes both WebSocket endpoints over the same port,
// binds loopback-only by default, fails fast on EADDRINUSE, and tears every
// upstream broker connection down (`bye`) on shutdown.

import http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  appendInbox,
  asksAcrossCanvas,
  closeNode,
  getNode,
  listNodes,
  nodeDir,
  readTelemetry,
  reviveNode,
  spawnChild,
  ViewSocketClient,
} from "./crouter-lib.js";
import { CanvasWatcher } from "./canvas/canvas-watcher.js";
import { ChromeAssembler } from "./canvas/chrome-assembler.js";
import { GitBranchCache } from "./canvas/git-branch-cache.js";
import { GitStatusCache } from "./canvas/git-status-cache.js";
import { DeckStore } from "./decks/deck-store.js";
import {
  scanInbox,
  readJson,
  deckPath,
  writeResponse,
  isResolved,
  isClaimed,
} from "./decks/humanloop-lib.js";
import { registerActionRoutes } from "./http/action-routes.js";
import { registerCanvasRoutes } from "./http/canvas-routes.js";
import { registerDeckRoutes } from "./http/deck-routes.js";
import { registerFileRoutes } from "./http/file-routes.js";
import { registerViewRoutes } from "./http/view-routes.js";
import { Router, sendError } from "./http/router.js";
import { serveStatic } from "./http/static.js";
import { listViews, getView, inlineMarkdownSources } from "./views/view-store.js";
import { isContained } from "./http/file-routes.js";
import { HubRegistry } from "./session/hub-registry.js";
import { normalizeDormantSession } from "./static-session/normalizer.js";
import { upgrade } from "./ws/upgrade.js";

export interface ServeOpts {
  port: number;
  host: string;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export async function serve(opts: ServeOpts): Promise<void> {
  const { port, host } = opts;

  // --- shared singletons + crouter-lib DI seams ---
  const branchCache = new GitBranchCache();
  const statusCache = new GitStatusCache();

  // One hub per node, shared across tabs; resolves liveness, the session file,
  // and the dormant normalizer from crouter-lib in this single place.
  const hubRegistry = new HubRegistry({
    createSocket: (id) => new ViewSocketClient(id),
    resolveNode: (id) => {
      const n = getNode(id);
      if (!n) return null;
      return { status: n.status, hostKind: n.host_kind ?? null };
    },
    viewSockExists: (id) => existsSync(join(nodeDir(id), "view.sock")),
    resolveSessionFile: (id) => getNode(id)?.pi_session_file ?? null,
    normalizeDormantSession,
  });

  // Canvas-level chrome detail. Live snapshot/presence stay omitted: live chrome
  // for an entered node streams over its session socket; the REST detail provides
  // identity + last-known/dormant-derived stats (F.4).
  const assembler = new ChromeAssembler({
    getNode,
    nodeDir,
    readTelemetry,
    getBranch: (cwd) => branchCache.getBranch(cwd),
    getStatus: (cwd) => statusCache.getStatus(cwd),
    normalizeDormant: async (id) => {
      const file = getNode(id)?.pi_session_file ?? null;
      if (!file) return null;
      try {
        return await normalizeDormantSession(file);
      } catch {
        return null;
      }
    },
  });

  const watcher = new CanvasWatcher({ listNodes, asksAcrossCanvas, getNode, nodeDir });
  watcher.start();

  // Deck read+resolve layer (design §5.2). Reads pending humanloop decks across
  // the canvas and writes answers back through humanloop's file convention.
  const deckStore = new DeckStore({
    listNodes: () =>
      listNodes().map((n) => ({
        node_id: n.node_id,
        name: n.name,
        cwd: n.cwd,
        parent: n.parent ?? null,
      })),
    scanInbox: (roots) => scanInbox(roots),
    readDeck: (dir) => readJson(deckPath(dir)),
    isResolved,
    isClaimed,
    writeResponse: (dir, responses, completedAt) =>
      writeResponse(dir, responses, completedAt),
  });

  // --- REST router (matched first; SPA fallback otherwise) ---
  const router = new Router();
  registerCanvasRoutes(router, {
    watcher,
    assembler,
    getCommandsFor: (id) => hubRegistry.getCommands(id),
  });
  registerDeckRoutes(router, { store: deckStore });
  registerFileRoutes(router, { getNode, nodeDir });
  registerViewRoutes(router, {
    listViews,
    getView,
    inlineMarkdownSources: (view) => inlineMarkdownSources(view, isContained, nodeDir),
  });
  registerActionRoutes(router, {
    spawnChild,
    appendInbox,
    // Boot the broker, then kick any OPEN hub on this node to reconnect upstream
    // so its read-only tab transitions live over the existing socket (AC-18).
    reviveNode: (id, opts) => {
      const result = reviveNode(id, opts);
      hubRegistry.reviveHub(id);
      return result;
    },
    closeNode,
    getNode,
    defaultCwd: process.cwd(),
    hasCallingNode: Boolean(process.env.CRTR_NODE_ID),
  });

  const staticHandler = serveStatic();

  const server = http.createServer((req, res) => {
    router
      .handle(req, res)
      .then((handled) => {
        if (!handled) staticHandler(req, res);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) sendError(res, 500, "internal", msg);
        else res.end();
      });
  });

  server.on("upgrade", (req, socket, head) => {
    upgrade(req, socket, head, { watcher, hubRegistry });
  });

  // --- bind loopback-only, fail fast on a taken port (A.3) ---
  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`port ${port} is already in use — pick another with --port`));
      } else {
        reject(err);
      }
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });

  // A.1 — print the URL the human opens.
  process.stdout.write(`crouter-web listening on http://${host}:${port}\n`);
  // A.2 — warn loudly when bound off loopback (no auth is ever added).
  if (!LOOPBACK.has(host)) {
    process.stderr.write(
      `crouter-web: WARNING — bound to ${host}, not loopback. There is NO authentication; ` +
        `anyone who can reach this port can drive your agents.\n`,
    );
  }

  // A.6 — graceful shutdown: bye every upstream, stop polling, drain the server.
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    hubRegistry.disposeAll();
    watcher.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
