/**
 * Slash command palette (spec §5.E). A `/`-triggered filter over the node's
 * command inventory (fetched by the page via rest.getCommands). The page drives
 * it: it passes the current input `query` and `visible` (input starts with `/`)
 * and an `onSelect` that inserts `/name ` into the input. Commands are filtered
 * by name/description/source against the text after the leading `/`; argument
 * hints are surfaced. Invocation flows through the normal prompt path
 * (controller-only) — the palette only edits the input.
 */

import { createMemo, For, Show, type JSX } from 'solid-js';
import type { Command } from '../../shared/protocol.js';

export function CommandPalette(props: {
  commands: () => Command[];
  /** The current input value (the page's input signal). */
  query: () => string;
  /** Show the palette (typically: input starts with `/`). */
  visible: () => boolean;
  /** Insert the selected command's invocation into the input. */
  onSelect: (command: Command) => void;
}): JSX.Element {
  const term = createMemo(() => {
    const q = props.query();
    return q.startsWith('/') ? q.slice(1).trimStart().toLowerCase() : '';
  });

  const filtered = createMemo(() => {
    const t = term();
    const cmds = props.commands();
    if (!t) return cmds;
    return cmds.filter(
      (c) =>
        c.name.toLowerCase().includes(t) ||
        c.description.toLowerCase().includes(t) ||
        c.source.toLowerCase().includes(t),
    );
  });

  return (
    <Show when={props.visible()}>
      <div class="command-palette">
        <Show
          when={filtered().length > 0}
          fallback={<div class="palette-empty">no matching commands</div>}
        >
          <ul class="palette-list">
            <For each={filtered()}>
              {(cmd) => (
                <li class="palette-item" onClick={() => props.onSelect(cmd)}>
                  <span class="palette-name">/{cmd.name}</span>
                  <Show when={cmd.argument_hint}>
                    <span class="palette-arg-hint">{cmd.argument_hint}</span>
                  </Show>
                  <span class="palette-desc">{cmd.description}</span>
                  <span class="palette-source">
                    {cmd.source}
                    <Show when={cmd.location}> · {cmd.location}</Show>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}
