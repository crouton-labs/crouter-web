/**
 * Assistant/text content block (spec C.4 / C.8, design D9).
 *
 * Two rendering modes, switched on `inProgress`:
 *   - WHILE STREAMING (the trailing text block of the active assistant message):
 *     render ESCAPED PLAIN TEXT, updated incrementally on every `text_delta`.
 *     No markdown pass — partial markup must never be interpreted.
 *   - WHEN ENDED: run the full markdown + highlight + sanitize pass once and set
 *     the sanitized HTML via dangerouslySetInnerHTML. `renderMarkdown` always
 *     returns DOMPurify-laundered HTML, so this is safe (C.8).
 */

import { useMemo } from 'react';
import { renderMarkdown } from '../render/markdown.js';
import { escapeText } from '../render/sanitize.js';

export interface TextBlockProps {
  text: string;
  /** True while this is the still-growing trailing text block. */
  inProgress: boolean;
}

export function TextBlock({ text, inProgress }: TextBlockProps) {
  // Only recomputed when the ended text changes; never runs the markdown pass
  // while streaming.
  const html = useMemo<string>(() => {
    if (inProgress) return '';
    return renderMarkdown(text ?? '');
  }, [inProgress, text]);

  if (inProgress) {
    // escapeText output → dangerouslySetInnerHTML: entities render as literal
    // text; no markup can be interpreted mid-stream.
    return (
      <div
        className="whitespace-pre-wrap"
        dangerouslySetInnerHTML={{ __html: escapeText(text ?? '') }}
      />
    );
  }

  return (
    <div
      // .cw-md equivalent: prose spacing, mono code blocks on bg-muted,
      // links in primary, inline code highlighted.
      className={[
        '[&_pre]:overflow-auto [&_pre]:p-[10px_12px] [&_pre]:rounded-md [&_pre]:bg-muted',
        '[&_code]:font-mono [&_code]:text-[12.5px]',
        '[&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-[5px] [&_:not(pre)>code]:py-[1px] [&_:not(pre)>code]:rounded',
        '[&_p]:my-[0.4em]',
        '[&_a]:text-primary',
      ].join(' ')}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
