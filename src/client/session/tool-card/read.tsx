/**
 * Read / view-file tool card (spec C.6).
 *
 * Shows the file body syntax-highlighted by extension. We reuse the sanitized
 * markdown path (`renderMarkdown` of a fenced code block) so highlighting AND
 * the DOMPurify boundary both apply — the card never emits unsanitized HTML.
 */

import { Show, type JSX } from 'solid-js';
import { renderCodeBlock } from '../../render/markdown.js';
import { ToolCardShell, ResultImages, resultText, callSubtitle, type ToolCardProps } from './parts.js';

const EXT_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', sh: 'bash', bash: 'bash', zsh: 'bash',
  py: 'python', diff: 'diff', patch: 'diff',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'css', md: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml',
};

function langFor(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path || '');
  return (m && EXT_LANG[m[1].toLowerCase()]) || '';
}

export function ReadCard(props: ToolCardProps): JSX.Element {
  const path = (): string => callSubtitle(props.call);
  const body = (): string => resultText(props.result());
  const html = (): string => {
    const b = body();
    if (!b) return '';
    return renderCodeBlock(b, langFor(path()));
  };
  return (
    <ToolCardShell call={props.call} inProgress={props.inProgress} isError={props.isError}>
      <Show when={body()} fallback={<Show when={!props.inProgress()}><div class="cw-empty">no content</div></Show>}>
        <div class="cw-md" style={{ padding: '4px 8px' }} innerHTML={html()} />
      </Show>
      <ResultImages result={props.result} />
    </ToolCardShell>
  );
}
