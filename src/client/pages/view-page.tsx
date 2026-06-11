/**
 * View host page — renders a single agent-authored view (design §7).
 * Header: Fraunces italic title, provenance line. View-local tab strip.
 * Active tab blocks rendered via BlockRenderer. Chat drawer (right): wired
 * to the built_by node's live session (same substrate as node-page).
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useView } from '../lib/use-views.js';
import { BlockRenderer } from '../views/block-renderer.js';
import { useCapability } from '../profile/provider.js';
import { useSessionStore } from '../store/session-store.js';
import { MessageList } from '../session/message-list.js';
import { PeekContext } from '../session/tool-card/parts.js';
import { cn } from '@/lib/utils.js';

export function ViewPage({ viewId, tab }: { viewId: string; tab?: string }): React.ReactElement {
  const { view, loading, error } = useView(viewId);
  const hasDrawer = useCapability('views.host');
  const navigate = useNavigate();

  if (loading) return <ViewSkeleton />;

  if (error || !view) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p
            className="text-muted-foreground"
            style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: '22px' }}
          >
            View not found
          </p>
          <p className="mt-2 text-sm text-muted-foreground/60">
            {error ?? `No view with id "${viewId}"`}
          </p>
        </div>
      </div>
    );
  }

  const activeTab =
    (tab ? view.tabs.find((t) => t.id === tab) : undefined) ?? view.tabs[0];

  return (
    <div className="flex h-full min-h-0">
      {/* ── main view area ── */}
      <div className="min-h-0 flex-1 overflow-auto px-11 py-8">
        {/* view-head: Fraunces italic title · provenance · switch */}
        <div className="flex items-end" style={{ gap: '18px', marginBottom: '6px' }}>
          <h1
            className="view-title"
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              fontWeight: 430,
              fontSize: '36px',
              letterSpacing: '-0.01em',
              lineHeight: 1.1,
              color: 'var(--ink)',
            }}
          >
            {view.title}
          </h1>
          <div style={{ fontSize: '12px', color: 'var(--mut)', paddingBottom: '7px' }}>
            {view.built_by ? (
              <>
                built by{' '}
                <span className="mono" style={{ color: 'var(--dim)', fontSize: '11px' }}>
                  {view.built_by}
                </span>{' '}
                · updated {relativeTime(view.updated_at)} · only you
              </>
            ) : (
              <>updated {relativeTime(view.updated_at)} · only you</>
            )}
          </div>
          <div
            className="ml-auto flex items-center"
            style={{ gap: '9px', paddingBottom: '6px', fontSize: '11.5px', color: 'var(--mut)' }}
          >
            switch view <span className="kbd">⌘K</span>
          </div>
        </div>

        {/* view-local tabs */}
        <div
          className="flex border-b border-border"
          style={{ gap: '2px', margin: '18px 0 26px' }}
        >
          {view.tabs.map((t) => {
            const isActive = t.id === activeTab?.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() =>
                  navigate(`/views/${encodeURIComponent(view.id)}/${encodeURIComponent(t.id)}`)
                }
                className={cn(
                  'transition-colors',
                  isActive ? 'text-[color:var(--ink)]' : 'text-[color:var(--mut)] hover:text-[color:var(--ink2)]',
                )}
                style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  padding: '9px 16px',
                  marginBottom: '-1px',
                  borderBottom: `2px solid ${isActive ? 'var(--bone)' : 'transparent'}`,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* block content */}
        {activeTab && <BlockRenderer blocks={activeTab.blocks} />}

        {/* view-foot */}
        <div
          className="flex items-center"
          style={{ marginTop: '14px', gap: '10px', fontSize: '11.5px', color: 'var(--dim)' }}
        >
          <span
            className="instlabel"
            style={{
              border: '1px solid var(--line)',
              borderRadius: '99px',
              padding: '3px 11px',
              fontSize: '8.5px',
              color: 'var(--mut)',
            }}
          >
            view
          </span>
          Assembled by the swarm from node reports — edit, pin, or share it like any view.
        </div>
      </div>

      {/* ── chat drawer — live session for built_by node ── */}
      {hasDrawer && view.built_by && <ChatDrawerShell builtBy={view.built_by} />}
    </div>
  );
}

// ─── Chat drawer — wired to built_by node's live session ──────────────────────
// Reuses the exact same session substrate as node-page: useSessionStore for
// attach/WS lifecycle, MessageList for the read flow, and the same canDrive
// derivation + auto-control grab (Studio semantics: no manual arbitration UI).
// When built_by is null the drawer is hidden by the parent. If the session
// can't attach (node gone, broker down) a quiet one-line empty state is shown.

