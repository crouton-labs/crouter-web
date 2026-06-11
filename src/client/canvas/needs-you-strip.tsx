/**
 * "Needs you" triage strip — canvas surface §1.
 *
 * Renders above the node forest when any blocked decks exist. Shows a ranked
 * grid of deck cards with inline resolution for simple kinds (notify,
 * validation, decision ≤3 options) and a deep-link to /inbox/:id for all.
 * Empty-state: renders nothing.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import type { DeckSummary } from '../../shared/protocol.js';
import { useDecks } from '../lib/use-decks.js';
import { getDeck, resolveDeck, RestError } from '../api/rest.js';
import { DECK_KIND_META, waitedFor } from '../lib/deck-presentation.js';
import { toast } from '../lib/toast.js';
import { Button } from '@/components/ui/button.js';

// ─── inline resolve helper (mirrors inline-asks.tsx; kept local to avoid
//     touching that file since it's owned by the other agent) ─────────────────

async function resolveSimple(
  deckId: string,
  choice: 'ack' | 'yes' | 'no',
): Promise<void> {
  const full = await getDeck(deckId);
  const it = full.interactions[0]!;
  const answer =
    choice === 'ack'
      ? { id: it.id }
      : {
          id: it.id,
          selectedOptionId:
            (choice === 'yes'
              ? it.options.find((o) => o.id === 'yes')?.id ?? it.options[0]?.id
              : it.options.find((o) => o.id === 'no')?.id ??
                it.options[1]?.id) ?? choice,
        };
  await resolveDeck(deckId, { responses: [answer] });
}

// ─── strip ───────────────────────────────────────────────────────────────────

export function NeedsYouStrip(): React.ReactElement | null {
  const { decks, loading } = useDecks();
  if (loading || decks.length === 0) return null;

  return (
    <section className="relative z-[1] mb-4">
      {/* header row */}
      <div className="mb-3 flex items-center gap-3">
        <span
          className="instlabel"
          style={{ color: 'var(--status-blocked)' }}
        >
          Needs you — {decks.length} blocked
        </span>
        {/* gradient hairline */}
        <div
          className="h-px flex-1"
          style={{
            background:
              'linear-gradient(to right, var(--status-blocked), transparent)',
            opacity: 0.4,
          }}
        />
      </div>

      {/* 2-col card grid */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {decks.map((deck) => (
          <DeckCard key={deck.id} deck={deck} />
        ))}
      </div>
    </section>
  );
}

// ─── deck card ───────────────────────────────────────────────────────────────

