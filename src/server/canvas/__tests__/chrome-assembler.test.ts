import assert from "node:assert/strict";
import { test } from "node:test";
import type { NodeMeta, SessionStats, Telemetry } from "../../crouter-lib.js";
import type { NormalizedDormantSession } from "../../static-session/normalizer.js";
import {
  ChromeAssembler,
  type ChromeAssemblerDeps,
  type LiveChromeInput,
  toNodeSummary,
} from "../chrome-assembler.js";

function meta(over: Partial<NodeMeta> = {}): NodeMeta {
  return {
    node_id: "n1",
    name: "alpha",
    kind: "developer",
    mode: "base",
    lifecycle: "terminal",
    status: "active",
    cwd: "/work/repo",
    host_kind: "broker",
    parent: "root",
    created: "2026-01-01T00:00:00.000Z",
    ...over,
  } as NodeMeta;
}

function liveInput(): LiveChromeInput {
  const stats: SessionStats = {
    sessionFile: "/s.jsonl",
    sessionId: "sid",
    userMessages: 3,
    assistantMessages: 4,
    toolCalls: 7,
    toolResults: 7,
    totalMessages: 11,
    tokens: { input: 100, output: 200, cacheRead: 50, cacheWrite: 10, total: 360 },
    cost: 0.42,
    contextUsage: { tokens: 1234, contextWindow: 200000, percent: 0.6 },
  };
  return {
    stats,
    state: {
      sessionId: "sid",
      sessionFile: "/s.jsonl",
      model: "claude-opus",
      isStreaming: false,
      thinkingLevel: "medium",
      steeringMode: "all",
      followUpMode: "all",
      sessionName: undefined,
      autoCompactionEnabled: true,
      pendingMessageCount: 0,
    },
  };
}

function makeAssembler(deps: Partial<ChromeAssemblerDeps>): ChromeAssembler {
  return new ChromeAssembler({
    getNode: () => meta(),
    readTelemetry: () => ({}),
    getBranch: async () => "main",
    ...deps,
  });
}

test("toNodeSummary maps host_kind null → tmux and enterable correctly", () => {
  const tmux = toNodeSummary(meta({ host_kind: null }), 2);
  assert.equal(tmux.host_kind, "tmux");
  assert.equal(tmux.enterable, false);
  assert.equal(tmux.attention_count, 2);
  const broker = toNodeSummary(meta({ host_kind: "broker" }), 0);
  assert.equal(broker.enterable, true);
});

test("unknown node → null (route renders 404)", async () => {
  const a = makeAssembler({ getNode: () => null });
  assert.equal(await a.assemble("nope"), null);
});

test("live: chrome built from broker stats + state, live:true", async () => {
  const a = makeAssembler({ getLiveSnapshot: () => liveInput() });
  const d = await a.assemble("n1");
  assert.ok(d);
  assert.equal(d!.live, true);
  assert.equal(d!.branch, "main");
  assert.equal(d!.model, "claude-opus");
  assert.deepEqual(d!.tokens, { input: 100, output: 200, cache: 50 });
  assert.deepEqual(d!.context, { tokens: 1234, window: 200000, percent: 0.6 });
  assert.equal(d!.tool_calls, 7);
  assert.deepEqual(d!.stats, {
    turns: 3,
    user_messages: 3,
    assistant_messages: 4,
    cost: 0.42,
  });
});

test("live: null contextUsage tokens → context null", async () => {
  const input = liveInput();
  input.stats.contextUsage = { tokens: null, contextWindow: 200000, percent: null };
  const a = makeAssembler({ getLiveSnapshot: () => input });
  const d = await a.assemble("n1");
  assert.equal(d!.context, null);
});

test("dormant: telemetry-only chrome honors F.4 omissions", async () => {
  const telemetry: Telemetry = {
    tokens_in: 500,
    tokens_out: 250,
    context_tokens: 1800,
    model: "gpt-5",
  };
  const a = makeAssembler({
    getNode: () => meta({ status: "done" }),
    readTelemetry: () => telemetry,
    // no getLiveSnapshot → dormant path
  });
  const d = await a.assemble("n1");
  assert.ok(d);
  assert.equal(d!.live, false);
  assert.equal(d!.model, "gpt-5");
  assert.deepEqual(d!.tokens, { input: 500, output: 250 });
  // raw context tokens, window===0 signals "percent unknown" (F.4)
  assert.deepEqual(d!.context, { tokens: 1800, window: 0, percent: 0 });
  assert.equal(d!.tool_calls, null, "no tool-call activity for dormant (F.4)");
  assert.equal(d!.stats, null, "no live stats for dormant (F.4)");
});

test("dormant: broker host but no live snapshot falls to dormant", async () => {
  const a = makeAssembler({
    getNode: () => meta({ host_kind: "broker", status: "idle" }),
    readTelemetry: () => ({ model: "m" }),
    getLiveSnapshot: () => null,
  });
  const d = await a.assemble("n1");
  assert.equal(d!.live, false);
  assert.equal(d!.tokens, null);
});

test("dormant: session stats derived from static parse (F.4)", async () => {
  const session: NormalizedDormantSession = {
    history: [
      { role: "user", content: [] },
      { role: "assistant", content: [] },
      { role: "assistant", content: [] },
      { role: "tool", content: [] },
    ] as unknown as NormalizedDormantSession["history"],
    model: "static-model",
    thinkingLevel: "low",
  };
  const a = makeAssembler({
    getNode: () => meta({ status: "done" }),
    readTelemetry: () => ({ tokens_in: 1 }),
    normalizeDormant: async () => session,
  });
  const d = await a.assemble("n1");
  assert.deepEqual(d!.stats, { turns: 1, user_messages: 1, assistant_messages: 2 });
  assert.equal(d!.model, "static-model", "static model preferred over telemetry");
});

test("presence + attention threaded through", async () => {
  const a = makeAssembler({
    getLiveSnapshot: () => liveInput(),
    getPresence: () => ({ viewers: 2, controller: "tab-9" }),
    getAttention: () => 5,
  });
  const d = await a.assemble("n1");
  assert.deepEqual(d!.presence, { viewers: 2, controller: "tab-9" });
  assert.equal(d!.attention_count, 5);
});
