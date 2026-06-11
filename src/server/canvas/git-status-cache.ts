// GitStatusCache — per-cwd TTL cache of git working-tree change counts via
// `git -C <cwd> status --porcelain`. Modelled directly on GitBranchCache.
// Returns GitStatus | null; null means non-git, error, or timeout.
// NEVER throws to its caller.

import { execFile } from "node:child_process";
import type { GitStatus } from "../../shared/protocol.js";

/** Resolve git working-tree status for `cwd`, or `null` when it cannot be determined. */
export type GitStatusRunner = (cwd: string, timeoutMs: number) => Promise<GitStatus | null>;

interface CacheEntry {
  status: GitStatus | null;
  expires: number;
}

export interface GitStatusCacheOptions {
  /** Cache TTL in ms (default ~10s). */
  ttlMs?: number;
  /** Per-call git timeout in ms. */
  timeoutMs?: number;
  /** Injected runner (tests pass a mock); defaults to a real bounded exec. */
  runner?: GitStatusRunner;
  /** Clock injection for tests. */
  now?: () => number;
}

function parsePortcelain(output: string): GitStatus {
  let added = 0;
  let modified = 0;
  let deleted = 0;
  let untracked = 0;
  for (const line of output.split("\n")) {
    if (line.length < 2) continue;
    const xy = line.slice(0, 2);
    if (xy === "??") {
      untracked++;
    } else {
      if (xy[0] === "A" || xy[1] === "A") added++;
      if (xy[0] === "M" || xy[1] === "M") modified++;
      if (xy[0] === "D" || xy[1] === "D") deleted++;
    }
  }
  return { added, modified, deleted, untracked };
}

/** Default runner: `git -C <cwd> status --porcelain`, bounded, null on any failure. */
export const defaultGitStatusRunner: GitStatusRunner = (cwd, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, "status", "--porcelain"],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        resolve(parsePortcelain(stdout.toString()));
      },
    );
  });

export class GitStatusCache {
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly runner: GitStatusRunner;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  /** In-flight computations, de-duped per cwd so a TTL miss never fans out N execs. */
  private readonly inflight = new Map<string, Promise<GitStatus | null>>();

  constructor(opts: GitStatusCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 10_000;
    this.timeoutMs = opts.timeoutMs ?? 1_000;
    this.runner = opts.runner ?? defaultGitStatusRunner;
    this.now = opts.now ?? Date.now;
  }

  /** Current status for `cwd` (cached within TTL); `null` for non-git/timeout/error. */
  async getStatus(cwd: string): Promise<GitStatus | null> {
    const hit = this.cache.get(cwd);
    if (hit && hit.expires > this.now()) return hit.status;

    const existing = this.inflight.get(cwd);
    if (existing) return existing;

    const job = this.compute(cwd);
    this.inflight.set(cwd, job);
    try {
      return await job;
    } finally {
      this.inflight.delete(cwd);
    }
  }

  private async compute(cwd: string): Promise<GitStatus | null> {
    let status: GitStatus | null = null;
    try {
      status = await this.runner(cwd, this.timeoutMs);
    } catch {
      status = null;
    }
    this.cache.set(cwd, { status, expires: this.now() + this.ttlMs });
    return status;
  }
}