function DeckCard({ deck }: { deck: DeckSummary }): React.ReactElement {
  const navigate = useNavigate();
  const { refetch } = useDecks();
  const [busy, setBusy] = useState(false);
  // For decision decks we may need option labels — lazy-fetched on first render
  // only if the deck has ≤3 options signalled by interaction_count.
  const [decisionOptions, setDecisionOptions] = useState<
    { id: string; label: string }[] | null
  >(null);
  const [optionsFetching, setOptionsFetching] = useState(false);

  const Icon = DECK_KIND_META[deck.kind].icon;
  const kindLabel = DECK_KIND_META[deck.kind].label;
  const age = waitedFor(deck.blocked_since);

  // Lazy-fetch decision options on mount for ≤3-option decision decks
  // so we can render inline buttons.
  const loadDecisionOptions = async (): Promise<void> => {
    if (deck.kind !== 'decision' || optionsFetching || decisionOptions !== null)
      return;
    setOptionsFetching(true);
    try {
      const full = await getDeck(deck.id);
      const opts = full.interactions[0]?.options ?? [];
      setDecisionOptions(opts.length <= 3 ? opts : []);
    } catch (err) {
      // Deck vanished before we could fetch options — treat as no inline buttons.
      if (
        err instanceof RestError &&
        (err.code === 'deck_not_found' || err.code === 'deck_already_resolved')
      ) {
        setDecisionOptions([]);
      } else {
        // Unexpected — surface in console; fall back to no inline buttons so the
        // card still renders with the "open thread" link.
        console.error('[needs-you] failed to load decision options:', err);
        setDecisionOptions([]);
      }
    } finally {
      setOptionsFetching(false);
    }
  };

  // Kick off the option fetch for decision decks immediately.
  if (deck.kind === 'decision' && decisionOptions === null && !optionsFetching) {
    void loadDecisionOptions();
  }

  const handleResolve = async (choice: 'ack' | 'yes' | 'no'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await resolveSimple(deck.id, choice);
      toast('Done — thanks!', 'success');
      refetch();
    } catch (err) {
      if (
        err instanceof RestError &&
        (err.code === 'deck_already_resolved' || err.code === 'deck_not_found')
      ) {
        toast('That request was already handled.');
        refetch();
        return;
      }
      console.error('[needs-you] resolve failed:', err);
      toast('Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleDecisionOption = async (optionId: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const full = await getDeck(deck.id);
      const it = full.interactions[0]!;
      await resolveDeck(deck.id, {
        responses: [{ id: it.id, selectedOptionId: optionId }],
      });
      toast('Done — thanks!', 'success');
      refetch();
    } catch (err) {
      if (
        err instanceof RestError &&
        (err.code === 'deck_already_resolved' || err.code === 'deck_not_found')
      ) {
        toast('That request was already handled.');
        refetch();
        return;
      }
      console.error('[needs-you] decision option resolve failed:', err);
      toast('Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  };

  const showDecisionButtons =
    deck.kind === 'decision' &&
    decisionOptions !== null &&
    decisionOptions.length > 0;

  return (
    <div
      className="panel-raise flex flex-col gap-2.5 rounded-lg border p-3"
      style={{
        background: 'var(--card)',
        borderColor: 'oklch(0.66 0.21 33 / 18%)',
      }}
    >
      {/* top row: kind chip + node name + age */}
      <div className="flex items-center gap-2">
        {/* kind chip */}
        <span
          className="instlabel inline-flex items-center gap-1 rounded px-1.5 py-0.5"
          style={{
            background: 'oklch(0.66 0.21 33 / 12%)',
            color: 'var(--status-blocked)',
          }}
        >
          <Icon className="size-2.5" />
          {kindLabel}
        </span>

        {/* asking node name — mono */}
        <span
          className="min-w-0 flex-1 truncate text-xs"
          style={{ fontFamily: 'var(--font-inst)', color: 'var(--muted-foreground)' }}
        >
          {deck.asking_node_name}
        </span>

        {/* age — right-aligned */}
        <span
          className="shrink-0 text-xs tabular-nums"
          style={{ color: 'var(--status-blocked)', opacity: 0.7 }}
        >
          blocked {age}
        </span>
      </div>

      {/* deck title */}
      <p className="line-clamp-2 text-sm font-medium leading-snug">{deck.title}</p>

      {/* actions row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* notify → ack */}
        {deck.kind === 'notify' && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void handleResolve('ack')}
            className="h-7 text-xs"
          >
            <Check className="mr-1 size-3" /> Got it
          </Button>
        )}

        {/* validation → approve / reject */}
        {deck.kind === 'validation' && (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void handleResolve('yes')}
              className="h-7 text-xs"
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void handleResolve('no')}
              className="h-7 text-xs"
            >
              Reject
            </Button>
          </>
        )}

        {/* decision ≤3 options → inline option buttons */}
        {showDecisionButtons &&
          decisionOptions!.map((opt) => (
            <Button
              key={opt.id}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void handleDecisionOption(opt.id)}
              className="h-7 text-xs"
            >
              {opt.label}
            </Button>
          ))}

        {/* "open thread →" quiet link — always present */}
        <button
          type="button"
          disabled={busy}
          onClick={() => navigate(`/inbox/${encodeURIComponent(deck.id)}`)}
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          open thread <ArrowRight className="size-3" />
        </button>
      </div>
    </div>
  );
}
