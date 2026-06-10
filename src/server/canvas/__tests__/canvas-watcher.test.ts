import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanvasMsg } from "../../../shared/protocol.js";
import type { AskEntry, NodeRow } from "../../crouter-lib.js";
import { CanvasWatcher, diffSummaries } from "../canvas-watcher.js";
import { toNodeSummary } from "../chrome-assembler.js";

function row(over: Partial<NodeRow> = {}): NodeRow {
  return {
    node_id: "n1",
    name: "alpha",
    kind: "developer",
    mode: "base",
    lifecycle: "terminal",
    status: "active",
    cwd: "/work",
    host_kind: "broker",
    parent: null,
    created: "2026-01-01T00:00:00.000Z",
    intent: null,
    pi_pid: null,
    window: null,
    tmux_session: null,
    pane: null,
    ...over,
  };
}

test("diffSummaries: added / removed / changed / no-change", () => {
  const a = toNodeSummary(row({ node_id: "a" }), 0);
  const b = toNodeSummary(row({ node_id: "b" }), 0);
  const bChanged = toNodeSummary(row({ node_id: "b", status: "idle" }), 0);

  assert.equal(diffSummaries([a], [a]).hasChanges, false);

  const added = diffSummaries([a], [a, b]);
  assert.deepEqual(added.added, ["b"]);
  assert.equal(added.hasChanges, true);

  const removed = diffSummaries([a, b], [a]);
  assert.deepEqual(removed.removed, ["b"]);

  const changed = diffSummaries([a, b], [a, bChanged]);
  assert.deepEqual(changed.changed, ["b"]);

  const attn = diffSummaries([a], [toNodeSummary(row({ node_id: "a" }), 3)]);
  assert.deepEqual(attn.changed, ["a"], "attention_count change is a change");
});

test("pollOnce pushes only when something changed", () => {
  let nodes: NodeRow[] = [row({ node_id: "a" })];
  let asks: AskEntry[] = [];
  const w = new CanvasWatcher({
    listNodes: () => nodes,
    asksAcrossCanvas: () => asks,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  const received: CanvasMsg[] = [];
  w.subscribe((m) => received.push(m));
  // subscribe sends the initial snapshot immediately
  assert.equal(received.length, 1);
  assert.equal(received[0]!.nodes.length, 1);

  // no change → no push
  w.pollOnce();
  assert.equal(received.length, 1);

  // add a node → push
  nodes = [row({ node_id: "a" }), row({ node_id: "b" })];
  const d1 = w.pollOnce();
  assert.equal(d1.hasChanges, true);
  assert.equal(received.length, 2);
  assert.equal(received[1]!.nodes.length, 2);

  // raise an attention ask on a → push
  asks = [{ node_id: "a", name: "alpha", cwd: "/work", count: 2 }];
  const d2 = w.pollOnce();
  assert.deepEqual(d2.changed, ["a"]);
  assert.equal(received.length, 3);
  const aRow = received[2]!.nodes.find((n) => n.node_id === "a");
  assert.equal(aRow!.attention_count, 2);
});

test("getSnapshot serves the latest summary with generated_at", () => {
  const w = new CanvasWatcher({
    listNodes: () => [row({ node_id: "x", host_kind: null })],
    asksAcrossCanvas: () => [],
    now: () => new Date("2026-02-02T00:00:00.000Z"),
  });
  const snap = w.getSnapshot();
  assert.equal(snap.generated_at, "2026-02-02T00:00:00.000Z");
  assert.equal(snap.nodes.length, 1);
  assert.equal(snap.nodes[0]!.enterable, false, "tmux host is non-enterable");
});

test("unsubscribe stops further pushes", () => {
  let nodes: NodeRow[] = [row({ node_id: "a" })];
  const w = new CanvasWatcher({ listNodes: () => nodes, asksAcrossCanvas: () => [] });
  const received: CanvasMsg[] = [];
  const off = w.subscribe((m) => received.push(m));
  off();
  nodes = [row({ node_id: "a" }), row({ node_id: "b" })];
  w.pollOnce();
  assert.equal(received.length, 1, "only the initial subscribe snapshot");
});
