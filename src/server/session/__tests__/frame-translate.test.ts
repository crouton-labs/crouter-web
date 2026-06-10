/**
 * The load-bearing seam (design test strategy): broker frame fixtures →
 * asserted web envelopes, and web client frames → asserted broker frames.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type {
  AckFrame,
  ControlChangedFrame,
  RpcExtensionUIRequest,
  WelcomeFrame,
} from '../../crouter-lib.js';
import type { AgentSessionEvent, WsClientMsg } from '../../../shared/protocol.js';
import {
  ackToMsg,
  clientMsgToFrame,
  controlChangedToMsg,
  eventToMsg,
  isControllerOnly,
  parseCommandsAck,
  translateUiRequest,
  welcomeToSnapshot,
} from '../frame-translate.js';

function makeWelcome(overrides: Partial<WelcomeFrame> = {}): WelcomeFrame {
  return {
    type: 'welcome',
    role: 'observer',
    controller_id: null,
    snapshot: {
      messages: [{ role: 'user', content: 'hi' } as never],
      stats: {
        sessionFile: undefined,
        sessionId: 's1',
        userMessages: 1,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 1,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        cost: 0,
      },
      state: {
        sessionId: 's1',
        sessionFile: undefined,
        model: undefined,
        isStreaming: false,
        thinkingLevel: 'medium',
        steeringMode: 'all',
        followUpMode: 'all',
        sessionName: undefined,
        autoCompactionEnabled: true,
        pendingMessageCount: 0,
      },
    },
    ...overrides,
  };
}

test('welcomeToSnapshot maps a broker welcome to source:broker, undefined→null', () => {
  const snap = welcomeToSnapshot(makeWelcome(), { role: 'observer', controller: null, viewers: 2 });
  assert.equal(snap.type, 'snapshot');
  assert.equal(snap.source, 'broker');
  assert.equal(snap.role, 'observer');
  assert.equal(snap.viewers, 2);
  assert.equal(snap.state.sessionFile, null);
  assert.equal(snap.state.model, null);
  assert.equal(snap.state.sessionName, null);
  assert.equal(snap.state.thinkingLevel, 'medium');
  assert.equal(snap.pending_dialog, undefined);
  assert.equal(snap.history.length, 1);
});

test('welcomeToSnapshot carries a pending_dialog when present', () => {
  const dialog: RpcExtensionUIRequest = {
    type: 'extension_ui_request',
    id: 'd1',
    method: 'confirm',
    title: 'Proceed?',
    message: 'really?',
  };
  const snap = welcomeToSnapshot(makeWelcome({ pending_dialog: dialog }), {
    role: 'controller',
    controller: 'srv-1',
    viewers: 1,
  });
  assert.deepEqual(snap.pending_dialog, dialog);
  assert.equal(snap.controller, 'srv-1');
});

test('eventToMsg wraps an engine event unchanged', () => {
  const event = { type: 'turn_start' } as AgentSessionEvent;
  assert.deepEqual(eventToMsg(event), { type: 'event', event });
});

test('controlChangedToMsg carries per-tab you_are', () => {
  const frame: ControlChangedFrame = { type: 'control_changed', controller_id: 'srv-1' };
  assert.deepEqual(controlChangedToMsg(frame.controller_id, 'controller'), {
    type: 'control_changed',
    controller: 'srv-1',
    you_are: 'controller',
  });
});

test('ackToMsg maps an ack and omits absent detail', () => {
  assert.deepEqual(ackToMsg({ type: 'ack', for: 'abort', ok: true }), {
    type: 'ack',
    for: 'abort',
    ok: true,
  });
  assert.deepEqual(ackToMsg({ type: 'ack', for: 'compact', ok: false, detail: 'busy' }), {
    type: 'ack',
    for: 'compact',
    ok: false,
    detail: 'busy',
  });
});

test('parseCommandsAck parses a get_commands array, ignores other acks', () => {
  const detail = JSON.stringify([
    { name: 'help', description: 'show help', source: 'extension', location: 'user' },
    { name: 'plan', description: 'a template', source: 'prompt' },
    { bogus: true },
  ]);
  const frame: AckFrame = { type: 'ack', for: 'get_commands', ok: true, detail };
  const cmds = parseCommandsAck(frame);
  assert.ok(cmds);
  assert.equal(cmds!.length, 2);
  assert.deepEqual(cmds![0], {
    name: 'help',
    description: 'show help',
    source: 'extension',
    location: 'user',
  });
  assert.equal(parseCommandsAck({ type: 'ack', for: 'abort', ok: true, detail }), null);
  assert.equal(parseCommandsAck({ type: 'ack', for: 'get_commands', ok: false, detail }), null);
  assert.equal(parseCommandsAck({ type: 'ack', for: 'get_commands', ok: true, detail: '{bad' }), null);
});

test('translateUiRequest branches on method', () => {
  const sel: RpcExtensionUIRequest = {
    type: 'extension_ui_request',
    id: '1',
    method: 'select',
    title: 't',
    options: ['a', 'b'],
  };
  assert.equal(translateUiRequest(sel).kind, 'dialog');

  const status: RpcExtensionUIRequest = {
    type: 'extension_ui_request',
    id: '2',
    method: 'setStatus',
    statusKey: 'k',
    statusText: 'v',
  };
  const t = translateUiRequest(status);
  assert.equal(t.kind, 'chrome');

  const setText: RpcExtensionUIRequest = {
    type: 'extension_ui_request',
    id: '3',
    method: 'set_editor_text',
    text: 'hello',
  };
  const ti = translateUiRequest(setText);
  assert.equal(ti.kind, 'set_input');
  assert.equal(ti.kind === 'set_input' && ti.text, 'hello');
});

test('clientMsgToFrame maps driving frames 1:1', () => {
  assert.deepEqual(clientMsgToFrame({ type: 'prompt', text: 'hi' }), { type: 'prompt', text: 'hi' });
  assert.deepEqual(clientMsgToFrame({ type: 'abort' }), { type: 'abort' });
  assert.deepEqual(clientMsgToFrame({ type: 'set_model', model: 'gpt' }), {
    type: 'set_model',
    model: 'gpt',
  });
  assert.deepEqual(clientMsgToFrame({ type: 'cycle_model' }), { type: 'cycle_model' });
  assert.deepEqual(clientMsgToFrame({ type: 'set_thinking_level', level: 'high' }), {
    type: 'set_thinking_level',
    level: 'high',
  });
  assert.deepEqual(clientMsgToFrame({ type: 'compact', instructions: 'tighten' }), {
    type: 'compact',
    instructions: 'tighten',
  });
});

test('clientMsgToFrame maps dialog_response to an extension_ui_response', () => {
  assert.deepEqual(
    clientMsgToFrame({ type: 'dialog_response', request_id: 'd1', response: { value: 'x' } }),
    { type: 'extension_ui_response', id: 'd1', value: 'x' },
  );
  assert.deepEqual(
    clientMsgToFrame({ type: 'dialog_response', request_id: 'd2', response: { confirmed: true } }),
    { type: 'extension_ui_response', id: 'd2', confirmed: true },
  );
  assert.deepEqual(
    clientMsgToFrame({ type: 'dialog_response', request_id: 'd3', response: { cancelled: true } }),
    { type: 'extension_ui_response', id: 'd3', cancelled: true },
  );
});

test('clientMsgToFrame returns null for arbiter-managed control frames', () => {
  assert.equal(clientMsgToFrame({ type: 'request_control' }), null);
  assert.equal(clientMsgToFrame({ type: 'release_control' }), null);
});

test('isControllerOnly classifies controller-only vs always-allowed', () => {
  const controllerOnly: WsClientMsg['type'][] = [
    'prompt',
    'steer',
    'abort',
    'set_model',
    'cycle_model',
    'set_thinking_level',
    'compact',
    'dialog_response',
  ];
  for (const type of controllerOnly) assert.ok(isControllerOnly({ type } as WsClientMsg), type);
  assert.equal(isControllerOnly({ type: 'request_control' }), false);
  assert.equal(isControllerOnly({ type: 'release_control' }), false);
});
