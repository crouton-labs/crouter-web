/**
 * Inbox — the web rendering of pending humanloop decks (design §5.2, §5.6). ONE
 * composed page for both audiences: a single ranked list, oldest-blocked first
 * (the server sorts; urgency communicated by wait time, not nagging). Each row
 * shows the ask, a kind glyph, how long it has waited, and its provenance.
 *
 * THE provenance rule (enforced in review): Studio shows the asking
 * *conversation*, never a node id; Operator additionally shows the node id +
 * sub-DAG scoping and links to node detail. This is gated on the `node.internals`
 * capability — never on the profile name. Same code path, more slots granted.
 *
 * Inbox-zero is a genuine reward state; loading is a skeleton list; a deck
 * handled elsewhere self-removes (the list refetches off the live canvas feed).
 */

import { Link, useNavigate } from 'react-router-dom';
import type { DeckSummary } from '../../shared/protocol.js';
import { useDecks } from '../lib/use-decks.js';
import { useCapability } from '../profile/provider.js';
import { DECK_KIND_META, waitedFor } from '../lib/deck-presentation.js';
import { cn } from '@/lib/utils.js';

export function InboxPage() {
  const { decks, loading } = useDecks();

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-3xl flex-col px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        {decks.length > 0 && (
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-medium text-primary">
            {decks.length}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <SkeletonRows />
        ) : decks.length === 0 ? (
          <InboxZero />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {decks.map((d) => (
              <DeckRow key={d.id} deck={d} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DeckRow({ deck }: { deck: DeckSummary }) {
  const navigate = useNavigate();
  const meta = DECK_KIND_META[deck.kind];
  const Icon = meta.icon;
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={() => navigate(`/inbox/${encodeURIComponent(deck.id)}`)}
        className="flex w-full items-start gap-4 rounded-2xl border border-border bg-card px-5 py-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
          title={meta.label}
        >
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-semibold">{deck.title}</span>
            <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              {meta.label}
            </span>
          </div>
          {deck.subtitle && (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{deck.subtitle}</p>
          )}
          <DeckProvenance deck={deck} className="mt-1.5" />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground/70" title={`waiting ${waitedFor(deck.blocked_since)}`}>
          {waitedFor(deck.blocked_since)}
        </span>
      </button>
    </li>
  );
}

/**
 * Provenance line. The conversation is always shown (consumer-safe). The asking
 * node id + a node-detail link appear ONLY where `node.internals` is granted
 * (Operator) — capability-gated, never `profile === 'operator'`. Studio never
 * renders the node id.
 */
export function DeckProvenance({ deck, className }: { deck: DeckSummary; className?: string }) {
  const showInternals = useCapability('node.internals');
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs', className)}>
      <span className="text-muted-foreground">
        in <span className="font-medium text-foreground/80">{deck.conversation_title}</span>
      </span>
      {showInternals && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <Link
            to={`/nodes/${encodeURIComponent(deck.asking_node_id)}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-muted-foreground hover:text-primary hover:underline"
            title={deck.cwd}
          >
            {deck.asking_node_name} ({deck.asking_node_id})
          </Link>
          <span className="text-muted-foreground/40">·</span>
          <span className="font-mono text-muted-foreground/60" title={deck.cwd}>
            {deck.cwd}
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function InboxZero() {
  return (
    <div className="flex h-full flex-col items-center justify-center py-16 text-center">
      <p className="text-lg font-medium text-foreground">You&apos;re all caught up.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Nothing needs your input right now.
      </p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul className="flex flex-col gap-2.5">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4"
        >
          <div className="size-9 shrink-0 animate-pulse rounded-xl bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted/70" />
          </div>
        </li>
      ))}
    </ul>
  );
}
