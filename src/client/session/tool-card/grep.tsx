/**
 * Grep / search tool card (spec C.6).
 *
 * Renders the result as a match list (one escaped line per output line) under a
 * header showing the search pattern. Output is escaped plain text — match lines
 * are not markdown and must stay inert.
 */

import { For, Show, type JSX } from 'solid-js';
import { escapeText } from '../../render/sanitize.js';
import { ToolCardShell, ResultImages, resultText, type ToolCardProps } from './parts.js';

function pattern(args: Record<string, unknown>): string {
  const p = args.pattern ?? args.query ?? args.regex ?? args.search;
  return typeof p === 'string' ? p : '';
}

export function GrepCard(props: ToolCardProps): JSX.Element {
  const pat = (): string => pattern(props.call.arguments ?? {});
  const lines = (): string[] => {
    const t = resultText(props.result());
    if (!t) return [];
    return t.split('\n').filter((l) => l.length > 0);
  };
  return (
    <ToolCardShell call={props.call} subtitle={pat()} inProgress={props.inProgress} isError={props.isError}>
      <Show
        when={lines().length > 0}
        fallback={<Show when={!props.inProgress()}><div class="cw-empty">no matches</div></Show>}
      >
        <div class="cw-diff">
          <For each={lines()}>
            {(l) => <div class="cw-grep-file" innerHTML={escapeText(l)} />}
          </For>
        </div>
      </Show>
      <ResultImages result={props.result} />
    </ToolCardShell>
  );
}
