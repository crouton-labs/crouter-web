/**
 * Per-node chrome bar (spec §5.F). Identity (name/kind/mode/lifecycle/status,
 * cwd) comes from the node detail fetched by the page; live chrome (branch,
 * model, token burn, context usage, tool-call activity, stats) comes from the
 * session store's server-pushed `chrome()` + `state()` (D12 — rendered, never
 * computed from raw events). The streaming/idle indicator (C.10) reads
 * `state().isStreaming`. A dormant view (source()==='static') is marked
 * "last-known, not live" and omits tool_calls/stats/context% per F.4.
 */

import { Show, type JSX } from 'solid-js';
import type { NodeDetail } from '../../shared/protocol.js';
import type { SessionStore } from '../store/session-store.js';

export function ChromeBar(props: {
  store: SessionStore;
  detail: () => NodeDetail | null;
}): JSX.Element {
  const chrome = () => props.store.chrome();
  const dormant = () => props.store.source() === 'static';
  const streaming = () => props.store.state()?.isStreaming ?? false;
  const d = () => props.detail();

  return (
    <div class="chrome-bar" classList={{ dormant: dormant() }}>
      <div class="chrome-identity">
        <Show when={d()} fallback={<span class="chrome-name">…</span>}>
          {(detail) => (
            <>
              <span class="chrome-name">{detail().name}</span>
              <span class="chrome-tag">{detail().kind}</span>
              <span class="chrome-tag">{detail().mode}</span>
              <span class="chrome-tag">{detail().lifecycle}</span>
              <span class={`chrome-status status-${detail().status}`}>{detail().status}</span>
            </>
          )}
        </Show>
        <span class="chrome-stream" classList={{ active: streaming() }}>
          {streaming() ? '● streaming' : '○ idle'}
        </span>
        <Show when={dormant()}>
          <span class="chrome-dormant-flag" title="dormant node — last-known values, not live">
            last-known (not live)
          </span>
        </Show>
      </div>

      <div class="chrome-stats">
        <Show when={d()?.cwd}>
          {(cwd) => (
            <span class="chrome-field" title={cwd()}>
              <span class="chrome-label">cwd</span> {cwd()}
            </span>
          )}
        </Show>
        <span class="chrome-field">
          <span class="chrome-label">branch</span> {chrome().branch ?? d()?.branch ?? '—'}
        </span>
        <span class="chrome-field">
          <span class="chrome-label">model</span> {chrome().model ?? '—'}
        </span>
        <Show when={chrome().tokens}>
          {(t) => (
            <span class="chrome-field" title="input / output / cache tokens">
              <span class="chrome-label">tokens</span> {t().input.toLocaleString()} in /{' '}
              {t().output.toLocaleString()} out
              <Show when={t().cache !== undefined}> / {t().cache!.toLocaleString()} cache</Show>
            </span>
          )}
        </Show>
        {/* Context usage percent is omitted for a dormant node (no window denominator, F.4). */}
        <Show when={chrome().context}>
          {(ctx) => (
            <span class="chrome-field">
              <span class="chrome-label">context</span> {ctx().tokens.toLocaleString()}
              <Show when={!dormant()}> / {ctx().window.toLocaleString()} ({fmtPercent(ctx().percent)}%)</Show>
            </span>
          )}
        </Show>
        {/* tool-call activity + session stats are live-only (F.4). */}
        <Show when={!dormant() && chrome().tool_calls !== null}>
          <span class="chrome-field" classList={{ 'tool-active': streaming() }}>
            <span class="chrome-label">tools</span> {chrome().tool_calls}
          </span>
        </Show>
        <Show when={!dormant() && chrome().stats}>
          {(s) => (
            <span class="chrome-field" title="turns · user / assistant messages">
              <span class="chrome-label">turns</span> {s().turns} · {s().user_messages}/
              {s().assistant_messages} msgs
              <Show when={s().cost !== undefined}> · ${s().cost!.toFixed(2)}</Show>
            </span>
          )}
        </Show>
      </div>
    </div>
  );
}

/** Trim float noise from a context-usage percent (e.g. 0.87399999 → 0.874),
 *  keeping enough precision for sub-1% windows. */
function fmtPercent(percent: number): string {
  return String(Math.round(percent * 1000) / 1000);
}
