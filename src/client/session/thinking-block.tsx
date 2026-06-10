/**
 * Thinking content block (spec C.5 / AC-8).
 *
 * Visually distinct, COLLAPSIBLE block, separate from assistant text. Collapsed
 * by default; a header toggles it. Streams incrementally — the body shows the
 * growing `thinking` text as escaped plain text (no markdown; thinking is
 * reasoning prose, and escaping keeps any embedded markup inert).
 */

import { createSignal, Show, type JSX } from 'solid-js';
import { escapeText } from '../render/sanitize.js';
import { ensureStyles } from './styles.js';

export interface ThinkingBlockProps {
  thinking: string;
  /** True while still streaming — keeps the body visible as it grows. */
  inProgress: () => boolean;
}

export function ThinkingBlock(props: ThinkingBlockProps): JSX.Element {
  ensureStyles();
  const [open, setOpen] = createSignal(false);
  // Auto-reveal while actively streaming so progress is visible; user can still
  // collapse it, and it defaults collapsed once finished.
  const expanded = (): boolean => open() || props.inProgress();

  return (
    <div class="cw-think">
      <div class="cw-think-head" onClick={() => setOpen((v) => !v)}>
        <span classList={{ 'cw-caret': true, 'cw-caret-open': expanded() }}>▶</span>
        <span>Thinking{props.inProgress() ? '…' : ''}</span>
      </div>
      <Show when={expanded()}>
        <div class="cw-think-body" innerHTML={escapeText(props.thinking ?? '')} />
      </Show>
    </div>
  );
}
