/**
 * Render ONE folded AgentMessage (spec C.4–C.7).
 *
 * Dispatches on role. Assistant messages iterate their content blocks
 * (text / thinking / tool-call); user messages render string or block content;
 * a tool result that has NO matching tool call (orphan) falls to a generic
 * card — paired results are rendered inside the assistant's tool card and are
 * filtered out upstream by MessageList.
 *
 * Streaming rule (design D9): the in-progress block is the TRAILING block of the
 * last assistant message while `streaming` is true. Only that block renders
 * via the escaped-plain-text path; every finished block runs full markdown.
 */

import type { ComponentType } from 'react';
import type {
  FoldedMessage,
  AssistantMessage,
  UserMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  ToolCall,
} from '../../shared/protocol.js';
import { TextBlock } from './text-block.js';
import { ThinkingBlock } from './thinking-block.js';
import { ImageBlock } from './image-block.js';
import { getToolCard } from './tool-card/registry.js';
import type { ToolCardProps } from './tool-card/parts.js';
import { usePeek } from './tool-card/parts.js';
import { extractPeekablePaths } from '../lib/file-link.js';
import { extractInboxSender } from '../../shared/inbox-detect.js';

export interface MessageViewProps {
  message: FoldedMessage;
  /** True iff this is the last assistant message in history. */
  isLastAssistant: boolean;
  streaming: boolean;
  /** Look up the tool result for a tool-call id. */
  resultFor: (toolCallId: string) => ToolResultMessage | undefined;
}

export function MessageView({ message, isLastAssistant, streaming, resultFor }: MessageViewProps) {
  const role = message.role;
  if (role === 'user') {
    if (message.origin === 'inbox') {
      return <InboundView message={message as UserMessage} />;
    }
    return (
      <div className="text-sm leading-[1.55] break-words">
        <UserView message={message as UserMessage} />
      </div>
    );
  }
  if (role === 'assistant') {
    return (
      <div className="text-sm leading-[1.55] break-words">
        <AssistantView
          message={message as AssistantMessage}
          isLastAssistant={isLastAssistant}
          streaming={streaming}
          resultFor={resultFor}
        />
      </div>
    );
  }
  if (role === 'toolResult') {
    // Reaches here only for an ORPHAN tool result (no matching call).
    return (
      <div className="text-sm leading-[1.55] break-words">
        <OrphanToolResult message={message as ToolResultMessage} />
      </div>
    );
  }
  // Unknown role: render nothing structural.
  return null;
}

function UserView({ message }: { message: UserMessage }) {
  const content = message.content;
  return (
    <div className="bg-secondary rounded-lg px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.06em] opacity-55 mb-1">user</div>
      {typeof content === 'string' ? (
        <div className="whitespace-pre-wrap">{content}</div>
      ) : (
        (content as (TextContent | ImageContent)[]).map((block, i) => {
          if (block.type === 'text') {
            return <div key={i} className="whitespace-pre-wrap">{(block as TextContent).text}</div>;
          }
          if (block.type === 'image') {
            return <ImageBlock key={i} image={block as ImageContent} />;
          }
          return null;
        })
      )}
    </div>
  );
}

function AssistantView({
  message,
  isLastAssistant,
  streaming,
  resultFor,
}: {
  message: AssistantMessage;
  isLastAssistant: boolean;
  streaming: boolean;
  resultFor: (id: string) => ToolResultMessage | undefined;
}) {
  const content = message.content;
  const isTrailing = (i: number): boolean =>
    isLastAssistant && streaming && i === content.length - 1;

  return (
    <>
      {content.map((block, i) => {
        if (block.type === 'text') {
          return (
            <TextBlock
              key={i}
              text={(block as TextContent).text}
              inProgress={isTrailing(i)}
            />
          );
        }
        if (block.type === 'thinking') {
          return (
            <ThinkingBlock
              key={i}
              thinking={(block as { thinking: string }).thinking}
              inProgress={isTrailing(i)}
            />
          );
        }
        if (block.type === 'toolCall') {
          return (
            <ToolCallBlock
              key={i}
              call={block as ToolCall}
              streaming={streaming}
              resultFor={resultFor}
            />
          );
        }
        return null;
      })}
    </>
  );
}

