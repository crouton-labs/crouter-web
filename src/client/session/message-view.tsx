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
  AgentMessage,
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

export interface MessageViewProps {
  message: AgentMessage;
  /** True iff this is the last assistant message in history. */
  isLastAssistant: boolean;
  streaming: boolean;
  /** Look up the tool result for a tool-call id. */
  resultFor: (toolCallId: string) => ToolResultMessage | undefined;
}

export function MessageView({ message, isLastAssistant, streaming, resultFor }: MessageViewProps) {
  const role = message.role;
  if (role === 'user') {
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
