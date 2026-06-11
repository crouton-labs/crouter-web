/**
 * Per-node session store. Owns a session socket, folds the live stream through
 * the SHARED message reducer (the same one the server hub uses, D12), and
 * exposes plain reactive values the node-page and its chrome/presence/palette/
 * dialog children read. Chrome is RENDERED from the server-pushed `chrome`/
 * `snapshot` fields — never computed from raw events (D12) — so the store only
 * stores what the server sends.
 *
 * Self-managing React hook — connects on mount (or nodeId change), disposes on
 * unmount.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { applyEvent, initMessages } from '../../shared/message-reducer.js';
import type {
  AgentMessage,
  BrokerStatus,
  ContextUsage,
  DialogResponseValue,
  GitStatus,
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
import { useServerStatus } from '../lib/server-status.js';

/** Web-shaped chrome the SPA renders (mirrors `NodeDetail`'s chrome subset). */
export interface NodeChrome {
  branch: string | null;
  model: string | null;
  tokens: TokenBurn | null;
  context: ContextUsage | null;
  tool_calls: number | null;
  stats: SessionStatsSummary | null;
  git_status?: GitStatus | null;
}

const EMPTY_CHROME: NodeChrome = {
  branch: null,
  model: null,
  tokens: null,
  context: null,
  tool_calls: null,
  stats: null,
  git_status: null,
};

export interface SessionStore {
  // --- plain values ---
  messages: AgentMessage[];
  state: SessionState | null;
  role: WebRole;
  chrome: NodeChrome;
  dialog: RpcExtensionUIRequest | null;
  presence: Presence;
  brokerStatus: BrokerStatus;
  source: 'broker' | 'static';
  /** Server-bridge socket connectivity (distinct from broker liveness): false
   * while the SPA↔server WS is down, e.g. a server restart (§7). */
  serverConnected: boolean;
  /** True only once the session socket has actually opened. Initialized false
   * (unlike the optimistic `serverConnected`) so controller-only frames — e.g.
   * request_control — can be gated on a genuinely-open socket and never race
   * WS-readiness on first click. */
  socketReady: boolean;
  /** Last surfaced WS error, for transient UI; cleared on next snapshot. */
  error: { code: string; message: string } | null;
  /** Tear down and re-open the session socket from scratch. The server
   *  disposes the old per-node hub when our last tab closes and a fresh hub
   *  re-runs its live-vs-static check on the new connection — the same effect
   *  as a page reload. Used to escape a cold-start static snapshot once the
   *  freshly-spawned node's broker is up (see node-page). */
  reconnect: () => void;
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

/** Open a session stream for `nodeId` and return plain reactive values + send methods. */
export function useSessionStore(nodeId: string): SessionStore {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [state, setState] = useState<SessionState | null>(null);
  const [role, setRole] = useState<WebRole>('observer');
  const [chrome, setChrome] = useState<NodeChrome>(EMPTY_CHROME);
  const [dialog, setDialog] = useState<RpcExtensionUIRequest | null>(null);
  const [presence, setPresence] = useState<Presence>({ viewers: 0, controller: null });
  const [brokerStatus, setBrokerStatus] = useState<BrokerStatus>('connected');
  const [source, setSource] = useState<'broker' | 'static'>('broker');
  const [serverConnected, setServerConnected] = useState(true);
  const [socketReady, setSocketReady] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  // Bumped by `reconnect()` to force the connect effect to tear down and
  // re-open the socket (a fresh server-side hub).
  const [generation, setGeneration] = useState(0);

  const socketRef = useRef<SessionSocket | null>(null);

  useEffect(() => {
    // Reset to blank state when nodeId changes.
    setMessages([]);
    setState(null);
    setRole('observer');
    setChrome(EMPTY_CHROME);
    setDialog(null);
    setPresence({ viewers: 0, controller: null });
    setBrokerStatus('connected');
    setSource('broker');
    setServerConnected(true);
    setSocketReady(false);
    setError(null);

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
          if (ev.type === 'agent_start') setState((s) => (s ? { ...s, isStreaming: true } : s));
          else if (ev.type === 'agent_end') setState((s) => (s ? { ...s, isStreaming: false } : s));
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
          if (!msg.ok)
            setError({ code: 'ack', message: msg.detail ?? `command ${msg.for} failed` });
          break;
        }
        case 'error': {
          setError({ code: msg.code, message: msg.message });
          break;
        }
      }
    };

