/**
 * Edit tool card (spec C.6).
 *
 * DIFF view of the old → new strings from the call arguments. Lines are escaped
 * plain text (file content is not markdown). The result text (e.g. a success
 * confirmation or error) shows beneath the diff with error treatment.
 */

import { For, Show, type JSX } from 'solid-js';
import { escapeText } from '../../render/sanitize.js';
import { lineDiff } from './diff.js';
import { ToolCardShell, ResultImages, resultText, callSubtitle, type ToolCardProps } from './parts.js';

function pick(args: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) if (typeof args[k] === 'string') return args[k] as string;
  return '';
}

export function EditCard(props: ToolCardProps): JSX.Element {
  const args = (): Record<string, unknown> => props.call.arguments ?? {};
  const oldS = (): string => pick(args(), ['old_string', 'oldText', 'old', 'before', 'search']);
  const newS = (): string => pick(args(), ['new_string', 'newText', 'new', 'after', 'replace']);
  const diff = (): ReturnType<typeof lineDiff> => lineDiff(oldS(), newS());
  const note = (): string => resultText(props.result());
  return (
    <ToolCardShell call={props.call} subtitle={callSubtitle(props.call)} inProgress={props.inProgress} isError={props.isError}>
      <Show
        when={oldS() || newS()}
        fallback={<div class="cw-empty">no diff available</div>}
      >
        <div class="cw-diff">
          <For each={diff()}>
            {(ln) => (
              <div
                classList={{
                  'cw-diff-line': true,
                  'cw-diff-add': ln.kind === 'add',
                  'cw-diff-del': ln.kind === 'del',
                  'cw-diff-ctx': ln.kind === 'ctx',
                }}
                innerHTML={(ln.kind === 'add' ? '+ ' : ln.kind === 'del' ? '- ' : '  ') + escapeText(ln.text)}
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={note()}>
        <div classList={{ 'cw-term': true, 'cw-term-err': props.isError() }} innerHTML={escapeText(note())} />
      </Show>
      <ResultImages result={props.result} />
    </ToolCardShell>
  );
}
