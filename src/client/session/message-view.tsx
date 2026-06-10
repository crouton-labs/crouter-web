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
 * last assistant message while `streaming()` is true. Only that block renders
 * via the escaped-plain-text path; every finished block runs full markdown.
 */

import { Index, Match, Show, Switch, type JSX } from 'solid-js';
import type {
  AgentMessage,
  AssistantMessage,
  UserMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
} from '../../shared/protocol.js';
import { TextBlock } from './text-block.js';
import { ThinkingBlock } from './thinking-block.js';
import { ImageBlock } from './image-block.js';
import { getToolCard } from './tool-card/registry.js';
import { ensureStyles } from './styles.js';

export interface MessageViewProps {
  message: AgentMessage;
  /** True iff this is the last assistant message in history. */
  isLastAssistant: boolean;
  streaming: () => boolean;
  /** Look up the tool result for a tool-call id (reactive). */
  resultFor: (toolCallId: string) => ToolResultMessage | undefined;
}

export function MessageView(props: MessageViewProps): JSX.Element {
  ensureStyles();
  const role = (): string => props.message.role;
  return (
    <div class="cw-msg">
      <Switch fallback={<GenericRoleView message={props.message} />}>
        <Match when={role() === 'user'}>
          <UserView message={props.message as UserMessage} />
        </Match>
        <Match when={role() === 'assistant'}>
          <AssistantView
            message={props.message as AssistantMessage}
            isLastAssistant={props.isLastAssistant}
            streaming={props.streaming}
            resultFor={props.resultFor}
          />
        </Match>
        <Match when={role() === 'toolResult'}>
          {/* Reaches here only for an ORPHAN tool result (no matching call). */}
          <OrphanToolResult message={props.message as ToolResultMessage} />
        </Match>
      </Switch>
    </div>
  );
}

function UserView(props: { message: UserMessage }): JSX.Element {
  const content = (): UserMessage['content'] => props.message.content;
  return (
    <div class="cw-msg-user">
      <div class="cw-role">user</div>
      <Show
        when={typeof content() !== 'string'}
        fallback={<div class="cw-stream-text">{content() as string}</div>}
      >
        <Index each={content() as (TextContent | ImageContent)[]}>
          {(block) => (
            <Switch>
              <Match when={block().type === 'text'}>
                <div class="cw-stream-text">{(block() as TextContent).text}</div>
              </Match>
              <Match when={block().type === 'image'}>
                <ImageBlock image={block() as ImageContent} />
              </Match>
            </Switch>
          )}
        </Index>
      </Show>
    </div>
  );
}

function AssistantView(props: {
  message: AssistantMessage;
  isLastAssistant: boolean;
  streaming: () => boolean;
  resultFor: (id: string) => ToolResultMessage | undefined;
}): JSX.Element {
  const content = (): AssistantMessage['content'] => props.message.content;
  const isTrailing = (i: number): boolean =>
    props.isLastAssistant && props.streaming() && i === content().length - 1;
  return (
    <Index each={content()}>
      {(block, i) => (
        <Switch>
          <Match when={block().type === 'text'}>
            <TextBlock
              text={(block() as TextContent).text}
              inProgress={() => isTrailing(i)}
            />
          </Match>
          <Match when={block().type === 'thinking'}>
            <ThinkingBlock
              thinking={(block() as { thinking: string }).thinking}
              inProgress={() => isTrailing(i)}
            />
          </Match>
          <Match when={block().type === 'toolCall'}>
            <ToolCallBlock
              call={block() as import('../../shared/protocol.js').ToolCall}
              streaming={props.streaming}
              resultFor={props.resultFor}
            />
          </Match>
        </Switch>
      )}
    </Index>
  );
}

function ToolCallBlock(props: {
  call: import('../../shared/protocol.js').ToolCall;
  streaming: () => boolean;
  resultFor: (id: string) => ToolResultMessage | undefined;
}): JSX.Element {
  const Card = getToolCard(props.call.name);
  const result = (): ToolResultMessage | undefined => props.resultFor(props.call.id);
  const inProgress = (): boolean => {
    const r = result();
    return props.streaming() && (!r || r.content.length === 0);
  };
  const isError = (): boolean => result()?.isError ?? false;
  return <Card call={props.call} result={result} inProgress={inProgress} isError={isError} />;
}

function OrphanToolResult(props: { message: ToolResultMessage }): JSX.Element {
  const Card = getToolCard(props.message.toolName);
  // Synthesize the call from the result so the generic card has a name + id.
  const call: import('../../shared/protocol.js').ToolCall = {
    type: 'toolCall',
    id: props.message.toolCallId,
    name: props.message.toolName,
    arguments: {},
  };
  return (
    <Card
      call={call}
      result={() => props.message}
      inProgress={() => false}
      isError={() => props.message.isError}
    />
  );
}

function GenericRoleView(props: { message: AgentMessage }): JSX.Element {
  // Custom/unknown roles: show nothing structural rather than risk dumping.
  return <Show when={false}>{String((props.message as { role: string }).role)}</Show>;
}
