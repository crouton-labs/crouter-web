/**
 * Audience-neutral presentation helpers for decks (design §5.2). A deck kind
 * maps to a glyph + a short label; wait duration is formatted relatively. None
 * of this branches on profile — provenance gating lives in the components via
 * capability, not here.
 */

import { Bell, ShieldCheck, GitBranch, HelpCircle, AlertTriangle, type LucideIcon } from 'lucide-react';
import type { DeckKind } from '../../shared/protocol.js';

/** The five resolution flows, each with a glyph and a one-word label. */
export const DECK_KIND_META: Record<DeckKind, { icon: LucideIcon; label: string }> = {
  notify: { icon: Bell, label: 'Update' },
  validation: { icon: ShieldCheck, label: 'Approval' },
  decision: { icon: GitBranch, label: 'Decision' },
  context: { icon: HelpCircle, label: 'Question' },
  error: { icon: AlertTriangle, label: 'Problem' },
};

/** "12s" / "5m" / "3h" / "2d" since an ISO timestamp — compact, for inbox rows. */
export function waitedFor(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}
