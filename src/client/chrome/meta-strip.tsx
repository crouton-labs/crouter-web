/**
 * Meta strip (2b) — one quiet mono line of node context for the `chrome` slot.
 * Replaces the telemetry-heavy ChromePanel for the Operator audience.
 * Format: ⎇ main +3 ~2 · ~/Code/project · claude-fable-5 · ctx 31k / 1M
 */

import type { ReactNode } from 'react';
import type { NodeDetail } from '../../shared/protocol.js';
import type { NodeChrome } from '../store/session-store.js';

interface Props {
  store: { chrome: NodeChrome };
  detail: NodeDetail | null;
}

export function MetaStrip({ store, detail }: Props): ReactNode {
  const chrome = store.chrome;
  const parts: ReactNode[] = [];

  // Branch + git status
  const branch = chrome.branch ?? detail?.branch ?? null;
  if (branch !== null) {
    const gs = chrome.git_status ?? detail?.git_status ?? null;
    const added = gs?.added ?? 0;
    const modified = gs?.modified ?? 0;

    parts.push(
      <span key="branch">
        ⎇ {branch}
        {added > 0 && (
          <span style={{ color: 'var(--status-active)' }}> +{added}</span>
        )}
        {modified > 0 && (
          <span style={{ color: 'var(--status-idle)' }}> ~{modified}</span>
        )}
      </span>,
    );
  }

  // cwd
  const cwd = detail?.cwd ?? null;
  if (cwd !== null) {
    parts.push(<span key="cwd">{abbreviateCwd(cwd)}</span>);
  }

  // model
  const model = chrome.model ?? detail?.model ?? null;
  if (model !== null) {
    parts.push(<span key="model">{model}</span>);
  }

  // ctx
  const ctx = chrome.context ?? null;
  if (ctx !== null) {
    parts.push(
      <span key="ctx">
        ctx {fmtK(ctx.tokens)} / {fmtK(ctx.window)}
      </span>,
    );
  }

  if (parts.length === 0) return null;

  return (
    <div
      className="flex min-w-0 items-center gap-0 font-mono text-[11px] text-muted-foreground"
      style={{ fontFamily: 'var(--font-code, monospace)' }}
    >
      {parts.map((part, i) => (
        <span key={i} className="flex items-center">
          {i > 0 && <span className="mx-1.5 select-none opacity-30">·</span>}
          {part}
        </span>
      ))}
    </div>
  );
}

/** Abbreviate home directory prefix with ~; fall back to last 2 path segments. */
function abbreviateCwd(cwd: string): string {
  // Heuristic: /Users/<name>/... or /home/<name>/... → ~/...
  const homeMatch = cwd.match(/^\/(?:Users|home)\/[^/]+(\/.*)$/);
  if (homeMatch) return `~${homeMatch[1]}`;
  // Fallback: last 2 segments
  const parts = cwd.split('/').filter(Boolean);
  if (parts.length <= 2) return cwd;
  return `…/${parts.slice(-2).join('/')}`;
}

/** Round a token count to nearest 1k or 1M, formatted compactly. */
function fmtK(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
