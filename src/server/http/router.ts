// Minimal method + path router over node:http (design D7 — no web framework).
// Path syntax: literal segments plus `:param` captures, e.g. `/api/nodes/:id`.
// Handlers are async and receive parsed params; the router owns matching and a
// 404 fallback, nothing else (no middleware machinery — the route surface is
// tiny and fixed). REST handlers themselves own body parsing + error envelopes.

import type { IncomingMessage, ServerResponse } from "node:http";

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => void | Promise<void>;

type Method = "GET" | "POST";

interface Route {
  method: Method;
  segments: string[]; // literal or ":param"
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  get(path: string, handler: RouteHandler): void {
    this.add("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.add("POST", path, handler);
  }

  private add(method: Method, path: string, handler: RouteHandler): void {
    this.routes.push({ method, segments: splitPath(path), handler });
  }

  /**
   * Match req against the registered routes. Returns true if a route handled it
   * (the handler was invoked); false if no route matched (caller serves the SPA
   * fallback / 404).
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url ?? "/";
    const pathname = url.split("?")[0]!;
    const reqSegments = splitPath(pathname);
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const params = matchSegments(route.segments, reqSegments);
      if (params) {
        await route.handler(req, res, params);
        return true;
      }
    }
    return false;
  }
}

function splitPath(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

function matchSegments(
  routeSegs: string[],
  reqSegs: string[],
): Record<string, string> | null {
  if (routeSegs.length !== reqSegs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < routeSegs.length; i++) {
    const r = routeSegs[i]!;
    const v = reqSegs[i]!;
    if (r.startsWith(":")) {
      params[r.slice(1)] = decodeURIComponent(v);
    } else if (r !== v) {
      return null;
    }
  }
  return params;
}

// Shared helpers REST handlers use for consistent JSON I/O + error envelopes.
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(res, status, { ok: false, error: { code, message } });
}

export async function readJsonBody<T = unknown>(
  req: IncomingMessage,
  maxBytes = 32 * 1024 * 1024,
): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) throw new Error("request body too large");
    chunks.push(buf);
  }
  if (total === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