function ToolCallBlock({
  call,
  streaming,
  resultFor,
}: {
  call: ToolCall;
  streaming: boolean;
  resultFor: (id: string) => ToolResultMessage | undefined;
}) {
  const Card = getToolCard(call.name) as ComponentType<ToolCardProps>;
  const result = resultFor(call.id);
  const inProgress = streaming && (!result || result.content.length === 0);
  const isError = result?.isError ?? false;
  return <Card call={call} result={result} inProgress={inProgress} isError={isError} />;
}

function OrphanToolResult({ message }: { message: ToolResultMessage }) {
  const Card = getToolCard(message.toolName) as ComponentType<ToolCardProps>;
  // Synthesize the call from the result so the generic card has a name + id.
  const call: ToolCall = {
    type: 'toolCall',
    id: message.toolCallId,
    name: message.toolName,
    arguments: {},
  };
  return (
    <Card
      call={call}
      result={message}
      inProgress={false}
      isError={message.isError}
    />
  );
}

// ---------------------------------------------------------------------------
// InboundView — inbox-origin user messages (origin === 'inbox')
// Matches the mockup `.inbound` block: steel-blue left rail using --status-done,
// header "INBOX · FROM <sender>", body text, mono ref lines linkified for peek.
// ---------------------------------------------------------------------------

function InboundView({ message }: { message: UserMessage }) {
  const { onPeek, peekedPath } = usePeek();
  const raw = typeof message.content === 'string'
    ? message.content
    : (message.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === 'text')
        .map((b) => (typeof b.text === 'string' ? b.text : ''))
        .join('');

  const sender = extractInboxSender(raw);
  const peekablePaths = extractPeekablePaths(raw);

  // Render body text with peekable paths linkified inline.
  function renderBody(text: string) {
    if (peekablePaths.length === 0) {
      return <span className="whitespace-pre-wrap">{text}</span>;
    }
    // Split on peekable paths and interleave clickable spans.
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;
    for (const path of peekablePaths) {
      const idx = remaining.indexOf(path);
      if (idx === -1) continue;
      if (idx > 0) parts.push(<span key={key++} className="whitespace-pre-wrap">{remaining.slice(0, idx)}</span>);
      const isActive = peekedPath === path;
      parts.push(
        <button
          key={key++}
          type="button"
          onClick={(e) => { e.stopPropagation(); onPeek(path); }}
          className={[
            'font-mono text-[10.5px] text-[var(--color-muted-foreground)]',
            'hover:text-[var(--color-status-done)] cursor-pointer',
            isActive ? 'underline' : 'underline decoration-dotted',
          ].join(' ')}
        >
          {path}
        </button>,
      );
      remaining = remaining.slice(idx + path.length);
    }
    if (remaining) parts.push(<span key={key++} className="whitespace-pre-wrap">{remaining}</span>);
    return <>{parts}</>;
  }

  return (
    <div className="flex gap-3 px-4 py-3 rounded-[10px] border border-border border-l-2 border-l-[var(--color-status-done)] bg-[color-mix(in_oklch,var(--color-status-done)_4%,transparent)]">
      {/* icon */}
      <span className="text-[13px] text-[var(--color-status-done)] pt-[1px] flex-none select-none">◍</span>
      <div className="min-w-0 flex-1">
        {/* header */}
        <div className="font-mono text-[8.5px] tracking-[0.14em] uppercase text-[var(--color-status-done)] mb-1 flex gap-2 items-center">
          <span>inbox</span>
          {sender && (
            <>
              <span className="text-[var(--color-muted-foreground)]">·</span>
              <span>from {sender}</span>
            </>
          )}
        </div>
        {/* body */}
        <div className="text-[13px] text-muted-foreground leading-[1.55]">
          {renderBody(raw)}
        </div>
      </div>
    </div>
  );
}
