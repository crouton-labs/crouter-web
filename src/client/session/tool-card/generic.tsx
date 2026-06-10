/**
 * Generic tool card (design D10 fallback).
 *
 * For any tool without a bespoke renderer: tool name + pretty-printed args +
 * result text/images + error treatment. Args are formatted (indented), never a
 * raw single-line JSON blob, satisfying C.6's "structured card, never raw JSON".
 */

import { Show, type JSX } from 'solid-js';
import { renderMarkdown } from '../../render/markdown.js';
import { ToolCardShell, ResultImages, prettyArgs, resultText, type ToolCardProps } from './parts.js';

export type { ToolCardProps };

export function GenericCard(props: ToolCardProps): JSX.Element {
  const args = (): string => prettyArgs(props.call.arguments);
  const text = (): string => resultText(props.result());
  return (
    <ToolCardShell call={props.call} inProgress={props.inProgress} isError={props.isError}>
      <Show when={args()}>
        <pre class="cw-args">{args()}</pre>
      </Show>
      <Show when={text()}>
        <div
          classList={{ 'cw-md': true, 'cw-term-err': props.isError() }}
          style={{ padding: '8px 11px' }}
          innerHTML={renderMarkdown(text())}
        />
      </Show>
      <ResultImages result={props.result} />
      <Show when={!args() && !text() && !props.inProgress()}>
        <div class="cw-empty">no output</div>
      </Show>
    </ToolCardShell>
  );
}
