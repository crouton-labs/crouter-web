// GitBranchCache (design D13) — per-cwd TTL cache of the current git branch over a
// bounded-timeout `git -C <cwd> rev-parse --abbrev-ref HEAD`. A non-git cwd, a git
// error, or a timeout resolves to `null` (a neutral placeholder, spec F.2). This
// class NEVER throws to its caller — branch computation must never block or break
// the chrome/stream path.

import { execFile } from "node:child_process";

/** Resolve the current branch for `cwd`, or `null` when it cannot be determined. */
export type GitRunner = (cwd: string, timeoutMs: number) => Promise<string | null>;

interface CacheEntry {
  branch: string | null;
  expires: number;
}

export interface GitBranchCacheOptions {
  /** Cache TTL in ms (design D13 ~10s). */
  ttlMs?: number;
  /** Per-call git timeout in ms. */
  timeoutMs?: number;
  /** Injected git runner (tests pass a mock); defaults to a real bounded exec. */
  runner?: GitRunner;
  /** Clock injection for tests. */
  now?: () => number;
}

/** Default runner: `git -C <cwd> rev-parse --abbrev-ref HEAD`, bounded, null on any failure. */
export const defaultGitRunner: GitRunner = (cwd, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const branch = stdout.toString().trim();
        resolve(branch.length > 0 ? branch : null);
      },
    );
  });

export class GitBranchCache {
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly runner: GitRunner;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  /** In-flight computations, de-duped per cwd so a TTL miss never fans out N execs. */
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(opts: GitBranchCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 10_000;
    this.timeoutMs = opts.timeoutMs ?? 1_000;
    this.runner = opts.runner ?? defaultGitRunner;
    this.now = opts.now ?? Date.now;
  }

  /** Current branch for `cwd` (cached within TTL); `null` for non-git/timeout/error. */
  async getBranch(cwd: string): Promise<string | null> {
    const hit = this.cache.get(cwd);
    if (hit && hit.expires > this.now()) return hit.branch;

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

  private async compute(cwd: string): Promise<string | null> {
    let branch: string | null = null;
    try {
      branch = await this.runner(cwd, this.timeoutMs);
    } catch {
      branch = null;
    }
    this.cache.set(cwd, { branch, expires: this.now() + this.ttlMs });
    return branch;
  }
}
