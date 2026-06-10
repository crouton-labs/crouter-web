import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import type { DeckDetail, DeckSummary } from "../../../shared/protocol.js";
import type { DeckStore } from "../../decks/deck-store.js";
import { registerDeckRoutes } from "../deck-routes.js";
import type { RouterLike } from "../canvas-routes.js";
import type { RouteHandler } from "../router.js";

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

function mockReq(body?: unknown): IncomingMessage {
  const r = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
  );
  return r as unknown as IncomingMessage;
}

class FakeRouter implements RouterLike {
  readonly handlers = new Map<string, RouteHandler>();
  get(path: string, h: RouteHandler) {
    this.handlers.set(`GET ${path}`, h);
  }
  post(path: string, h: RouteHandler) {
    this.handlers.set(`POST ${path}`, h);
  }
  async invoke(key: string, params: Record<string, string> = {}, body?: unknown) {
    const h = this.handlers.get(key);
    assert.ok(h, `no handler for ${key}`);
    const { res, captured } = mockRes();
    await h!(mockReq(body), res, params);
    return captured();
  }
}

const summary: DeckSummary = {
  id: "deck1",
  kind: "decision",
  title: "Pick one",
  blocked_since: "2026-01-01T00:00:00.000Z",
  conversation_id: "c1",
  conversation_title: "My chat",
  asking_node_id: "a1",
  asking_node_name: "worker",
  cwd: "/work",
  interaction_count: 1,
};
const detail: DeckDetail = {
  ...summary,
  interactions: [
    {
      id: "q",
      title: "Pick one",
      kind: "decision",
      options: [{ id: "a", label: "A" }],
      multiSelect: false,
      allowFreetext: false,
    },
  ],
};

function fakeStore(over: Partial<Record<keyof DeckStore, unknown>> = {}): DeckStore {
  return {
    listDecks: () => [summary],
    getDeck: () => detail,
    resolveDeck: () => "ok",
    ...over,
  } as unknown as DeckStore;
}

test("GET /api/decks → DecksResponse", async () => {
  const r = new FakeRouter();
  registerDeckRoutes(r, { store: fakeStore(), now: () => new Date("2026-02-02T00:00:00.000Z") });
  const out = await r.invoke("GET /api/decks");
  assert.equal(out.status, 200);
  assert.deepEqual((out.body as { decks: unknown[] }).decks, [summary]);
  assert.equal((out.body as { generated_at: string }).generated_at, "2026-02-02T00:00:00.000Z");
});

test("GET /api/decks/:id → DeckDetailResponse", async () => {
  const r = new FakeRouter();
  registerDeckRoutes(r, { store: fakeStore() });
  const out = await r.invoke("GET /api/decks/:id", { id: "deck1" });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { deck: detail });
});

test("GET /api/decks/:id → 404 deck_not_found when store returns null", async () => {
  const r = new FakeRouter();
  registerDeckRoutes(r, { store: fakeStore({ getDeck: () => null }) });
  const out = await r.invoke("GET /api/decks/:id", { id: "ghost" });
  assert.equal(out.status, 404);
  assert.equal((out.body as { error: { code: string } }).error.code, "deck_not_found");
});

test("POST resolve → 200 ok", async () => {
  const r = new FakeRouter();
  registerDeckRoutes(r, { store: fakeStore() });
  const out = await r.invoke("POST /api/decks/:id/resolve", { id: "deck1" }, {
    responses: [{ id: "q", selectedOptionId: "a" }],
  });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true });
});

test("POST resolve → 409 deck_already_resolved", async () => {
  const r = new FakeRouter();
  registerDeckRoutes(r, { store: fakeStore({ resolveDeck: () => "already_resolved" }) });
  const out = await r.invoke("POST /api/decks/:id/resolve", { id: "deck1" }, { responses: [] });
  assert.equal(out.status, 409);
  assert.equal((out.body as { error: { code: string } }).error.code, "deck_already_resolved");
});

test("POST resolve → 404 deck_not_found", async () => {
  const r = new FakeRouter();
  registerDeckRoutes(r, { store: fakeStore({ resolveDeck: () => "not_found" }) });
  const out = await r.invoke("POST /api/decks/:id/resolve", { id: "x" }, { responses: [] });
  assert.equal(out.status, 404);
});

test("POST resolve → 400 when responses[] missing", async () => {
  const r = new FakeRouter();
  registerDeckRoutes(r, { store: fakeStore() });
  const out = await r.invoke("POST /api/decks/:id/resolve", { id: "deck1" }, { nope: true });
  assert.equal(out.status, 400);
  assert.equal((out.body as { error: { code: string } }).error.code, "bad_request");
});
