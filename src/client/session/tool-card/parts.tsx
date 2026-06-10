/**
 * Shared tool-card scaffolding (spec C.6/AC-7, design D10).
 *
 * `ToolCardProps` is the contract every card renders against (plain values, not
 * accessors); `ToolCardShell` gives the common chrome (tool name + subtitle +
 * status pill + error border) built from shadcn Card primitives; the helpers
 * pull text/images out of `ToolResultMessage.content` and pretty-print args
 * WITHOUT ever dumping raw JSON as the card body.
 */

import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import type {
  ToolCall,
  ToolResultMessage,
  TextContent,
  ImageContent,
} from '../../../shared/protocol.js';
import { ImageBlock } from '../image-block.js';
import { useCapability } from '../../profile/provider.js';
import { friendlyToolTitle } from './friendly-titles.js';

/** Markdown-body styling (the `.cw-md` equivalent; mirrors text-block). */
export const MD_CLASSES =
  '[&_pre]:overflow-auto [&_pre]:p-[10px_12px] [&_pre]:rounded-md [&_pre]:bg-muted [&_code]:font-mono [&_code]:text-[12.5px] [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-[5px] [&_:not(pre)>code]:py-[1px] [&_:not(pre)>code]:rounded [&_p]:my-[0.4em] [&_a]:text-primary';

/** Terminal output block (`.cw-term`); pair with `TERM_ERR` via `cn` for errors. */
export const TERM_CLASSES =
  'm-0 px-[11px] py-[9px] bg-[#0c0f13] text-[#d6dde6] font-mono text-xs whitespace-pre-wrap overflow-auto max-h-[420px]';
export const TERM_ERR = 'text-[#ff9b8a]';

/** Italic muted placeholder (`.cw-empty`). */
export const EMPTY_CLASSES = 'px-[11px] py-2 opacity-50 text-xs italic';

/** Contract for every tool-card renderer (paired call + result). */
export interface ToolCardProps {
  /** The assistant's tool-call block (name + structured arguments). */
  call: ToolCall;
  /** The matching tool result, or undefined until it arrives. */
  result: ToolResultMessage | undefined;
  /** True while the tool is still executing (no/empty result + streaming). */
  inProgress: boolean;
  /** True when the tool reported an error. */
  isError: boolean;
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
  inProgress: boolean;
  isError: boolean;
  children: ReactNode;
}

/** Common card chrome: header (tool name, subtitle, status pill) + body slot. */
export function ToolCardShell({ call, subtitle, inProgress, isError, children }: ShellProps) {
  const sub = subtitle ?? callSubtitle(call);
  // Audience copy: the internals audience (Operator) reads the raw pi tool name
  // in mono; a consumer audience (Studio) reads a plain-language title in sans.
  // Capability-driven — never branched on profile name.
  const raw = useCapability('node.internals');
  const title = raw ? call.name : friendlyToolTitle(call);
  return (
    <div
      className={cn(
        'border rounded-lg my-1.5 overflow-hidden bg-card text-card-foreground',
        isError && 'border-destructive',
      )}
    >
      {/* Header — .cw-card-head equivalent */}
      <div className="flex items-center gap-2 px-[10px] py-[6px] bg-muted/50 text-[12.5px]">
        <span className={cn('font-semibold', raw && 'font-mono')}>{title}</span>
        {sub && (
          <span className={cn('opacity-60 text-[11.5px] overflow-hidden text-ellipsis whitespace-nowrap', raw && 'font-mono')}>
            {sub}
          </span>
        )}
        {/* Status pill — .cw-pill-* equivalent */}
        <div className="ml-auto shrink-0">
          {inProgress ? (
            <span className="inline-flex items-center gap-1 text-[10.5px] px-[7px] py-[1px] rounded-full bg-blue-950/70 text-blue-300 whitespace-nowrap">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              running
            </span>
          ) : isError ? (
            <span className="inline-flex items-center text-[10.5px] px-[7px] py-[1px] rounded-full bg-destructive/20 text-destructive-foreground border border-destructive/40 whitespace-nowrap">
              error
            </span>
          ) : (
            <span className="inline-flex items-center text-[10.5px] px-[7px] py-[1px] rounded-full whitespace-nowrap"
              style={{ background: 'oklch(0.72 0.16 145 / 0.2)', color: 'var(--success)' }}>
              done
            </span>
          )}
        </div>
      </div>
      {/* Body slot */}
      <div>{children}</div>
    </div>
  );
}

/** Render any image blocks attached to a tool result. */
export function ResultImages({ result }: { result: ToolResultMessage | undefined }) {
  const images = resultImages(result);
  if (images.length === 0) return null;
  return (
    <>
      {images.map((img, i) => (
        <div key={i} className="px-[11px] py-1">
          <ImageBlock image={img} />
        </div>
      ))}
    </>
  );
}
