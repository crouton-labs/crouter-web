/**
 * MessageList — the cross-worker contract (seam.md): Worker S consumes this,
 * Worker R owns it and ALL streaming-aware rendering beneath it.
 *
 * Virtualized (spec C.9 / AC-10) via `@tanstack/solid-virtual` so very long
 * histories don't freeze the browser — only the visible rows mount, measured
 * dynamically. Auto-scrolls to the bottom while new content arrives, but yields
 * to the user the moment they scroll up (sticky-bottom tracking).
 *
 * Pairing: a tool result whose tool-call exists in history is rendered inside
 * the assistant's tool card; it is filtered out of the row list here so it is
 * not also shown standalone. Orphan results (no matching call) stay visible.
 */

import { createMemo, createEffect, For, type JSX } from 'solid-js';
import { createVirtualizer } from '@tanstack/solid-virtual';
import type { AgentMessage, ToolResultMessage } from '../../shared/protocol.js';
import { MessageView } from './message-view.js';
import { ensureStyles } from './styles.js';

export interface MessageListProps {
  /** Reactive accessor for the folded message history (store-owned). */
  messages: () => AgentMessage[];
  /** Reactive accessor: is the engine currently producing a turn? */
  streaming: () => boolean;
}

interface Derived {
  visible: AgentMessage[];
  resultMap: Map<string, ToolResultMessage>;
  lastAssistant: AgentMessage | undefined;
}

export function MessageList(props: MessageListProps): JSX.Element {
  ensureStyles();

  // Single pass over history → row list, tool-result lookup, last-assistant id.
  const derived = createMemo<Derived>(() => {
    const msgs = props.messages();
    const resultMap = new Map<string, ToolResultMessage>();
    const callIds = new Set<string>();
    let lastAssistant: AgentMessage | undefined;
    for (const m of msgs) {
      if (m.role === 'assistant') {
        lastAssistant = m;
        for (const b of m.content) if (b.type === 'toolCall') callIds.add(b.id);
      } else if (m.role === 'toolResult') {
        resultMap.set(m.toolCallId, m);
      }
    }
    const visible = msgs.filter(
      (m) => !(m.role === 'toolResult' && callIds.has(m.toolCallId)),
    );
    return { visible, resultMap, lastAssistant };
  });

  const rows = (): AgentMessage[] => derived().visible;
  const resultFor = (id: string): ToolResultMessage | undefined => derived().resultMap.get(id);

  let scrollEl: HTMLDivElement | undefined;
  // Sticky-bottom: true while the user is parked at (or near) the end. Set false
  // when they scroll up, restored when they return to the bottom.
  let stuck = true;

  const virtualizer = createVirtualizer({
    get count() {
      return rows().length;
    },
    getScrollElement: () => scrollEl ?? null,
    estimateSize: () => 96,
    overscan: 10,
    getItemKey: (index) => index,
  });

  const onScroll = (): void => {
    if (!scrollEl) return;
    const gap = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    stuck = gap < 48;
  };

  const scrollToBottom = (): void => {
    const n = rows().length;
    if (n > 0) virtualizer.scrollToIndex(n - 1, { align: 'end' });
  };

  // Re-pin to the bottom whenever content grows or the trailing message mutates
  // (streaming deltas replace the last message object), unless the user scrolled
  // up. Reading rows() and the last row reference makes this fire on each delta.
  createEffect(() => {
    const r = rows();
    void r.length;
    void r[r.length - 1];
    void props.streaming();
    if (stuck) queueMicrotask(scrollToBottom);
  });

  return (
    <div class="cw-msglist" ref={scrollEl} onScroll={onScroll}>
      <div class="cw-msglist-inner" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        <For each={virtualizer.getVirtualItems()}>
          {(vi) => (
            <div
              class="cw-row"
              data-index={vi.index}
              ref={(el) => {
                // virtual-core reads `data-index` off the node (its dynamic-
                // measure ResizeObserver warns + discards a measurement when it
                // is absent). Solid can run this ref before committing the JSX
                // attribute, so set it imperatively first, then measure.
                el.setAttribute('data-index', String(vi.index));
                virtualizer.measureElement(el);
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <MessageView
                message={rows()[vi.index]}
                isLastAssistant={rows()[vi.index] === derived().lastAssistant}
                streaming={props.streaming}
                resultFor={resultFor}
              />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
