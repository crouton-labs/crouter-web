/**
 * Per-node session store (seam.md "Worker S store shape"). Owns a session
 * socket, folds the live stream through the SHARED message reducer (the same
 * one the server hub uses, D12), and exposes Solid accessors the node-page and
 * its chrome/presence/palette/dialog children read. Chrome is RENDERED from the
 * server-pushed `chrome`/`snapshot` fields — never computed from raw events
 * (D12) — so the store only stores what the server sends.
 */

import { createSignal } from 'solid-js';
import { applyEvent, initMessages } from '../../shared/message-reducer.js';
import type {
  AgentMessage,
  BrokerStatus,
  ContextUsage,
  DialogResponseValue,
  ImageContent,
  Presence,
  RpcExtensionUIRequest,
  SessionState,
  SessionStatsSummary,
  ThinkingLevel,
  TokenBurn,
  WebRole,
  WsServerMsg,
} from '../../shared/protocol.js';
import { openSessionSocket, type SessionSocket } from '../api/session-socket.js';

/** Web-shaped chrome the SPA renders (mirrors `NodeDetail`'s chrome subset). */
export interface NodeChrome {
  branch: string | null;
  model: string | null;
  tokens: TokenBurn | null;
  context: ContextUsage | null;
  tool_calls: number | null;
  stats: SessionStatsSummary | null;
}

const EMPTY_CHROME: NodeChrome = {
  branch: null,
  model: null,
  tokens: null,
  context: null,
  tool_calls: null,
  stats: null,
};

export interface SessionStore {
  // --- accessors ---
  messages: () => AgentMessage[];
  state: () => SessionState | null;
  role: () => WebRole;
  chrome: () => NodeChrome;
  dialog: () => RpcExtensionUIRequest | null;
  presence: () => Presence;
  brokerStatus: () => BrokerStatus;
  source: () => 'broker' | 'static';
  /** Server-bridge socket connectivity (distinct from broker liveness): false
   * while the SPA↔server WS is down, e.g. a server restart (§7). */
  serverConnected: () => boolean;
  /** Last surfaced WS error, for transient UI; cleared on next snapshot. */
  error: () => { code: string; message: string } | null;
  // --- lifecycle ---
  connect: () => void;
  dispose: () => void;
  // --- send wrappers (controller-only frames gated server-side) ---
  prompt: (text: string, images?: ImageContent[]) => void;
  steer: (text: string, images?: ImageContent[]) => void;
  abort: () => void;
  setModel: (model: string) => void;
  cycleModel: () => void;
  setThinkingLevel: (level: ThinkingLevel) => void;
  compact: (instructions?: string) => void;
  requestControl: () => void;
  releaseControl: () => void;
  dialogResponse: (requestId: string, response: DialogResponseValue) => void;
}