    // A transport close means the SPA↔server bridge dropped (server restart),
    // NOT that the broker died — broker liveness arrives via explicit
    // `broker_status` frames on a live socket (m2). Surface server
    // connectivity separately and let the socket auto-reconnect + re-snapshot.
    socketRef.current = openSessionSocket(nodeId, {
      onMessage: onServerMsg,
      onOpen: () => {
        setServerConnected(true);
        setSocketReady(true);
        useServerStatus.getState().setReachable(true);
      },
      onClose: () => {
        setServerConnected(false);
        setSocketReady(false);
        useServerStatus.getState().setReachable(false);
      },
    });

    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [nodeId, generation]);

  const reconnect = useCallback(() => setGeneration((g) => g + 1), []);

  const prompt = useCallback((text: string, images?: ImageContent[]) => {
    socketRef.current?.send({ type: 'prompt', text, ...(images ? { images } : {}) });
  }, []);

  const steer = useCallback((text: string, images?: ImageContent[]) => {
    socketRef.current?.send({ type: 'steer', text, ...(images ? { images } : {}) });
  }, []);

  const abort = useCallback(() => {
    socketRef.current?.send({ type: 'abort' });
  }, []);

  const setModel = useCallback((model: string) => {
    socketRef.current?.send({ type: 'set_model', model });
  }, []);

  const cycleModel = useCallback(() => {
    socketRef.current?.send({ type: 'cycle_model' });
  }, []);

  const setThinkingLevel = useCallback((level: ThinkingLevel) => {
    socketRef.current?.send({ type: 'set_thinking_level', level });
  }, []);

  const compact = useCallback((instructions?: string) => {
    socketRef.current?.send({ type: 'compact', ...(instructions ? { instructions } : {}) });
  }, []);

  const requestControl = useCallback(() => {
    socketRef.current?.send({ type: 'request_control' });
  }, []);

  const releaseControl = useCallback(() => {
    socketRef.current?.send({ type: 'release_control' });
  }, []);

  const dialogResponse = useCallback((requestId: string, response: DialogResponseValue) => {
    socketRef.current?.send({ type: 'dialog_response', request_id: requestId, response });
    setDialog(null);
  }, []);

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
    socketReady,
    error,
    reconnect,
    prompt,
    steer,
    abort,
    setModel,
    cycleModel,
    setThinkingLevel,
    compact,
    requestControl,
    releaseControl,
    dialogResponse,
  };
}

// ---------------------------------------------------------------------------
// Pure chrome helpers (module-level — no React deps)
// ---------------------------------------------------------------------------

function seedChrome(msg: Extract<WsServerMsg, { type: 'snapshot' }>): NodeChrome {
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
    git_status: null,
  };
}

function mergeChrome(
  c: NodeChrome,
  msg: Extract<WsServerMsg, { type: 'chrome' }>,
): NodeChrome {
  return {
    branch: msg.branch !== undefined ? msg.branch : c.branch,
    model: msg.model !== undefined ? msg.model : c.model,
    tokens: msg.tokens !== undefined ? msg.tokens : c.tokens,
    context: msg.context !== undefined ? msg.context : c.context,
    tool_calls: msg.tool_calls !== undefined ? msg.tool_calls : c.tool_calls,
    stats: msg.stats !== undefined ? msg.stats : c.stats,
    git_status: msg.git_status !== undefined ? msg.git_status : c.git_status,
  };
}
