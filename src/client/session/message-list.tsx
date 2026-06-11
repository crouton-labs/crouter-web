/**
 * MessageList — virtualized message history (spec C.9 / AC-10).
 *
 * Renders only visible rows via `@tanstack/react-virtual`. Sticky-bottom
 * auto-scroll yields to the user the moment they scroll up, and restores when
 * they return to the bottom. Tool results whose call exists in history are
 * filtered from the row list here (they render inside the assistant's card).
 */

import { useMemo, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FoldedMessage, ToolResultMessage } from '../../shared/protocol.js';
import { MessageView } from './message-view.js';
import { DensityContext, type Density } from '../lib/density-context.js';
import { cn } from '@/lib/utils.js';

export interface MessageListProps {
  /** The folded message history. */
  messages: FoldedMessage[];
  /** True while the engine is producing a turn. */
  streaming: boolean;
}

interface Derived {
  visible: FoldedMessage[];
  resultMap: Map<string, ToolResultMessage>;
  lastAssistant: FoldedMessage | undefined;
  /** Per-row turn label (e.g. "turn 3") for the first row of each turn, else null. */
  turnLabels: (string | null)[];
}

const DENSITY_KEY = 'crtr-density';

export function MessageList({ messages, streaming }: MessageListProps) {
  const [density, setDensityState] = useState<Density>(() => {
    try {
      const stored = localStorage.getItem(DENSITY_KEY);
      if (stored === 'compact' || stored === 'full') return stored;
    } catch {
      // localStorage unavailable
    }
    return 'full';
  });

  const setDensity = (d: Density) => {
    setDensityState(d);
    try { localStorage.setItem(DENSITY_KEY, d); } catch { /* ignore */ }
  };

  // Single pass over history → row list, tool-result lookup, last-assistant ref.
  const derived = useMemo<Derived>(() => {
    const resultMap = new Map<string, ToolResultMessage>();
    const callIds = new Set<string>();
    let lastAssistant: FoldedMessage | undefined;
    for (const m of messages) {
      if (m.role === 'assistant') {
        lastAssistant = m;
        for (const b of m.content) if (b.type === 'toolCall') callIds.add(b.id);
      } else if (m.role === 'toolResult') {
        resultMap.set(m.toolCallId, m);
      }
    }
    const visible = messages.filter(
      (m) => !(m.role === 'toolResult' && callIds.has(m.toolCallId)),
    );
    // A turn starts at each live user prompt (inbox-origin messages don't open a
    // turn — they're an inbound event mid-turn). Label the opening row only.
    let turn = 0;
    const turnLabels = visible.map((m) => {
      if (m.role === 'user' && m.origin !== 'inbox') {
        turn += 1;
        return `turn ${turn}`;
      }
      return null;
    });
    return { visible, resultMap, lastAssistant, turnLabels };
  }, [messages]);

  const rows = derived.visible;
  const resultFor = (id: string): ToolResultMessage | undefined => derived.resultMap.get(id);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Sticky-bottom: true while parked at (or near) the end; false when user scrolls up.
  const stuckRef = useRef(true);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 10,
  });

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stuckRef.current = gap < 48;
  };

  // Re-pin to the bottom whenever content grows or the trailing message mutates
  // (streaming deltas replace the last message object), unless the user scrolled
  // up. Tracking rows (reference changes on any mutation) + streaming covers
  // both new-turn arrivals and in-flight delta updates.
  useEffect(() => {
    if (!stuckRef.current) return;
    const n = rows.length;
    if (n > 0) queueMicrotask(() => virtualizer.scrollToIndex(n - 1, { align: 'end' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, streaming]);

  return (
    <DensityContext.Provider value={density}>
      {/* Stream bar — segmented density control (Quiet Instrument) */}
      <div className="flex items-center gap-[14px] px-[30px] pt-[18px] pb-[4px]">
        <span className="instlabel text-[var(--dim)]">Session</span>
        <div className="seg">
          {(['compact', 'full'] as Density[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDensity(d)}
              className={cn(density === d && 'on')}
            >
              {d === 'compact' ? 'Compact' : 'Full'}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex flex-col flex-1 overflow-auto py-2"
        onScroll={onScroll}
      >
        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const message = rows[vi.index];
            if (!message) return null;
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                className="px-[14px] py-[6px] box-border"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {derived.turnLabels[vi.index] && (
                  <div className="flex items-center gap-[12px] mt-[10px] mb-[14px]">
                    <span className="font-[family-name:var(--font-inst)] text-[8.5px] tracking-[0.16em] uppercase text-[var(--dim)]">
                      {derived.turnLabels[vi.index]}
                    </span>
                    <div className="flex-1 h-px bg-[var(--line)]" />
                  </div>
                )}
                <MessageView
                  message={message}
                  isLastAssistant={message === derived.lastAssistant}
                  streaming={streaming}
                  resultFor={resultFor}
                />
              </div>
            );
          })}
        </div>
      </div>
    </DensityContext.Provider>
  );
}
