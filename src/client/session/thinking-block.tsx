/**
 * Thinking content block (spec C.5 / AC-8).
 *
 * Visually distinct, COLLAPSIBLE block, separate from assistant text. Collapsed
 * by default; a header toggles it. Streams incrementally — the body shows the
 * growing `thinking` text as escaped plain text (no markdown; escaping keeps
 * any embedded markup inert). Left-border accent in the `thinking` token color.
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';
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
  const bodyVisible = inProgress || open;

  return (
    <div
      className="border-l-[3px] rounded-r-md my-1.5 bg-[var(--thinking)]/5"
      style={{ borderLeftColor: 'var(--thinking)' }}
    >
      <div
        className="cursor-pointer select-none px-[10px] py-[5px] flex gap-1.5 items-center"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 transition-transform duration-[0.12s] text-muted-foreground/60',
            bodyVisible && 'rotate-90',
          )}
        />
        <span className="text-xs text-muted-foreground/60 italic">
          Thinking{inProgress ? '…' : ''}
        </span>
      </div>
      {bodyVisible && (
        <div
          className="px-3 pb-[10px] pt-[2px] whitespace-pre-wrap text-[13px] opacity-85"
          dangerouslySetInnerHTML={{ __html: escapeText(thinking) }}
        />
      )}
    </div>
  );
}
