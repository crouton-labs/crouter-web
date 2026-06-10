import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import type {
  CloseNodeResult,
  InboxEntry,
  NodeMeta,
  ReviveResult,
  SpawnChildOpts,
  SpawnChildResult,
} from "../../crouter-lib.js";
import { registerActionRoutes, type ActionRoutesDeps } from "../action-routes.js";
import type { RouterLike } from "../canvas-routes.js";
import type { RouteHandler } from "../router.js";

// --- test doubles --------------------------------------------------------

function mockReq(body?: unknown): IncomingMessage {
  const json = body === undefined ? "" : JSON.stringify(body);
  const r = json ? Readable.from([Buffer.from(json)]) : Readable.from([]);
  return r as unknown as IncomingMessage;
}

function mockRes(): { res: ServerResponse; captured: () => { status: number; body: any } } {
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
  async invoke(key: string, body?: unknown, params: Record<string, string> = {}) {
    const h = this.handlers.get(key);
    assert.ok(h, `no handler for ${key}`);
    const { res, captured } = mockRes();
    await h!(mockReq(body), res, params);
    return captured();
  }
}

function meta(over: Partial<NodeMeta> = {}): NodeMeta {
  return { node_id: "n1", name: "a", status: "active", cwd: "/w", ...over } as NodeMeta;
}

function baseDeps(over: Partial<ActionRoutesDeps> = {}): ActionRoutesDeps {
  return {
    spawnChild: () => ({ node: meta(), window: null, session: "s" }) as SpawnChildResult,
    appendInbox: (_id, e) => ({ ...e, ts: "t" }) as InboxEntry,
    reviveNode: () => ({ window: null, session: "s", resumed: true }) as ReviveResult,
    closeNode: () => ({ root: "n1", closed: ["n1"], spared: [] }) as CloseNodeResult,
    getNode: () => meta(),
    defaultCwd: "/default",
    ...over,
  };
}

// --- spawn ---------------------------------------------------------------

test("POST /api/nodes → spawnChild with hostKind:'broker', returns node_id", async () => {
  const r = new FakeRouter();
  let seen: SpawnChildOpts | undefined;
  registerActionRoutes(
    r,
    baseDeps({
      spawnChild: (opts) => {
        seen = opts;
        return { node: meta({ node_id: "new1" }), window: null, session: "s" } as SpawnChildResult;
      },
    }),
  );
  const out = await r.invoke("POST /api/nodes", { prompt: "do it", kind: "developer" });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true, node_id: "new1" });
  assert.equal(seen!.hostKind, "broker", "always broker-hosted (G.1)");
  assert.equal(seen!.cwd, "/default", "falls back to defaultCwd");
});

test("POST /api/nodes with root:true sets resident toggle", async () => {
  const r = new FakeRouter();
  let seen: SpawnChildOpts | undefined;
  registerActionRoutes(
    r,
    baseDeps({
      spawnChild: (opts) => {
        seen = opts;
        return { node: meta(), window: null, session: "s" } as SpawnChildResult;
      },
    }),
  );
  await r.invoke("POST /api/nodes", { prompt: "p", kind: "k", root: true });
  assert.equal(seen!.root, true);
});

test("POST /api/nodes → 400 when prompt missing", async () => {
  const r = new FakeRouter();
  registerActionRoutes(r, baseDeps());
  const out = await r.invoke("POST /api/nodes", { kind: "developer" });
  assert.equal(out.status, 400);
  assert.equal(out.body.error.code, "bad_request");
});

test("POST /api/nodes → 500 spawn_failed when spawnChild throws", async () => {
  const r = new FakeRouter();
  registerActionRoutes(
    r,
    baseDeps({
      spawnChild: () => {
        throw new Error("boom");
      },
    }),
  );
  const out = await r.invoke("POST /api/nodes", { prompt: "p", kind: "k" });
  assert.equal(out.status, 500);
  assert.equal(out.body.error.code, "spawn_failed");
  assert.equal(out.body.error.message, "boom");
});

// --- message -------------------------------------------------------------

test("POST message to active node → delivered, not woke", async () => {
  const r = new FakeRouter();
  let revived = false;
  registerActionRoutes(
    r,
    baseDeps({
      getNode: () => meta({ status: "active" }),
      reviveNode: () => {
        revived = true;
        return { window: null, session: "s", resumed: true } as ReviveResult;
      },
    }),
  );
  const out = await r.invoke("POST /api/nodes/:id/message", { body: "hi" }, { id: "n1" });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true, delivered: true, woke: false });
  assert.equal(revived, false, "no revive for a live node");
});

