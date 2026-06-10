/**
 * Bash / shell tool card (spec C.6).
 *
 * Terminal styling: the command echoed on a prompt line, then stdout/stderr in
 * a monospace block. Output is rendered as ESCAPED plain text (terminal output
 * is not markdown and must not be interpreted). Streams from
 * `tool_execution_update` — whatever `result()` content the store has each
 * render is shown.
 */

import { Show, type JSX } from 'solid-js';
import { escapeText } from '../../render/sanitize.js';
import { ToolCardShell, ResultImages, resultText, type ToolCardProps } from './parts.js';

function command(args: Record<string, unknown>): string {
  const c = args.command ?? args.cmd ?? args.script;
  return typeof c === 'string' ? c : '';
}

export function BashCard(props: ToolCardProps): JSX.Element {
  const cmd = (): string => command(props.call.arguments ?? {});
  const out = (): string => resultText(props.result());
  return (
    <ToolCardShell call={props.call} subtitle="" inProgress={props.inProgress} isError={props.isError}>
      <pre classList={{ 'cw-term': true, 'cw-term-err': props.isError() }}>
        <Show when={cmd()}>
          <span style={{ opacity: '.6' }}>$ </span>
          <span innerHTML={escapeText(cmd())} />
          {'\n'}
        </Show>
        <span innerHTML={escapeText(out())} />
        <Show when={props.inProgress()}>
          <span class="cw-stream-dot" />
        </Show>
      </pre>
      <ResultImages result={props.result} />
    </ToolCardShell>
  );
}
