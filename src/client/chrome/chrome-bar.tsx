/**
 * Per-node chrome, split into the two slots of the session screen (design
 * §3.3): TitleBar = identity (name/kind/mode/lifecycle/status), the `header`
 * slot (no capability — always present); ChromePanel = live chrome
 * (cwd/branch/model/token burn/context usage/tool activity/stats), the `chrome`
 * slot (capability `node.internals`). Identity comes from the page-fetched node
 * detail; live chrome comes from the session store's server-pushed chrome +
 * state (D12 — rendered, never computed from raw events). The streaming/idle
 * indicator (C.10) reads state.isStreaming. A dormant view (source==='static')
 * is marked "last-known, not live" and omits tool_calls/stats/context% per F.4.
 * For Operator both slots render together inside the page's flex-col wrapper,
 * reproducing the previous single ChromeBar exactly.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.js';
import type { BrokerStatus, NodeDetail, SessionState } from '../../shared/protocol.js';
import type { NodeChrome } from '../store/session-store.js';
import { useCapability } from '../profile/provider.js';

/** React-compatible subset of the session store — plain values, not signal accessors. */
interface ChromeBarStore {
  chrome: NodeChrome;
  state: SessionState | null;
  source: 'broker' | 'static';
  brokerStatus: BrokerStatus;
}

/**
 * The status pill is derived from the LIVE connection/broker state, not the
 * (possibly stale) DB row carried on `detail`. After a revive the DB row can
 * still read "canceled"/"done" for a beat while the broker is already live;
 * deriving from `source`/`brokerStatus`/streaming keeps the pill honest.
 */
function livePillStatus(
  d: NodeDetail,
  source: 'broker' | 'static',
  brokerStatus: BrokerStatus,
  streaming: boolean,
): string {
  if (source === 'static') return d.status; // dormant — last-known DB row
  if (brokerStatus === 'down') return 'dead';
  if (brokerStatus === 'reconnecting') return 'idle';
  return streaming ? 'active' : 'idle'; // live broker — reflect live activity
}

/**
 * Status as a single plain-language word (Studio slim header). Derived from the
 * LIVE connection/broker state, not the (possibly stale) DB row — same honesty
 * rule as `livePillStatus`, just worded softly for a consumer.
 */
function statusWord(
  d: NodeDetail,
  source: 'broker' | 'static',
  brokerStatus: BrokerStatus,
  streaming: boolean,
): string {
  if (source === 'static') {
    return d.status === 'done' || d.status === 'dead' || d.status === 'canceled'
      ? 'Finished'
      : 'Paused';
  }
  if (brokerStatus === 'down' || brokerStatus === 'reconnecting') return 'Reconnecting…';
  return streaming ? 'Working…' : 'Idle';
}

/** Identity line — the `header` slot. Always present (no capability), but the
 *  internals audience (Operator) sees the full identity row while a consumer
 *  audience (Studio) sees a slim title + a status word. Capability-driven. */
export function TitleBar(props: {
  store: ChromeBarStore;
  detail: NodeDetail | null;
}): ReactNode {
  const dormant = props.store.source === 'static';
  const streaming = props.store.state?.isStreaming ?? false;
  const d = props.detail;
  const showInternals = useCapability('node.internals');

  if (!showInternals) {
    const word = d ? statusWord(d, props.store.source, props.store.brokerStatus, streaming) : '…';
    const working = word === 'Working…';
    return (
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-lg font-semibold truncate">{d?.name ?? '…'}</span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-sm',
            working ? 'text-success' : 'text-muted-foreground',
          )}
        >
          {working && <span className="size-1.5 animate-pulse rounded-full bg-success" />}
          {word}
        </span>
      </div>
    );
  }

  const pillStatus = d
    ? livePillStatus(d, props.store.source, props.store.brokerStatus, streaming)
    : null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
        {d ? (
          <>
            <span className="font-mono text-sm font-semibold truncate">{d.name}</span>
            <Chip>{d.kind}</Chip>
            <Chip>{d.mode}</Chip>
            <Chip>{d.lifecycle}</Chip>
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-xs"
              style={{ color: `var(--status-${pillStatus})`, borderColor: `var(--status-${pillStatus})66` }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: `var(--status-${pillStatus})` }}
              />
              {pillStatus}
            </span>
          </>
        ) : (
          <span className="font-mono text-sm font-semibold">…</span>
        )}
      <span
        className={cn('font-mono text-xs', streaming ? 'text-success' : 'text-muted-foreground')}
      >
        {streaming ? '● streaming' : '○ idle'}
      </span>
      {dormant && (
        <span
          className="font-mono text-xs text-warning"
          title="dormant node — last-known values, not live"
        >
          last-known (not live)
        </span>
      )}
    </div>
  );
}

/** Live chrome line — the `chrome` slot (capability `node.internals`). */
export function ChromePanel(props: {
  store: ChromeBarStore;
  detail: NodeDetail | null;
}): ReactNode {
  const chrome = props.store.chrome;
  const dormant = props.store.source === 'static';
  const streaming = props.store.state?.isStreaming ?? false;
  const d = props.detail;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground">
        {d?.cwd && (
          <Field label="cwd" title={d.cwd} className="min-w-0">
            <span className="truncate">{d.cwd}</span>
          </Field>
        )}
        <Field label="branch">{chrome.branch ?? d?.branch ?? '—'}</Field>
        <Field label="model">{chrome.model ?? '—'}</Field>
        {chrome.tokens && (
          <Field label="tokens" title="input / output / cache tokens">
            {chrome.tokens.input.toLocaleString()} in / {chrome.tokens.output.toLocaleString()} out
            {chrome.tokens.cache !== undefined && (
              <> / {chrome.tokens.cache.toLocaleString()} cache</>
            )}
          </Field>
        )}
        {/* Context usage percent is omitted for a dormant node (no window denominator, F.4). */}
        {chrome.context && (
          <Field label="context">
            {chrome.context.tokens.toLocaleString()}
            {!dormant && (
              <> / {chrome.context.window.toLocaleString()} ({fmtPercent(chrome.context.percent)}%)</>
            )}
          </Field>
        )}
        {/* tool-call activity + session stats are live-only (F.4). */}
        {!dormant && chrome.tool_calls !== null && (
          <Field label="tools" className={cn(streaming && 'text-success')}>
            {chrome.tool_calls}
          </Field>
        )}
        {!dormant && chrome.stats && (
          <Field label="turns" title="turns · user / assistant messages">
            {chrome.stats.turns} · {chrome.stats.user_messages}/{chrome.stats.assistant_messages} msgs
            {chrome.stats.cost !== undefined && <> · ${chrome.stats.cost.toFixed(2)}</>}
          </Field>
        )}
    </div>
  );
}

/** A muted identity chip (kind / mode / lifecycle). */
function Chip({ children }: { children: ReactNode }): ReactNode {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {children}
    </span>
  );
}

/** A labelled `LABEL value` stat field. */
function Field({
  label,
  children,
  title,
  className,
}: {
  label: string;
  children: ReactNode;
  title?: string;
  className?: string;
}): ReactNode {
  return (
    <span className={cn('inline-flex items-center gap-1', className)} title={title}>
      <span className="uppercase tracking-wide text-muted-foreground/50">{label}</span>
      {children}
    </span>
  );
}

/** Trim float noise from a context-usage percent (e.g. 0.87399999 → 0.874),
 *  keeping enough precision for sub-1% windows. */
function fmtPercent(percent: number): string {
  return String(Math.round(percent * 1000) / 1000);
}
