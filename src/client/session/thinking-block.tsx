/**
 * Thinking content block (spec C.5 / AC-8).
 *
 * Visually distinct, COLLAPSIBLE block, separate from assistant text. Collapsed
 * by default; a header toggles it. Streams incrementally — the body shows the
 * growing `thinking` text as escaped plain text (no markdown; escaping keeps
 * any embedded markup inert). Quiet Instrument `.thinking` atom: purple accent
 * rail, italic muted toggle + body; CSS drives reveal via the `.open` class.
 */

import { useState } from 'react';
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
  // collapsed once finished. The `.open` class on `.thinking` drives both the
  // chevron rotation and `.think-body` display (Phase A atom CSS).
  const bodyVisible = inProgress || open;

  return (
    <div className={cn('thinking', bodyVisible && 'open')}>
      <div className="think-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="chev">▶</span>
        Thinking{inProgress ? '…' : ''}
      </div>
      <div
        className="think-body whitespace-pre-wrap"
        dangerouslySetInnerHTML={{ __html: escapeText(thinking) }}
      />
    </div>
  );
}
