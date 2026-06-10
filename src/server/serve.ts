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
import { registerActionRoutes } from "./http/action-routes.js";
import { registerCanvasRoutes } from "./http/canvas-routes.js";
import { Router, sendError } from "./http/router.js";
import { serveStatic } from "./http/static.js";
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
    readTelemetry,
    getBranch: (cwd) => branchCache.getBranch(cwd),
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

  const watcher = new CanvasWatcher({ listNodes, asksAcrossCanvas });
  watcher.start();

  // --- REST router (matched first; SPA fallback otherwise) ---
  const router = new Router();
  registerCanvasRoutes(router, {
    watcher,
    assembler,
    getCommandsFor: (id) => hubRegistry.getCommands(id),
  });
  registerActionRoutes(router, {
    spawnChild,
    appendInbox,
    reviveNode,
    closeNode,
    getNode,
    defaultCwd: process.cwd(),
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
