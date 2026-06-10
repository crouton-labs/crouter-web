/**
 * PURE translation between broker frames and the web wire envelope (design
 * FrameTranslator row; spec §6.2). No I/O, no state — every function is a
 * total mapping from inputs to outputs, so the load-bearing seam is unit-
 * testable with plain fixtures and no live broker.
 *
 * Direction A (broker → web): `WelcomeFrame`→`snapshot`, `AgentSessionEvent`→
 * `event`, `ControlChangedFrame`→`control_changed`, `RpcExtensionUIRequest`
 * branched on `method` (dialog | chrome | set-input), `AckFrame`→`ack` (with a
 * `get_commands` JSON-parse helper).
 *
 * Direction B (web → broker): `WsClientMsg`→`ClientToBroker`. The two control-
 * slot frames (`request_control`/`release_control`) are NOT pass-through here —
 * the ControllerArbiter owns the lazy broker slot — so they translate to
 * `null` and the hub routes them to the arbiter instead.
 */

import type {
  AckFrame,
  ClientToBroker,
  RpcExtensionUIRequest,
  WelcomeFrame,
} from '../crouter-lib.js';
import type {
  AckMsg,
  AgentSessionEvent,
  Command,
  ControlChangedMsg,
  DialogMsg,
  DialogResponseValue,
  EventMsg,
  SessionState,
  SnapshotMsg,
  WebRole,
  WsClientMsg,
} from '../../shared/protocol.js';

// ===========================================================================
// Broker → web envelope
// ===========================================================================

/** Server-derived fields a `snapshot` carries that the `WelcomeFrame` does not
 *  (the per-tab role, the displayed controller label, the viewer count). */
export interface SnapshotDerived {
  role: WebRole;
  controller: string | null;
  viewers: number;
}

/** `WelcomeFrame` → `snapshot{source:'broker'}` (spec §6.2, C.1/C.2). */
export function welcomeToSnapshot(frame: WelcomeFrame, derived: SnapshotDerived): SnapshotMsg {
  const snap = frame.snapshot;
  const msg: SnapshotMsg = {
    type: 'snapshot',
    history: snap.messages,
    stats: snap.stats,
    state: mapState(snap.state),
    role: derived.role,
    controller: derived.controller,
    viewers: derived.viewers,
    source: 'broker',
  };
  if (frame.pending_dialog != null) msg.pending_dialog = frame.pending_dialog;
  return msg;
}

/** Map the broker snapshot's engine `state` (with `undefined` optionals) onto
 *  the wire `SessionState` (which uses `null`), so the SPA never imports the
 *  broker-protocol `BrokerSnapshot`. */
export function mapState(state: WelcomeFrame['snapshot']['state']): SessionState {
  return {
    sessionId: state.sessionId,
    sessionFile: state.sessionFile ?? null,
    model: state.model ?? null,
    isStreaming: state.isStreaming,
    thinkingLevel: state.thinkingLevel,
    steeringMode: state.steeringMode,
    followUpMode: state.followUpMode,
    sessionName: state.sessionName ?? null,
    autoCompactionEnabled: state.autoCompactionEnabled,
    pendingMessageCount: state.pendingMessageCount,
  };
}

/** A relayed pi engine event, passed through unchanged (spec §6.2, §5.C). */
export function eventToMsg(event: AgentSessionEvent): EventMsg {
  return { type: 'event', event };
}

/** `ControlChangedFrame` → `control_changed`. `youAre` is per-tab and supplied
 *  by the arbiter (the frame alone cannot know one tab's perspective). */
export function controlChangedToMsg(controllerId: string | null, youAre: WebRole): ControlChangedMsg {
  return { type: 'control_changed', controller: controllerId, you_are: youAre };
}

/** `AckFrame` → `ack`. */
export function ackToMsg(frame: AckFrame): AckMsg {
  const msg: AckMsg = { type: 'ack', for: frame.for, ok: frame.ok };
  if (frame.detail !== undefined) msg.detail = frame.detail;
  return msg;
}

/** Parse a `get_commands` reply: the broker ships the merged command inventory
 *  as JSON in `ack.detail` (spec §8; `broker.ts:821`), not a bespoke frame.
 *  Tolerant — returns `null` if `for !== 'get_commands'`, the ack failed, or
 *  the JSON is malformed/not an array, so a bad reply never crashes the hub. */
