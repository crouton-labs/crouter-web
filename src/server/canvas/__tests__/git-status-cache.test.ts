import assert from "node:assert/strict";
import { test } from "node:test";
import { GitStatusCache, type GitStatusRunner } from "../git-status-cache.js";
import type { GitStatus } from "../../../shared/protocol.js";

const CLEAN: GitStatus = { added: 0, modified: 0, deleted: 0, untracked: 0 };
const DIRTY: GitStatus = { added: 1, modified: 2, deleted: 0, untracked: 3 };

function counted(impl: GitStatusRunner): { runner: GitStatusRunner; calls: () => number } {
  let n = 0;
  const runner: GitStatusRunner = (cwd, t) => {
    n++;
    return impl(cwd, t);
  };
  return { runner, calls: () => n };
}

test("miss then hit: second call within TTL does not re-exec", async () => {
  const { runner, calls } = counted(async () => DIRTY);
  const cache = new GitStatusCache({ runner, ttlMs: 1000, now: () => 0 });
  assert.deepEqual(await cache.getStatus("/repo"), DIRTY);
  assert.deepEqual(await cache.getStatus("/repo"), DIRTY);
  assert.equal(calls(), 1, "status cached within TTL");
});

test("TTL expiry re-execs", async () => {
  let clock = 0;
  const { runner, calls } = counted(async () => CLEAN);
  const cache = new GitStatusCache({ runner, ttlMs: 100, now: () => clock });
  await cache.getStatus("/repo");
  clock = 50;
  await cache.getStatus("/repo");
  assert.equal(calls(), 1, "still within TTL");
  clock = 200;
  await cache.getStatus("/repo");
  assert.equal(calls(), 2, "re-exec after TTL expiry");
});

test("distinct cwds cache independently", async () => {
  const { runner, calls } = counted(async (cwd) =>
    cwd === "/a" ? DIRTY : CLEAN,
  );
  const cache = new GitStatusCache({ runner, now: () => 0 });
  assert.deepEqual(await cache.getStatus("/a"), DIRTY);
  assert.deepEqual(await cache.getStatus("/b"), CLEAN);
  assert.equal(calls(), 2);
});

test("non-git cwd → null (runner returns null)", async () => {
  const cache = new GitStatusCache({ runner: async () => null, now: () => 0 });
  assert.equal(await cache.getStatus("/not-a-repo"), null);
});

test("timeout / thrown runner → null, never throws to caller", async () => {
  const cache = new GitStatusCache({
    runner: async () => {
      throw new Error("ETIMEDOUT");
    },
    now: () => 0,
  });
  assert.equal(await cache.getStatus("/slow"), null);
});

test("concurrent calls for same cwd de-dupe to one exec", async () => {
  const { runner, calls } = counted(
    () => new Promise((r) => setTimeout(() => r(DIRTY), 5)),
  );
  const cache = new GitStatusCache({ runner, now: () => 0 });
  const [a, b] = await Promise.all([cache.getStatus("/repo"), cache.getStatus("/repo")]);
  assert.deepEqual(a, DIRTY);
  assert.deepEqual(b, DIRTY);
  assert.equal(calls(), 1, "in-flight de-dup");
});
