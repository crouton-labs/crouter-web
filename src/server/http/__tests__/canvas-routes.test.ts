import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { test } from "node:test";
import type { NodeDetail } from "../../../shared/protocol.js";
import type { ChromeAssembler } from "../../canvas/chrome-assembler.js";
import type { CanvasWatcher } from "../../canvas/canvas-watcher.js";
import { registerCanvasRoutes, type RouterLike } from "../canvas-routes.js";
import type { RouteHandler } from "../router.js";

// --- tiny test doubles ---------------------------------------------------

interface Captured {
  status: number;
  body: unknown;
}

function mockRes(): { res: ServerResponse; captured: () => Captured } {
  let status = 0;
  let raw = "";
  const res = {
    writeHead(s: number) {
      status = s;
      return this;
    },
    end(chunk?: string) {
      if (chunk) raw += chunk;
    },
  } as unknown as ServerResponse;
  return { res, captured: () => ({ status, body: raw ? JSON.parse(raw) : undefined }) };
}

class FakeRouter implements RouterLike {
  readonly handlers = new Map<string, RouteHandler>();
  get(path: string, h: RouteHandler) {
    this.handlers.set(`GET ${path}`, h);
  }
  post(path: string, h: RouteHandler) {
    this.handlers.set(`POST ${path}`, h);
  }
  async invoke(key: string, params: Record<string, string> = {}) {
    const h = this.handlers.get(key);
    assert.ok(h, `no handler for ${key}`);
    const { res, captured } = mockRes();
    await h!({} as IncomingMessage, res, params);
    return captured();
  }
}

const detail: NodeDetail = {
  node_id: "n1",
  name: "alpha",
  kind: "developer",
  mode: "base",
  lifecycle: "terminal",
  status: "active",
  cwd: "/work",
  parent: null,
  created: "2026-01-01T00:00:00.000Z",
  host_kind: "broker",
  enterable: true,
  attention_count: 0,
  branch: "main",
  model: "m",
  tokens: { input: 1, output: 2 },
  context: null,
  tool_calls: 3,
  stats: null,
  presence: null,
  live: true,
};

function deps(over: Partial<Parameters<typeof registerCanvasRoutes>[1]> = {}) {
  const watcher = {
    getSnapshot: () => ({ nodes: [], generated_at: "2026-01-01T00:00:00.000Z" }),
  } as unknown as CanvasWatcher;
  const assembler = { assemble: async () => detail } as unknown as ChromeAssembler;
  return { watcher, assembler, ...over };
}

// --- tests ---------------------------------------------------------------

test("GET /api/canvas → watcher snapshot", async () => {
  const r = new FakeRouter();
  registerCanvasRoutes(r, deps());
  const out = await r.invoke("GET /api/canvas");
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { nodes: [], generated_at: "2026-01-01T00:00:00.000Z" });
});

test("GET /api/nodes/:id → NodeDetailResponse", async () => {
  const r = new FakeRouter();
  registerCanvasRoutes(r, deps());
  const out = await r.invoke("GET /api/nodes/:id", { id: "n1" });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { node: detail });
});

test("GET /api/nodes/:id → 404 node_not_found when assemble returns null", async () => {
  const r = new FakeRouter();
  const assembler = { assemble: async () => null } as unknown as ChromeAssembler;
  registerCanvasRoutes(r, deps({ assembler }));
  const out = await r.invoke("GET /api/nodes/:id", { id: "ghost" });
  assert.equal(out.status, 404);
  assert.equal((out.body as { error: { code: string } }).error.code, "node_not_found");
});

test("GET commands → 409 no_command_source when dep absent", async () => {
  const r = new FakeRouter();
  registerCanvasRoutes(r, deps());
  const out = await r.invoke("GET /api/nodes/:id/commands", { id: "n1" });
  assert.equal(out.status, 409);
  assert.equal((out.body as { error: { code: string } }).error.code, "no_command_source");
});

test("GET commands → 409 when getCommandsFor returns null (no live broker)", async () => {
  const r = new FakeRouter();
  registerCanvasRoutes(r, deps({ getCommandsFor: () => null }));
  const out = await r.invoke("GET /api/nodes/:id/commands", { id: "n1" });
  assert.equal(out.status, 409);
});

test("GET commands → 200 CommandsResponse from injected hub seam", async () => {
  const r = new FakeRouter();
  const commands = [
    { name: "review", description: "review code", source: "skill" as const },
  ];
  registerCanvasRoutes(r, deps({ getCommandsFor: async () => commands }));
  const out = await r.invoke("GET /api/nodes/:id/commands", { id: "n1" });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { commands });
});
