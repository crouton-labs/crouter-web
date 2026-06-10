import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  DormantSessionError,
  normalizeDormantSession,
} from "../normalizer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// src/server/static-session/__tests__ -> repo root is four levels up.
const FIXTURES = join(HERE, "..", "..", "..", "..", "test", "fixtures", "sessions");
const fixture = (name: string) => join(FIXTURES, name);

/** Join all text blocks of a message's content (or "" for non-text messages). */
function textOf(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: "text"; text: string } =>
        typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text",
    )
    .map((b) => b.text)
    .join("");
}

const roleOf = (m: AgentMessage): string => (m as { role: string }).role;
const allText = (history: AgentMessage[]): string => history.map(textOf).join("\n");

test("linear conversation resolves to ordered user/assistant history + model + thinking", async () => {
  const result = await normalizeDormantSession(fixture("linear.jsonl"));

  assert.equal(result.history.length, 2);
  assert.equal(roleOf(result.history[0]!), "user");
  assert.equal(textOf(result.history[0]!), "What is 2 + 2?");
  assert.equal(roleOf(result.history[1]!), "assistant");
  assert.equal(textOf(result.history[1]!), "2 + 2 = 4.");

  // model_change + assistant model both point at the same model; thinking_level_change applied.
  assert.equal(result.model, "claude-opus-4-8");
  assert.equal(result.thinkingLevel, "medium");
});

test("branched tree resolves the active-leaf path and drops the abandoned branch", async () => {
  const result = await normalizeDormantSession(fixture("branched.jsonl"));

  const joined = allText(result.history);
  // The active leaf is the last entry (a2bbbbbb); its branch wins.
  assert.ok(joined.includes("ACTIVE_BRANCH_BLUE"), "active branch must be present");
  assert.ok(
    !joined.includes("ABANDONED_BRANCH_RED"),
    "abandoned sibling branch must be excluded from the active-leaf path",
  );
  // Path = [user, active-assistant]; the user prompt is shared by both branches.
  assert.equal(result.history.length, 2);
  assert.equal(roleOf(result.history[0]!), "user");
  assert.equal(textOf(result.history[0]!), "Name a color.");
});

test("compacted session emits the summary first, keeps from firstKeptEntryId, drops earlier turns", async () => {
  const result = await normalizeDormantSession(fixture("compacted.jsonl"));

  // 1) compaction summary message comes first.
  assert.equal(roleOf(result.history[0]!), "compactionSummary");
  assert.equal(
    (result.history[0] as { summary: string }).summary,
    "COMPACTION_SUMMARY_BODY",
  );

  const joined = allText(result.history);
  // 2) the pre-compaction (pre-firstKept) turn is dropped.
  assert.ok(
    !joined.includes("PRE_COMPACTION_DROPPED_QUESTION"),
    "messages before firstKeptEntryId must be dropped",
  );
  // 3) firstKept assistant + everything after compaction is retained.
  assert.ok(joined.includes("FIRST_KEPT_ANSWER"), "firstKept entry retained");
  assert.ok(joined.includes("POST_COMPACTION_QUESTION"), "post-compaction user retained");
  assert.ok(joined.includes("POST_COMPACTION_ANSWER"), "post-compaction assistant retained");

  // Order: [summary, firstKept-assistant, post-user, post-assistant].
  assert.deepEqual(result.history.map(roleOf), [
    "compactionSummary",
    "assistant",
    "user",
    "assistant",
  ]);
});

test("model_change mid-conversation: latest model wins, thinking level follows", async () => {
  const result = await normalizeDormantSession(fixture("model-change.jsonl"));

  // Two model_change entries on the active path; the latest (openai/gpt-5-2) wins.
  assert.equal(result.model, "gpt-5-2");
  assert.equal(result.thinkingLevel, "high");

  const joined = allText(result.history);
  assert.ok(joined.includes("First question on sonnet."));
  assert.ok(joined.includes("Answer on gpt."));
  assert.equal(result.history.length, 4);
});

test("the live session file is byte-identical after normalize (temp-copy isolation)", async () => {
  // legacy-v1.jsonl has no version field -> SessionManager.open() WOULD migrate+rewrite
  // it in place. If the normalizer opened the live file, these bytes would change.
  const path = fixture("legacy-v1.jsonl");
  const before = await readFile(path);

  const result = await normalizeDormantSession(path);
  // Sanity: a migratable file still normalizes to real history.
  const joined = allText(result.history);
  assert.ok(joined.includes("LEGACY_USER_TEXT"));
  assert.ok(joined.includes("LEGACY_ASSISTANT_TEXT"));

  const after = await readFile(path);
  assert.deepEqual(after, before, "the node's live session file must be untouched");
});

test("a v3 fixture is also left byte-identical after normalize", async () => {
  const path = fixture("linear.jsonl");
  const before = await readFile(path);
  await normalizeDormantSession(path);
  const afterBytes = await readFile(path);
  assert.deepEqual(afterBytes, before);
});

test("throws a typed DormantSessionError for a missing file", async () => {
  await assert.rejects(
    () => normalizeDormantSession(fixture("does-not-exist.jsonl")),
    (err: unknown) => {
      assert.ok(err instanceof DormantSessionError);
      assert.match(err.message, /not found or unreadable/);
      return true;
    },
  );
});

after(() => {
  // No global state to tear down; placeholder keeps intent explicit.
});
