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
import type { AgentMessage, ToolResultMessage } from '../../shared/protocol.js';
import { MessageView } from './message-view.js';
import { DensityContext, type Density } from '../lib/density-context.js';
import { cn } from '@/lib/utils.js';

export interface MessageListProps {
  /** The folded message history. */
  messages: AgentMessage[];
  /** True while the engine is producing a turn. */
  streaming: boolean;
}

interface Derived {
  visible: AgentMessage[];
  resultMap: Map<string, ToolResultMessage>;
  lastAssistant: AgentMessage | undefined;
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
    let lastAssistant: AgentMessage | undefined;
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
    return { visible, resultMap, lastAssistant };
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
      {/* Density control bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[10px] uppercase tracking-[0.1em] font-mono text-muted-foreground/50">
          Session
        </span>
        <div className="flex gap-0.5 rounded bg-muted/60 p-0.5">
          {(['compact', 'full'] as Density[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDensity(d)}
              className={cn(
                'px-2 py-0.5 text-[10px] font-mono rounded transition-colors',
                density === d
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
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
