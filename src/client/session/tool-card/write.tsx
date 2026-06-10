/**
 * Write tool card (spec C.6).
 *
 * Shows the NEW file content (the whole body is the "diff" for a create). The
 * body is syntax-highlighted via the sanitized markdown fence path so the
 * DOMPurify boundary applies. Result note (bytes written / error) shows below.
 */

import { Show, type JSX } from 'solid-js';
import { renderMarkdown } from '../../render/markdown.js';
import { escapeText } from '../../render/sanitize.js';
import { ToolCardShell, ResultImages, resultText, callSubtitle, type ToolCardProps } from './parts.js';

const EXT_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', json: 'json', sh: 'bash',
  py: 'python', html: 'html', xml: 'xml', css: 'css', md: 'markdown', yml: 'yaml', yaml: 'yaml',
};

function pick(args: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) if (typeof args[k] === 'string') return args[k] as string;
  return '';
}

export function WriteCard(props: ToolCardProps): JSX.Element {
  const args = (): Record<string, unknown> => props.call.arguments ?? {};
  const path = (): string => callSubtitle(props.call);
  const content = (): string => pick(args(), ['content', 'contents', 'text', 'body', 'new_string', 'file_text']);
  const note = (): string => resultText(props.result());
  const html = (): string => {
    const c = content();
    if (!c) return '';
    const m = /\.([a-z0-9]+)$/i.exec(path());
    const lang = (m && EXT_LANG[m[1].toLowerCase()]) || '';
    return renderMarkdown('```' + lang + '\n' + c + '\n```');
  };
  return (
    <ToolCardShell call={props.call} subtitle={path()} inProgress={props.inProgress} isError={props.isError}>
      <Show when={content()} fallback={<div class="cw-empty">no content</div>}>
        <div class="cw-md" style={{ padding: '4px 8px' }} innerHTML={html()} />
      </Show>
      <Show when={note()}>
        <div classList={{ 'cw-term': true, 'cw-term-err': props.isError() }} innerHTML={escapeText(note())} />
      </Show>
      <ResultImages result={props.result} />
    </ToolCardShell>
  );
}