function ChatDrawerShell({ builtBy }: { builtBy: string | null }): React.ReactElement {
  // builtBy is always non-null here (parent hides when null), but TypeScript
  // needs the runtime guard. Render nothing if somehow called with null.
  if (!builtBy) return <></>;
  return <ChatDrawerLive nodeId={builtBy} />;
}

function ChatDrawerLive({ nodeId }: { nodeId: string }): React.ReactElement {
  const store = useSessionStore(nodeId);
  const [input, setInput] = useState('');

  // Mirror node-page's canDrive derivation exactly — do not invent new logic.
  const dormant = store.source === 'static';
  const brokerUp = store.brokerStatus === 'connected' || store.brokerStatus === 'revived';
  const isController = store.role === 'controller';
  const streaming = store.state?.isStreaming ?? false;
  const canDrive = isController && !dormant && brokerUp && store.serverConnected;

  // Auto-grab controller slot on open, re-arm on socket reconnect (design §4.3).
  // This is the Studio path — no manual arbitration UI in the drawer.
  const autoControlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!store.socketReady) autoControlRef.current = null;
  }, [store.socketReady]);
  useEffect(() => {
    if (dormant) return;
    if (!store.socketReady || !brokerUp) return;
    if (store.role === 'controller') return;
    if (autoControlRef.current === nodeId) return;
    autoControlRef.current = nodeId;
    store.requestControl();
  }, [dormant, store.socketReady, brokerUp, store.role, nodeId, store]);

  const send = (): void => {
    const text = input.trim();
    if (!text || !canDrive) return;
    if (streaming) store.steer(text);
    else store.prompt(text);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Quiet one-line empty state when broker is unreachable or node is gone.
  const unreachable = !brokerUp && !dormant && store.serverConnected;

  // PeekContext: drawer has no file-peek panel, so onPeek is a no-op.
  const peekNoop = useRef({ peekedPath: null as string | null, onPeek: (_: string) => {} });

  return (
    <div
      className="flex w-[372px] shrink-0 flex-col border-l"
      style={{
        borderColor: 'rgba(40,36,26,.1)',
        background: 'var(--card)',
        boxShadow: 'inset 1px 0 0 rgba(255,255,255,.7)',
      }}
    >
      {/* drawer header */}
      <div
        className="flex shrink-0 items-center gap-2.5 border-b px-[18px] py-3.5"
        style={{ borderColor: 'rgba(40,36,26,.1)' }}
      >
        <span
          className="flex-1"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            fontSize: '15px',
            color: 'var(--foreground)',
          }}
        >
          Chat
        </span>
        <span
          className="rounded-full border px-2.5 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground"
          style={{ fontFamily: 'var(--font-inst)', borderColor: 'var(--border)' }}
        >
          {nodeId}
        </span>
      </div>

      {/* message stream */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {unreachable ? (
          <p className="px-[18px] py-5 text-sm italic text-muted-foreground/50">
            Node is unreachable — messages will appear when it reconnects.
          </p>
        ) : (
          <PeekContext.Provider value={peekNoop.current}>
            <MessageList messages={store.messages} streaming={streaming} />
          </PeekContext.Provider>
        )}
      </div>

      {/* composer footer */}
      <div className="shrink-0 px-4 pb-[18px] pt-3.5">
        <div
          className={cn(
            'flex items-end gap-3 rounded-2xl border px-5 py-2 text-[13.5px]',
            canDrive ? 'text-foreground' : 'text-muted-foreground/60',
          )}
          style={{
            borderColor: 'var(--border)',
            background: 'var(--background)',
            boxShadow: '0 10px 30px -14px rgba(60,50,30,.2)',
          }}
        >
          <textarea
            className="flex-1 resize-none bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/50"
            rows={1}
            disabled={!canDrive}
            placeholder="Refine this view…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ lineHeight: '1.5' }}
          />
          <button
            type="button"
            disabled={!canDrive || !input.trim()}
            onClick={send}
            className="mb-0.5 rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-opacity disabled:opacity-40"
          >
            {streaming ? 'Steer' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Route wrapper ────────────────────────────────────────────────────────────

export function ViewPageRoute(): React.ReactElement {
  const { viewId, tab } = useParams<{ viewId: string; tab?: string }>();
  return <ViewPage viewId={viewId ?? ''} tab={tab} />;
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function ViewSkeleton(): React.ReactElement {
  return (
    <div className="px-11 py-8">
      <div className="mb-2 h-9 w-1/3 animate-pulse rounded-lg bg-muted" />
      <div className="mb-5 h-3 w-1/4 animate-pulse rounded bg-muted/60" />
      <div className="mb-8 h-px w-full bg-border" />
      <div className="mb-4 grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: '7fr 5fr' }}>
        <div className="h-56 animate-pulse rounded-lg bg-muted" />
        <div className="h-56 animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
