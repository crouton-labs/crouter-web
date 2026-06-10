import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DeckStore,
  encodeDeckId,
  decodeDeckId,
  normalizeKind,
  defaultInteractionsRootFor,
  type DeckNode,
  type DeckStoreDeps,
} from "../deck-store.js";

// A spine: conversation root c1 → child a1 (raises the ask), plus sibling root c2.
const NODES: DeckNode[] = [
  { node_id: "c1", name: "Plan the launch", cwd: "/work/launch", parent: null },
  { node_id: "a1", name: "research worker", cwd: "/work/launch", parent: "c1" },
  { node_id: "c2", name: "Other chat", cwd: "/work/other", parent: null },
];

// Two pending decks under /work/launch's interactions root.
const ROOT = "/iroot//work/launch";
const DIR_DECISION = `${ROOT}/d-decision`;
const DIR_VALID = `${ROOT}/d-valid`;

const DECKS: Record<string, unknown> = {
  [DIR_DECISION]: {
    title: "Which database?",
    source: { nodeId: "a1", blockedSince: "2026-01-01T00:00:02.000Z" },
    interactions: [
      {
        id: "db",
        title: "Pick a database",
        subtitle: "for the launch",
        kind: "decision",
        options: [
          { id: "pg", label: "Postgres", description: "battle-tested" },
          { id: "sqlite", label: "SQLite", description: "simplest" },
        ],
        allowFreetext: true,
        freetextLabel: "Other?",
      },
    ],
  },
  [DIR_VALID]: {
    title: "Deploy now?",
    source: { nodeId: "a1", blockedSince: "2026-01-01T00:00:01.000Z" },
    interactions: [
      {
        id: "approve",
        title: "Approve deploy",
        kind: "validation",
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
      },
    ],
  },
};

function makeDeps(over: Partial<DeckStoreDeps> = {}): DeckStoreDeps {
  const resolved = new Set<string>();
  const claimed = new Set<string>();
  const written: { dir: string; responses: unknown }[] = [];
  return {
    listNodes: () => NODES,
    interactionsRootFor: (cwd) => `/iroot/${cwd}`,
    scanInbox: (roots) => {
      const out: { dir: string; blockedSince: string }[] = [];
      for (const r of roots) {
        if (r === ROOT) {
          out.push({ dir: DIR_DECISION, blockedSince: "2026-01-01T00:00:02.000Z" });
          out.push({ dir: DIR_VALID, blockedSince: "2026-01-01T00:00:01.000Z" });
        }
      }
      return out.filter((i) => !resolved.has(i.dir) && !claimed.has(i.dir));
    },
    readDeck: (dir) => (DECKS[dir] as never) ?? null,
    isResolved: (dir) => resolved.has(dir),
    isClaimed: (dir) => claimed.has(dir),
    writeResponse: (dir, responses) => {
      written.push({ dir, responses });
      resolved.add(dir);
    },
    now: () => new Date("2026-01-01T12:00:00.000Z"),
    ...over,
    // expose mutators on the returned object for assertions
    ...({ _written: written, _resolved: resolved, _claimed: claimed } as object),
  } as DeckStoreDeps & Record<string, unknown>;
}

test("encode/decode deck id round-trips the dir", () => {
  assert.equal(decodeDeckId(encodeDeckId(DIR_DECISION)), DIR_DECISION);
});

test("normalizeKind maps review/unknown → decision, keeps the five", () => {
  assert.equal(normalizeKind("notify"), "notify");
  assert.equal(normalizeKind("error"), "error");
  assert.equal(normalizeKind("review"), "decision");
  assert.equal(normalizeKind(undefined), "decision");
});

test("defaultInteractionsRootFor mirrors the crouter convention", () => {
  const r = defaultInteractionsRootFor("/Users/x/proj");
  assert.ok(r.endsWith("-Users-x-proj/interactions"));
  assert.ok(r.includes("/.crouter/"));
});

test("listDecks enumerates pending, oldest-blocked first, deduped by cwd", () => {
  const store = new DeckStore(makeDeps());
  const decks = store.listDecks();
  assert.equal(decks.length, 2);
  // oldest blocked_since first → validation (…01) before decision (…02)
  assert.equal(decks[0]!.title, "Deploy now?");
  assert.equal(decks[1]!.title, "Which database?");
});

test("provenance: conversation walks to the spine root; asking node from source.nodeId", () => {
  const store = new DeckStore(makeDeps());
  const deck = store.listDecks().find((d) => d.title === "Which database?")!;
  assert.equal(deck.asking_node_id, "a1");
  assert.equal(deck.asking_node_name, "research worker");
  assert.equal(deck.conversation_id, "c1"); // root of a1
  assert.equal(deck.conversation_title, "Plan the launch");
  assert.equal(deck.cwd, "/work/launch");
});

test("getDeck returns the full normalized interactions", () => {
  const store = new DeckStore(makeDeps());
  const id = encodeDeckId(DIR_DECISION);
  const deck = store.getDeck(id)!;
  assert.equal(deck.kind, "decision");
  assert.equal(deck.interactions.length, 1);
  const it = deck.interactions[0]!;
  assert.equal(it.allowFreetext, true);
  assert.equal(it.multiSelect, false);
  assert.equal(it.options.length, 2);
  assert.equal(it.options[0]!.description, "battle-tested");
  assert.equal(it.freetextLabel, "Other?");
});

test("getDeck → null for an unknown / non-pending id", () => {
  const store = new DeckStore(makeDeps());
  assert.equal(store.getDeck(encodeDeckId("/iroot//work/launch/ghost")), null);
  assert.equal(store.getDeck("not-base64-but-fine"), null);
});

test("resolveDeck writes the answer back and returns ok", () => {
  const deps = makeDeps();
  const store = new DeckStore(deps);
  const id = encodeDeckId(DIR_VALID);
  const outcome = store.resolveDeck(id, [{ id: "approve", selectedOptionId: "yes" }]);
  assert.equal(outcome, "ok");
  const written = (deps as unknown as { _written: { dir: string }[] })._written;
  assert.equal(written.length, 1);
  assert.equal(written[0]!.dir, DIR_VALID);
  // now resolved → drops out of the list
  assert.equal(store.listDecks().length, 1);
});

test("resolveDeck → already_resolved when response.json exists", () => {
  const deps = makeDeps();
  (deps as unknown as { _resolved: Set<string> })._resolved.add(DIR_VALID);
  const store = new DeckStore(deps);
  const outcome = store.resolveDeck(encodeDeckId(DIR_VALID), [{ id: "approve" }]);
  assert.equal(outcome, "already_resolved");
});

test("resolveDeck → already_resolved when claimed elsewhere", () => {
  const deps = makeDeps();
  (deps as unknown as { _claimed: Set<string> })._claimed.add(DIR_DECISION);
  const store = new DeckStore(deps);
  const outcome = store.resolveDeck(encodeDeckId(DIR_DECISION), [{ id: "db", selectedOptionId: "pg" }]);
  assert.equal(outcome, "already_resolved");
});

test("resolveDeck → not_found for a dir outside the pending set (path-injection guard)", () => {
  const store = new DeckStore(makeDeps());
  const outcome = store.resolveDeck(encodeDeckId("/etc/passwd"), [{ id: "x" }]);
  assert.equal(outcome, "not_found");
});
