/**
 * Shared tool-card scaffolding (spec C.6/AC-7, design D10).
 *
 * `ToolCardProps` is the contract every card renders against; `ToolCardShell`
 * gives the common chrome (tool name + subtitle + status pill + error border);
 * the helpers pull text/images out of `ToolResultMessage.content` and pretty-
 * print args WITHOUT ever dumping raw JSON as the card body.
 */

import { For, Show, type JSX } from 'solid-js';
import type {
  ToolCall,
  ToolResultMessage,
  TextContent,
  ImageContent,
} from '../../../shared/protocol.js';
import { ImageBlock } from '../image-block.js';
import { ensureStyles } from '../styles.js';

/** Contract for every tool-card renderer (paired call + result). */
export interface ToolCardProps {
  /** The assistant's tool-call block (name + structured arguments). */
  call: ToolCall;
  /** The matching tool result, or undefined until it starts/arrives. */
  result: () => ToolResultMessage | undefined;
  /** True while the tool is still executing (no/empty result + streaming). */
  inProgress: () => boolean;
  /** True when the tool reported an error. */
  isError: () => boolean;
}

/** Concatenate the text blocks of a tool result. */
export function resultText(result: ToolResultMessage | undefined): string {
  if (!result) return '';
  return result.content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** The image blocks of a tool result. */
export function resultImages(result: ToolResultMessage | undefined): ImageContent[] {
  if (!result) return [];
  return result.content.filter((b): b is ImageContent => b.type === 'image');
}

/** Pretty-print tool arguments as readable text (NOT a raw JSON dump body). */
export function prettyArgs(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return '';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/** A one-line subtitle summarising the call (path/command/pattern). */
export function callSubtitle(call: ToolCall): string {
  const a = call.arguments ?? {};
  const pick = (k: string): string | undefined =>
    typeof a[k] === 'string' ? (a[k] as string) : undefined;
  return (
    pick('command') ??
    pick('cmd') ??
    pick('path') ??
    pick('file_path') ??
    pick('filename') ??
    pick('pattern') ??
    pick('query') ??
    ''
  );
}

export interface ShellProps {
  call: ToolCall;
  subtitle?: string;
  inProgress: () => boolean;
  isError: () => boolean;
  children: JSX.Element;
}

/** Common card chrome: header (tool, subtitle, status pill) + body slot. */
export function ToolCardShell(props: ShellProps): JSX.Element {
  ensureStyles();
  const sub = (): string => props.subtitle ?? callSubtitle(props.call);
  return (
    <div classList={{ 'cw-card': true, 'cw-card-err': props.isError() }}>
      <div class="cw-card-head">
        <span class="cw-card-tool">{props.call.name}</span>
        <Show when={sub()}>
          <span class="cw-card-sub">{sub()}</span>
        </Show>
        <Show when={props.inProgress()}>
          <span class="cw-pill cw-pill-run">
            <span class="cw-spinner" /> running
          </span>
        </Show>
        <Show when={!props.inProgress() && props.isError()}>
          <span class="cw-pill cw-pill-err">error</span>
        </Show>
        <Show when={!props.inProgress() && !props.isError()}>
          <span class="cw-pill cw-pill-ok">done</span>
        </Show>
      </div>
      <div class="cw-card-body">{props.children}</div>
    </div>
  );
}

/** Render any image blocks attached to a tool result. */
export function ResultImages(props: { result: () => ToolResultMessage | undefined }): JSX.Element {
  return (
    <For each={resultImages(props.result())}>
      {(img) => <div style={{ padding: '4px 11px' }}><ImageBlock image={img} /></div>}
    </For>
  );
}
