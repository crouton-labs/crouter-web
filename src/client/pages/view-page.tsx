/**
 * View host page — renders a single agent-authored view (design §7).
 * Header: Fraunces italic title, provenance line. View-local tab strip.
 * Active tab blocks rendered via BlockRenderer. Chat drawer (right): shell
 * only — drawer with "Chat" header + placeholder stream. The full conversation
 * substrate wiring is a clean cut (would be >150 lines of new glue); the drawer
 * frame and layout are in place so it snaps in later.
 */

import { useNavigate, useParams } from 'react-router-dom';
import { useView } from '../lib/use-views.js';
import { BlockRenderer } from '../views/block-renderer.js';
import { useCapability } from '../profile/provider.js';
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
        {/* header */}
        <div className="mb-1 flex items-end gap-4">
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              fontWeight: 430,
              fontSize: '36px',
              letterSpacing: '-0.01em',
              lineHeight: 1.1,
              color: 'var(--foreground)',
            }}
          >
            {view.title}
          </h1>
        </div>
        <p className="mb-0 text-[12px] text-muted-foreground">
          {view.built_by ? (
            <>
              built by{' '}
              <span
                className="text-muted-foreground/70"
                style={{ fontFamily: 'var(--font-code)', fontSize: '11px' }}
              >
                {view.built_by}
              </span>{' '}
              ·{' '}
            </>
          ) : (
            'kept up to date for you · '
          )}
          refreshed {relativeTime(view.updated_at)}
        </p>

        {/* view-local tabs */}
        <div className="mb-6 mt-[18px] flex gap-0.5 border-b border-border">
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
                  'px-4 pb-2.5 pt-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-b-2 border-foreground text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                style={{ marginBottom: '-1px' }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* block content */}
        {activeTab && <BlockRenderer blocks={activeTab.blocks} />}
      </div>

      {/* ── chat drawer (shell — conversation wiring is a clean cut) ── */}
      {hasDrawer && <ChatDrawerShell builtBy={view.built_by} />}
    </div>
  );
}

// ─── Chat drawer shell (clean cut — conversation wiring not implemented) ─────
// Full wiring (connecting built_by node's session socket, message list, send)
// would require >150 lines of new glue between the session substrate and this
// drawer context. The shell provides the layout frame for a future snap-in.

function ChatDrawerShell({ builtBy }: { builtBy: string | null }): React.ReactElement {
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
        {builtBy && (
          <span
            className="rounded-full border px-2.5 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground"
            style={{ fontFamily: 'var(--font-inst)', borderColor: 'var(--border)' }}
          >
            {builtBy}
          </span>
        )}
      </div>

      {/* message stream placeholder */}
      <div className="flex-1 overflow-auto px-[18px] py-5">
        <p className="text-sm text-muted-foreground/50 italic">
          Chat wiring coming soon — the conversation substrate will connect here.
        </p>
      </div>

      {/* composer footer */}
      <div className="shrink-0 px-4 pb-[18px] pt-3.5">
        <div
          className="flex items-center gap-3 rounded-full border px-5 py-2 text-[13.5px] text-muted-foreground/60"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--background)',
            boxShadow: '0 10px 30px -14px rgba(60,50,30,.2)',
          }}
        >
          <span className="flex-1">Refine this view…</span>
          <button
            type="button"
            disabled
            className="rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background opacity-40"
          >
            Send
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