export function parseCommandsAck(frame: AckFrame): Command[] | null {
  if (frame.for !== 'get_commands' || !frame.ok || frame.detail === undefined) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(frame.detail);
  } catch {
    return null;
  }
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { commands?: unknown })?.commands)
    ? (raw as { commands: unknown[] }).commands
    : null;
  if (!list) return null;
  const out: Command[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const c = item as Record<string, unknown>;
    if (typeof c.name !== 'string') continue;
    const cmd: Command = {
      name: c.name,
      description: typeof c.description === 'string' ? c.description : '',
      source: c.source === 'extension' || c.source === 'prompt' || c.source === 'skill'
        ? c.source
        : 'prompt',
    };
    if (c.location === 'user' || c.location === 'project' || c.location === 'path') cmd.location = c.location;
    if (typeof c.path === 'string') cmd.path = c.path;
    if (typeof c.argument_hint === 'string') cmd.argument_hint = c.argument_hint;
    out.push(cmd);
  }
  return out;
}

/** The result of branching an `RpcExtensionUIRequest` on its `method` (spec
 *  §5.H/H.3): a blocking modal `dialog`; a non-modal `chrome` mutation
 *  (`setStatus`/`setWidget`/`setTitle`); or a `set_input` request that
 *  populates the editor. Only `dialog` has a frozen v1 wire carrier
 *  (`DialogMsg`); the hub routes the others. */
export type TranslatedUiRequest =
  | { kind: 'dialog'; msg: DialogMsg }
  | { kind: 'chrome'; method: 'setStatus' | 'setWidget' | 'setTitle'; request: RpcExtensionUIRequest }
  | { kind: 'set_input'; text: string };

/** Branch an extension UI request by `method` (design FrameTranslator row). */
export function translateUiRequest(req: RpcExtensionUIRequest): TranslatedUiRequest {
  switch (req.method) {
    case 'select':
    case 'confirm':
    case 'input':
    case 'editor':
    case 'notify':
      return { kind: 'dialog', msg: { type: 'dialog', request: req } };
    case 'setStatus':
    case 'setWidget':
    case 'setTitle':
      return { kind: 'chrome', method: req.method, request: req };
    case 'set_editor_text':
      return { kind: 'set_input', text: req.text };
  }
}

// ===========================================================================
// Web envelope → broker
// ===========================================================================

/** The controller-only client frames — rejected pre-broker from an observer
 *  tab (spec §6.2, AC-14). `request_control`/`release_control` are always
 *  accepted (arbitrated, not gated). */
const CONTROLLER_ONLY: ReadonlySet<WsClientMsg['type']> = new Set([
  'prompt',
  'steer',
  'abort',
  'set_model',
  'cycle_model',
  'set_thinking_level',
  'compact',
  'dialog_response',
]);

/** True iff `msg` is a controller-only frame (rejected from an observer). */
export function isControllerOnly(msg: WsClientMsg): boolean {
  return CONTROLLER_ONLY.has(msg.type);
}

/**
 * `WsClientMsg` → `ClientToBroker`. Returns `null` for `request_control` /
 * `release_control` (the arbiter owns the lazy broker slot, so the hub never
 * forwards these verbatim). Every other frame maps 1:1.
 */
export function clientMsgToFrame(msg: WsClientMsg): ClientToBroker | null {
  switch (msg.type) {
    case 'prompt':
      return { type: 'prompt', text: msg.text, ...(msg.images ? { images: msg.images } : {}) };
    case 'steer':
      return { type: 'steer', text: msg.text, ...(msg.images ? { images: msg.images } : {}) };
    case 'abort':
      return { type: 'abort' };
    case 'set_model':
      return { type: 'set_model', model: msg.model };
    case 'cycle_model':
      return { type: 'cycle_model' };
    case 'set_thinking_level':
      return { type: 'set_thinking_level', level: msg.level };
    case 'compact':
      return { type: 'compact', ...(msg.instructions !== undefined ? { instructions: msg.instructions } : {}) };
    case 'dialog_response':
      return dialogResponseToFrame(msg.request_id, msg.response);
    case 'request_control':
    case 'release_control':
      // Arbiter-managed (lazy broker slot) — never a verbatim pass-through.
      return null;
  }
}

/** `dialog_response` → pi's `extension_ui_response` RPC frame. */
function dialogResponseToFrame(id: string, response: DialogResponseValue): ClientToBroker {
  if ('value' in response) return { type: 'extension_ui_response', id, value: response.value };
  if ('confirmed' in response) return { type: 'extension_ui_response', id, confirmed: response.confirmed };
  return { type: 'extension_ui_response', id, cancelled: true };
}
