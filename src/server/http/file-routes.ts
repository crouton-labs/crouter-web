// File peek endpoint (spec §6.1 extension, 2c).
// GET /api/nodes/:id/file?path=<absolute>
// Security: realpath + containment check against nodeDir(id) and node.cwd.
// Rejects >1MB, non-text extensions, and paths outside the allowed roots.

import { realpath, stat, readFile } from "node:fs/promises";
import type { NodeMeta } from "../crouter-lib.js";
import { sendError, sendJson } from "./router.js";
import type { RouterLike } from "./canvas-routes.js";

const MAX_BYTES = 1024 * 1024; // 1 MB

const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".ts", ".tsx", ".js", ".mjs", ".cjs",
  ".css", ".html", ".htm", ".yaml", ".yml", ".toml", ".log", ".sh",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h",
]);

export interface FilePeekResponse {
  path: string;
  content: string;
  truncated: boolean;
}

export interface FileRoutesDeps {
  getNode: (id: string) => NodeMeta | null;
  nodeDir: (id: string) => string;
}

/** Pure containment check — resolvedPath must be inside (or equal to) one of allowedDirs. */
export function isContained(resolvedPath: string, ...allowedDirs: string[]): boolean {
  return allowedDirs.some((dir) => {
    const normalized = dir.endsWith("/") ? dir : dir + "/";
    return resolvedPath === dir || resolvedPath.startsWith(normalized);
  });
}

function extOf(p: string): string {
  const dot = p.lastIndexOf(".");
  if (dot === -1) return "";
  return p.slice(dot).toLowerCase();
}

export function registerFileRoutes(router: RouterLike, deps: FileRoutesDeps): void {
  router.get("/api/nodes/:id/file", async (req, res, params) => {
    const id = params.id!;

    const node = deps.getNode(id);
    if (!node) {
      sendError(res, 404, "node_not_found", `Unknown node: ${id}`);
      return;
    }

    const rawUrl = req.url ?? "";
    const queryStart = rawUrl.indexOf("?");
    const qs = queryStart !== -1 ? new URLSearchParams(rawUrl.slice(queryStart + 1)) : null;
    const requestedPath = qs?.get("path") ?? null;

    if (!requestedPath) {
      sendError(res, 403, "bad_request", "Missing required query param: path");
      return;
    }

    // Extension check before hitting disk.
    if (!TEXT_EXTENSIONS.has(extOf(requestedPath))) {
      sendError(res, 403, "bad_request", "File type not permitted");
      return;
    }

    let resolved: string;
    try {
      resolved = await realpath(requestedPath);
    } catch {
      sendError(res, 403, "bad_request", "Path could not be resolved");
      return;
    }

    const allowedDirs = [deps.nodeDir(id), node.cwd];
    if (!isContained(resolved, ...allowedDirs)) {
      sendError(res, 403, "bad_request", "Path is outside the allowed directories");
      return;
    }

    let fileSize: number;
    try {
      const s = await stat(resolved);
      fileSize = s.size;
    } catch {
      sendError(res, 403, "bad_request", "Cannot stat path");
      return;
    }

    if (fileSize > MAX_BYTES) {
      sendError(res, 413, "bad_request", "File exceeds 1 MB limit");
      return;
    }

    let content: string;
    try {
      content = await readFile(resolved, "utf8");
    } catch {
      sendError(res, 403, "bad_request", "Cannot read file");
      return;
    }

    const out: FilePeekResponse = { path: resolved, content, truncated: false };
    sendJson(res, 200, out);
  });
}