test("POST message to dormant node → delivered + woke via revive", async () => {
  const r = new FakeRouter();
  const inboxCalls: Array<Omit<InboxEntry, "ts">> = [];
  let revivedId: string | undefined;
  registerActionRoutes(
    r,
    baseDeps({
      getNode: () => meta({ status: "done" }),
      appendInbox: (_id, e) => {
        inboxCalls.push(e);
        return { ...e, ts: "t" } as InboxEntry;
      },
      reviveNode: (id) => {
        revivedId = id;
        return { window: null, session: "s", resumed: true } as ReviveResult;
      },
    }),
  );
  const out = await r.invoke("POST /api/nodes/:id/message", { body: "wake up" }, { id: "n1" });
  assert.deepEqual(out.body, { ok: true, delivered: true, woke: true });
  assert.equal(revivedId, "n1");
  assert.equal(inboxCalls[0]!.kind, "message");
  assert.equal(inboxCalls[0]!.label, "wake up");
});

test("POST message → 404 when node unknown", async () => {
  const r = new FakeRouter();
  registerActionRoutes(r, baseDeps({ getNode: () => null }));
  const out = await r.invoke("POST /api/nodes/:id/message", { body: "x" }, { id: "ghost" });
  assert.equal(out.status, 404);
  assert.equal(out.body.error.code, "node_not_found");
});

test("POST message → 400 when body missing", async () => {
  const r = new FakeRouter();
  registerActionRoutes(r, baseDeps());
  const out = await r.invoke("POST /api/nodes/:id/message", {}, { id: "n1" });
  assert.equal(out.status, 400);
});

test("POST message → 500 message_failed when appendInbox throws", async () => {
  const r = new FakeRouter();
  registerActionRoutes(
    r,
    baseDeps({
      appendInbox: () => {
        throw new Error("disk full");
      },
    }),
  );
  const out = await r.invoke("POST /api/nodes/:id/message", { body: "x" }, { id: "n1" });
  assert.equal(out.status, 500);
  assert.equal(out.body.error.code, "message_failed");
});

// --- revive --------------------------------------------------------------

test("POST revive (default) → resume:true", async () => {
  const r = new FakeRouter();
  let resume: boolean | undefined;
  registerActionRoutes(
    r,
    baseDeps({
      reviveNode: (_id, opts) => {
        resume = opts.resume;
        return { window: null, session: "s", resumed: true } as ReviveResult;
      },
    }),
  );
  const out = await r.invoke("POST /api/nodes/:id/revive", {}, { id: "n1" });
  assert.deepEqual(out.body, { ok: true, resumed: true });
  assert.equal(resume, true);
});

test("POST revive {fresh:true} → resume:false", async () => {
  const r = new FakeRouter();
  let resume: boolean | undefined;
  registerActionRoutes(
    r,
    baseDeps({
      reviveNode: (_id, opts) => {
        resume = opts.resume;
        return { window: null, session: "s", resumed: false } as ReviveResult;
      },
    }),
  );
  await r.invoke("POST /api/nodes/:id/revive", { fresh: true }, { id: "n1" });
  assert.equal(resume, false);
});

test("POST revive → 404 unknown / 500 revive_failed", async () => {
  const r1 = new FakeRouter();
  registerActionRoutes(r1, baseDeps({ getNode: () => null }));
  const a = await r1.invoke("POST /api/nodes/:id/revive", {}, { id: "g" });
  assert.equal(a.status, 404);

  const r2 = new FakeRouter();
  registerActionRoutes(
    r2,
    baseDeps({
      reviveNode: () => {
        throw new Error("no broker");
      },
    }),
  );
  const b = await r2.invoke("POST /api/nodes/:id/revive", {}, { id: "n1" });
  assert.equal(b.status, 500);
  assert.equal(b.body.error.code, "revive_failed");
});

// --- close ---------------------------------------------------------------

test("POST close → ok; 404 unknown; 500 close_failed", async () => {
  const r = new FakeRouter();
  let closedId: string | undefined;
  registerActionRoutes(
    r,
    baseDeps({
      closeNode: (id) => {
        closedId = id;
        return { root: id, closed: [id], spared: [] } as CloseNodeResult;
      },
    }),
  );
  const out = await r.invoke("POST /api/nodes/:id/close", undefined, { id: "n1" });
  assert.deepEqual(out.body, { ok: true });
  assert.equal(closedId, "n1");

  const r404 = new FakeRouter();
  registerActionRoutes(r404, baseDeps({ getNode: () => null }));
  assert.equal((await r404.invoke("POST /api/nodes/:id/close", undefined, { id: "g" })).status, 404);

  const r500 = new FakeRouter();
  registerActionRoutes(
    r500,
    baseDeps({
      closeNode: () => {
        throw new Error("cascade fail");
      },
    }),
  );
  const f = await r500.invoke("POST /api/nodes/:id/close", undefined, { id: "n1" });
  assert.equal(f.status, 500);
  assert.equal(f.body.error.code, "close_failed");
});
