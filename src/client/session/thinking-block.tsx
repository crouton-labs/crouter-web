/**
 * Thinking content block (spec C.5 / AC-8).
 *
 * Visually distinct, COLLAPSIBLE block, separate from assistant text. Collapsed
 * by default; a header toggles it. Streams incrementally — the body shows the
 * growing `thinking` text as escaped plain text (no markdown; escaping keeps
 * any embedded markup inert). Left-border accent in the `thinking` token color.
 */

import { useState } from 'react';
import { escapeText } from '../render/sanitize.js';

export interface ThinkingBlockProps {
  thinking: string;
  /** True while still streaming — auto-expands so progress is visible. */
  inProgress: boolean;
}

export function ThinkingBlock({ thinking, inProgress }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  // Auto-reveal while actively streaming; user can still collapse; defaults
  // collapsed once finished.
  const expanded = open || inProgress;

  return (
    <div
      className="border-l-[3px] rounded-r-md my-1.5 bg-muted/40"
      style={{ borderLeftColor: 'var(--thinking)' }}
    >
      <div
        className="cursor-pointer select-none px-[10px] py-[5px] text-xs opacity-80 flex gap-1.5 items-center"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="inline-block transition-transform duration-[0.12s]"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ▶
        </span>
        <span>Thinking{inProgress ? '…' : ''}</span>
      </div>
      {expanded && (
        <div
          className="px-3 pb-[10px] pt-[2px] whitespace-pre-wrap text-[13px] opacity-85"
          dangerouslySetInnerHTML={{ __html: escapeText(thinking ?? '') }}
        />
      )}
    </div>
  );
}
