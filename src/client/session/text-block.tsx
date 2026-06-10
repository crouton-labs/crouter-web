/**
 * Assistant/text content block (spec C.4 / C.8, design D9).
 *
 * Two rendering modes, switched on `inProgress`:
 *   - WHILE STREAMING (the trailing text block of the active assistant message):
 *     render ESCAPED PLAIN TEXT, updated incrementally on every `text_delta`.
 *     No markdown pass — partial markup must never be interpreted, and a full
 *     re-parse per delta would be O(n\u00b2) on long messages (D9 rejected (b)).
 *   - WHEN ENDED: run the full markdown + highlight + sanitize pass once and set
 *     the sanitized HTML. `renderMarkdown` always returns DOMPurify-laundered
 *     HTML, so assigning it to innerHTML is safe (C.8).
 */

import { createMemo, Show, type JSX } from 'solid-js';
import { renderMarkdown } from '../render/markdown.js';
import { escapeText } from '../render/sanitize.js';
import { ensureStyles } from './styles.js';

export interface TextBlockProps {
  text: string;
  /** True while this is the still-growing trailing text block. */
  inProgress: () => boolean;
}

export function TextBlock(props: TextBlockProps): JSX.Element {
  ensureStyles();
  // Only recomputed when the (ended) text actually changes; never runs the
  // expensive markdown pass while streaming.
  const html = createMemo<string>((prev) => {
    if (props.inProgress()) return prev ?? '';
    return renderMarkdown(props.text ?? '');
  }, '');

  return (
    <Show
      when={props.inProgress()}
      fallback={<div class="cw-md" innerHTML={html()} />}
    >
      {/* escapeText output assigned as innerHTML — entities render as literal
          text; no markup can be interpreted mid-stream. */}
      <div class="cw-stream-text" innerHTML={escapeText(props.text ?? '')} />
    </Show>
  );
}