/** Build a session store bound to `nodeId`. Call `connect()` to open the socket. */
export function createSessionStore(nodeId: string): SessionStore {
  const [messages, setMessages] = createSignal<AgentMessage[]>([]);
  const [state, setState] = createSignal<SessionState | null>(null);
  const [role, setRole] = createSignal<WebRole>('observer');
  const [chrome, setChrome] = createSignal<NodeChrome>(EMPTY_CHROME);
  const [dialog, setDialog] = createSignal<RpcExtensionUIRequest | null>(null);
  const [presence, setPresence] = createSignal<Presence>({ viewers: 0, controller: null });
  const [brokerStatus, setBrokerStatus] = createSignal<BrokerStatus>('connected');
  const [source, setSource] = createSignal<'broker' | 'static'>('broker');
  const [serverConnected, setServerConnected] = createSignal(true);
  const [error, setError] = createSignal<{ code: string; message: string } | null>(null);

  let socket: SessionSocket | null = null;

  const onServerMsg = (msg: WsServerMsg): void => {
    switch (msg.type) {
      case 'snapshot': {
        setMessages(initMessages(msg.history));
        setState(msg.state);
        setRole(msg.role);
        setPresence({ viewers: msg.viewers, controller: msg.controller });
        setSource(msg.source);
        setDialog(msg.pending_dialog ?? null);
        setError(null);
        // Seed chrome from the snapshot's pi stats + engine state (D12). The
        // server's coalesced `chrome` pushes refine these over the session.
        setChrome(seedChrome(msg));
        break;
      }
      case 'event': {
        setMessages((prev) => applyEvent(prev, msg.event));
        // Reflect the streaming/idle indicator (C.10) from turn boundaries.
        const ev = msg.event;
        if (ev.type === 'agent_start') setStreaming(true);
        else if (ev.type === 'agent_end') setStreaming(false);
        break;
      }
      case 'control_changed': {
        setRole(msg.you_are);
        setPresence((p) => ({ ...p, controller: msg.controller }));
        break;
      }
      case 'dialog': {
        setDialog(msg.request);
        break;
      }
      case 'chrome': {
        setChrome((c) => mergeChrome(c, msg));
        break;
      }
      case 'broker_status': {
        setBrokerStatus(msg.state);
        break;
      }
      case 'ack': {
        if (!msg.ok) setError({ code: 'ack', message: msg.detail ?? `command ${msg.for} failed` });
        break;
      }
      case 'error': {
        setError({ code: msg.code, message: msg.message });
        break;
      }
    }
  };

  const setStreaming = (isStreaming: boolean): void => {
    setState((s) => (s ? { ...s, isStreaming } : s));
  };

  const seedChrome = (msg: Extract<WsServerMsg, { type: 'snapshot' }>): NodeChrome => {
    const stats = msg.stats;
    const cu = stats.contextUsage;
    return {
      branch: null,
      model: msg.state.model,
      tokens: {
        input: stats.tokens.input,
        output: stats.tokens.output,
        cache: stats.tokens.cacheRead,
      },
      context: cu
        ? { tokens: cu.tokens ?? 0, window: cu.contextWindow, percent: cu.percent ?? 0 }
        : null,
      tool_calls: stats.toolCalls,
      stats: {
        turns: stats.assistantMessages,
        user_messages: stats.userMessages,
        assistant_messages: stats.assistantMessages,
        cost: stats.cost,
      },
    };
  };

  const mergeChrome = (
    c: NodeChrome,
    msg: Extract<WsServerMsg, { type: 'chrome' }>,
  ): NodeChrome => ({
    branch: msg.branch !== undefined ? msg.branch : c.branch,
    model: msg.model !== undefined ? msg.model : c.model,
    tokens: msg.tokens !== undefined ? msg.tokens : c.tokens,
    context: msg.context !== undefined ? msg.context : c.context,
    tool_calls: msg.tool_calls !== undefined ? msg.tool_calls : c.tool_calls,
    stats: msg.stats !== undefined ? msg.stats : c.stats,
  });

  const send = socketSender(() => socket);

  return {
    messages,
    state,
    role,
    chrome,
    dialog,
    presence,
    brokerStatus,
    source,
    serverConnected,
    error,
    connect() {
      if (socket) return;
      // A transport close means the SPA↔server bridge dropped (server restart),
      // NOT that the broker died — broker liveness arrives via explicit
      // `broker_status` frames on a live socket (m2). Surface server
      // connectivity separately and let the socket auto-reconnect + re-snapshot.
      socket = openSessionSocket(nodeId, {
        onMessage: onServerMsg,
        onOpen: () => setServerConnected(true),
        onClose: () => setServerConnected(false),
      });
    },
    dispose() {
      socket?.close();
      socket = null;
    },
    prompt(text, images) {
      send({ type: 'prompt', text, ...(images ? { images } : {}) });
    },
    steer(text, images) {
      send({ type: 'steer', text, ...(images ? { images } : {}) });
    },
    abort() {
      send({ type: 'abort' });
    },
    setModel(model) {
      send({ type: 'set_model', model });
    },
    cycleModel() {
      send({ type: 'cycle_model' });
    },
    setThinkingLevel(level) {
      send({ type: 'set_thinking_level', level });
    },
    compact(instructions) {
      send({ type: 'compact', ...(instructions ? { instructions } : {}) });
    },
    requestControl() {
      send({ type: 'request_control' });
    },
    releaseControl() {
      send({ type: 'release_control' });
    },
    dialogResponse(requestId, response) {
      send({ type: 'dialog_response', request_id: requestId, response });
      setDialog(null);
    },
  };
}

function socketSender(get: () => SessionSocket | null) {
  return (msg: import('../../shared/protocol.js').WsClientMsg): void => {
    get()?.send(msg);
  };
}
