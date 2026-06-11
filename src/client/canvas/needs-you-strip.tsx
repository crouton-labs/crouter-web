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
import type { DeckSummary } from '../../shared/protocol.js';
import { useDecks } from '../lib/use-decks.js';
import { getDeck, resolveDeck, RestError } from '../net/rest.js';
import { DECK_KIND_META, waitedFor } from '../lib/deck-presentation.js';
import { toast } from '../lib/toast.js';

/** Inline `--i` reveal-stagger var without fighting the CSSProperties type. */
const rvStyle = (i: number): React.CSSProperties => ({ ['--i' as string]: i }) as React.CSSProperties;

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
    <section className="needs rv" style={rvStyle(3)}>
      <div className="needs-head">
        <span className="flag">⚑</span>
        <span className="instlabel">Needs you — {decks.length} blocked</span>
        <div className="rule" />
      </div>

      <div className="needs-grid">
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
    <div className="deck">
      <div className="deck-meta">
        <span className="deck-kind">{kindLabel}</span>
        <span className="from">{deck.asking_node_name}</span>
        <span className="age">blocked {age}</span>
      </div>

      <p className="deck-q line-clamp-2">{deck.title}</p>

      <div className="deck-actions">
        {/* notify → ack */}
        {deck.kind === 'notify' && (
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() => void handleResolve('ack')}
          >
            Got it
          </button>
        )}

        {/* validation → approve / reject */}
        {deck.kind === 'validation' && (
          <>
            <button
              type="button"
              className="btn sm primary"
              disabled={busy}
              onClick={() => void handleResolve('yes')}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => void handleResolve('no')}
            >
              Reject
            </button>
          </>
        )}

        {/* decision ≤3 options → inline option buttons */}
        {showDecisionButtons &&
          decisionOptions!.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => void handleDecisionOption(opt.id)}
            >
              {opt.label}
            </button>
          ))}

        {/* "open thread →" quiet link — always present */}
        <button
          type="button"
          className="btn sm"
          disabled={busy}
          onClick={() => navigate(`/inbox/${encodeURIComponent(deck.id)}`)}
          style={{ marginLeft: 'auto', borderColor: 'transparent', color: 'var(--dim)' }}
        >
          open thread →
        </button>
      </div>
    </div>
  );
}
