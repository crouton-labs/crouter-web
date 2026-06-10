import assert from "node:assert/strict";
import { test } from "node:test";
import { GitBranchCache, type GitRunner } from "../git-branch-cache.js";

function counted(impl: GitRunner): { runner: GitRunner; calls: () => number } {
  let n = 0;
  const runner: GitRunner = (cwd, t) => {
    n++;
    return impl(cwd, t);
  };
  return { runner, calls: () => n };
}

test("miss then hit: second call within TTL does not re-exec", async () => {
  const { runner, calls } = counted(async () => "main");
  const cache = new GitBranchCache({ runner, ttlMs: 1000, now: () => 0 });
  assert.equal(await cache.getBranch("/repo"), "main");
  assert.equal(await cache.getBranch("/repo"), "main");
  assert.equal(calls(), 1, "branch cached within TTL");
});

test("TTL expiry re-execs", async () => {
  let clock = 0;
  const { runner, calls } = counted(async () => "main");
  const cache = new GitBranchCache({ runner, ttlMs: 100, now: () => clock });
  await cache.getBranch("/repo");
  clock = 50;
  await cache.getBranch("/repo");
  assert.equal(calls(), 1, "still within TTL");
  clock = 200;
  await cache.getBranch("/repo");
  assert.equal(calls(), 2, "re-exec after TTL expiry");
});

test("distinct cwds cache independently", async () => {
  const { runner, calls } = counted(async (cwd) => (cwd === "/a" ? "feat-a" : "feat-b"));
  const cache = new GitBranchCache({ runner, now: () => 0 });
  assert.equal(await cache.getBranch("/a"), "feat-a");
  assert.equal(await cache.getBranch("/b"), "feat-b");
  assert.equal(calls(), 2);
});

test("non-git cwd → null (runner returns null)", async () => {
  const cache = new GitBranchCache({ runner: async () => null, now: () => 0 });
  assert.equal(await cache.getBranch("/not-a-repo"), null);
});

test("timeout / thrown runner → null, never throws to caller", async () => {
  const cache = new GitBranchCache({
    runner: async () => {
      throw new Error("ETIMEDOUT");
    },
    now: () => 0,
  });
  assert.equal(await cache.getBranch("/slow"), null);
});

test("concurrent calls for same cwd de-dupe to one exec", async () => {
  const { runner, calls } = counted(
    () => new Promise((r) => setTimeout(() => r("main"), 5)),
  );
  const cache = new GitBranchCache({ runner, now: () => 0 });
  const [a, b] = await Promise.all([cache.getBranch("/repo"), cache.getBranch("/repo")]);
  assert.equal(a, "main");
  assert.equal(b, "main");
  assert.equal(calls(), 1, "in-flight de-dup");
});
