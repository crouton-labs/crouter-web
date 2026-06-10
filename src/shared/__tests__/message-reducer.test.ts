/**
 * Covers BOTH reducer consumers (server hub snapshot fold + SPA render) with one
 * realistic stream: a thinking block, streamed assistant text, a streamed
 * tool call, and a tool result carrying a text + image block (design test
 * strategy). Events are hand-built from the real pi `AgentSessionEvent` shapes.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from '@earendil-works/pi-ai';

import { applyEvent, initMessages } from '../message-reducer.js';

// --- builders ---------------------------------------------------------------

function assistant(content: AssistantMessage['content']): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-sonnet',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 1,
  };
}

function update(ev: AssistantMessageEvent): AgentSessionEvent {
  // The reducer reads only `assistantMessageEvent`; `message` mirrors `partial`.
  const message =
    ev.type === 'done' ? ev.message : ev.type === 'error' ? ev.error : ev.partial;
  return { type: 'message_update', message, assistantMessageEvent: ev };
}

const THINKING: ThinkingContent = { type: 'thinking', thinking: 'Let me think.' };
const TEXT: TextContent = { type: 'text', text: 'Hello world' };
const TOOLCALL: ToolCall = {
  type: 'toolCall',
  id: 'tc1',
  name: 'read',
  arguments: { path: '/etc/hosts' },
};
const RESULT_TEXT: TextContent = { type: 'text', text: '127.0.0.1 localhost' };
const RESULT_IMAGE: ImageContent = { type: 'image', data: 'AAAA', mimeType: 'image/png' };

// thinking@0, text@1, toolCall@2 — a single streamed assistant turn.
const stream: AgentSessionEvent[] = [
  { type: 'agent_start' },
  { type: 'turn_start' },
  { type: 'message_start', message: assistant([]) },
  update({ type: 'start', partial: assistant([]) }),
  // thinking
  update({ type: 'thinking_start', contentIndex: 0, partial: assistant([{ type: 'thinking', thinking: '' }]) }),
  update({ type: 'thinking_delta', contentIndex: 0, delta: 'Let me ', partial: assistant([{ type: 'thinking', thinking: 'Let me ' }]) }),
  update({ type: 'thinking_delta', contentIndex: 0, delta: 'think.', partial: assistant([{ type: 'thinking', thinking: 'Let me think.' }]) }),
  update({ type: 'thinking_end', contentIndex: 0, content: 'Let me think.', partial: assistant([THINKING]) }),
  // text
  update({ type: 'text_start', contentIndex: 1, partial: assistant([THINKING, { type: 'text', text: '' }]) }),
  update({ type: 'text_delta', contentIndex: 1, delta: 'Hello ', partial: assistant([THINKING, { type: 'text', text: 'Hello ' }]) }),
  update({ type: 'text_delta', contentIndex: 1, delta: 'world', partial: assistant([THINKING, { type: 'text', text: 'Hello world' }]) }),
  update({ type: 'text_end', contentIndex: 1, content: 'Hello world', partial: assistant([THINKING, TEXT]) }),
  // tool call (args stream via partial)
  update({ type: 'toolcall_start', contentIndex: 2, partial: assistant([THINKING, TEXT, { type: 'toolCall', id: 'tc1', name: 'read', arguments: {} }]) }),
  update({ type: 'toolcall_delta', contentIndex: 2, delta: '{"path":"/etc', partial: assistant([THINKING, TEXT, { type: 'toolCall', id: 'tc1', name: 'read', arguments: { path: '/etc' } }]) }),
  update({ type: 'toolcall_end', contentIndex: 2, toolCall: TOOLCALL, partial: assistant([THINKING, TEXT, TOOLCALL]) }),
  { type: 'message_end', message: assistant([THINKING, TEXT, TOOLCALL]) },
  // tool execution → a toolResult message with streamed text + an image block
  { type: 'tool_execution_start', toolCallId: 'tc1', toolName: 'read', args: { path: '/etc/hosts' } },
  { type: 'tool_execution_update', toolCallId: 'tc1', toolName: 'read', args: { path: '/etc/hosts' }, partialResult: { content: [{ type: 'text', text: '127.0.0.1' }], details: {} } },
  { type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'read', result: { content: [RESULT_TEXT, RESULT_IMAGE], details: {} }, isError: false },
  { type: 'turn_end', message: assistant([THINKING, TEXT, TOOLCALL]), toolResults: [] },
];

function fold(events: AgentSessionEvent[], seed: AgentSessionEvent['type'][] = []): {
  store: ReturnType<typeof initMessages>;
} {
  void seed;
  let store = initMessages([]);
  for (const ev of events) store = applyEvent(store, ev);
  return { store };
}

// --- tests ------------------------------------------------------------------

test('assembles streamed text mid-stream from text_delta', () => {
  // Fold only up to the second text_delta (index 10 inclusive).
  const upto = stream.slice(0, 11);
  const { store } = fold(upto);
  assert.equal(store.length, 1);
  const msg = store[0] as AssistantMessage;
  assert.equal(msg.role, 'assistant');
  // thinking@0 fully assembled, text@1 assembled from two deltas (no text_end yet).
  assert.equal((msg.content[0] as ThinkingContent).thinking, 'Let me think.');
  assert.equal((msg.content[1] as TextContent).text, 'Hello world');
});

test('folds a full turn into [assistant, toolResult] with all block types', () => {
  const { store } = fold(stream);
  assert.equal(store.length, 2, 'turn_end must not add a history message');

  const a = store[0] as AssistantMessage;
  assert.equal(a.role, 'assistant');
  assert.equal(a.content.length, 3);
  assert.deepEqual(a.content[0], THINKING);
  assert.deepEqual(a.content[1], TEXT);
  const tc = a.content[2] as ToolCall;
  assert.equal(tc.type, 'toolCall');
  assert.equal(tc.name, 'read');
  assert.deepEqual(tc.arguments, { path: '/etc/hosts' });

  const r = store[1] as ToolResultMessage;
  assert.equal(r.role, 'toolResult');
  assert.equal(r.toolCallId, 'tc1');
  assert.equal(r.toolName, 'read');
  assert.equal(r.isError, false);
  assert.equal(r.content.length, 2);
  assert.deepEqual(r.content[0], RESULT_TEXT);
  assert.deepEqual(r.content[1], RESULT_IMAGE);
});

test('is pure — never mutates the input array or its messages', () => {
  const seed = initMessages([assistant([{ type: 'text', text: 'prior' }])]);
  const seedCopy = JSON.parse(JSON.stringify(seed));
  const next = applyEvent(seed, { type: 'message_start', message: assistant([]) });
  assert.notEqual(next, seed);
  assert.equal(seed.length, 1, 'input length unchanged');
  assert.deepEqual(seed, seedCopy, 'input messages untouched');
});

test('no-op events return the same array reference', () => {
  const store = initMessages([assistant([TEXT])]);
  const same = applyEvent(store, { type: 'turn_end', message: assistant([TEXT]), toolResults: [] });
  assert.equal(same, store);
});

// Type-only guard: ensure our hand-built events stay assignable to the real
// stream element type as pi evolves. (Never executed.)
export type _StreamShape = AssistantMessageEventStream;
