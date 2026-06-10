/**
 * One `NodeSessionHub` per entered node (design D3/D5/D14, spec §6.2/§7).
 *
 * It owns:
 *   - a SINGLE upstream `ViewSocketClient` (observer role by default, D3),
 *     fanned out to N browser tabs;
 *   - a snapshot cache kept current by folding each relayed `AgentSessionEvent`
 *     through the shared message-reducer, so a tab entering mid-stream gets an
 *     up-to-date `snapshot` (not the stale initial `welcome`);
 *   - reconnect with bounded backoff while ≥1 tab is open (D5 — the client has
 *     no reconnect of its own, so each attempt constructs a FRESH client);
 *   - the DORMANT path (D14): if `view.sock` is absent the hub does NOT connect
 *     upstream — it normalizes the static session JSONL and serves a
 *     `snapshot{source:'static'}` + Revive;
 *   - the `ControllerArbiter` (the single web-controller slot, lazy broker hold);
 *   - the `get_commands` inventory fetched on the observer upstream.
 *
 * Everything external is dependency-injected (the socket factory, node/path
 * resolvers, the normalizer, the client-id generator, backoff config) so the
 * unit under test never needs a live broker, and `serve.ts` wires reality in.
 */

import { randomUUID } from 'node:crypto';

import type {
  AckFrame,
  BrokerToClient,
  ControlChangedFrame,
  ErrorFrame,
  RpcExtensionUIRequest,
  SessionStats,
  ViewSocketClient,
  WelcomeFrame,
} from '../crouter-lib.js';
import { BrokerUnavailableError } from '../crouter-lib.js';
import type {
  AgentMessage,
  AgentSessionEvent,
  BrokerStatus,
  Command,
  SessionState,
  SnapshotMsg,
  WebRole,
  WsClientMsg,
  WsServerMsg,
} from '../../shared/protocol.js';
import { applyEvent, initMessages } from '../../shared/message-reducer.js';
import { ControllerArbiter } from './controller-arbiter.js';
import {
  ackToMsg,
  clientMsgToFrame,
  controlChangedToMsg,
  eventToMsg,
  isControllerOnly,
  parseCommandsAck,
  welcomeToSnapshot,
  translateUiRequest,
} from './frame-translate.js';

/** Identity + liveness facts the hub needs about a node (wraps `getNode`). */
export interface ResolvedNode {
  status: 'active' | 'idle' | 'done' | 'dead' | 'canceled';
  hostKind: 'tmux' | 'broker' | null;
}

/** The static-session shape the injected normalizer returns (mirror of the
 *  static-session `NormalizedDormantSession`, kept structural to avoid a
 *  cross-subsystem import). */
export interface NormalizedDormantSession {
  history: AgentMessage[];
  model: string | null;
  thinkingLevel: string | null;
}

/** Bounded-backoff reconnect parameters (D5). */
export interface BackoffConfig {
  baseMs: number;
  maxMs: number;
  maxAttempts: number;
}

/** Everything the hub needs from the outside world, injected for testability. */
export interface HubDeps {
  /** Construct the upstream broker client — a fresh one per (re)connect (D5). */
  createSocket: (nodeId: string) => ViewSocketClient;
  /** Identity + liveness (wraps `getNode`). `null` ⇒ unknown node. */
  resolveNode: (nodeId: string) => ResolvedNode | null;
  /** Does the node's `view.sock` exist? Drives live-vs-dormant (D14, §7). */
  viewSockExists: (nodeId: string) => boolean;
  /** Resolve the node's pi session `.jsonl` (from `session.ptr`). */
  resolveSessionFile: (nodeId: string) => string | null;
  /** Parse a dormant session into the live `AgentMessage[]` shape (D2/D14). */
  normalizeDormantSession: (sessionFilePath: string) => Promise<NormalizedDormantSession>;
  /** Generate the upstream client id (one per hub). Injected for deterministic
   *  tests; defaults to `randomUUID`. */
  newClientId?: () => string;
  backoff?: Partial<BackoffConfig>;
}

const DEFAULT_BACKOFF: BackoffConfig = { baseMs: 250, maxMs: 5_000, maxAttempts: 8 };

/** A connected browser tab's view onto the hub. */
interface Tab {
  id: string;
  send: (msg: WsServerMsg) => void;
}

/** The hub's source of truth for the cached snapshot. */
type Source = 'broker' | 'static';

export class NodeSessionHub {
  private readonly clientId: string;
  private readonly backoff: BackoffConfig;
  private readonly arbiter: ControllerArbiter;
  private readonly tabs = new Map<string, Tab>();

  private upstream: ViewSocketClient | null = null;
  /** True once we have ever seen a `welcome` (so a later connect is a revive). */
  private everConnected = false;
  /** Folded message history (the reducer store). */
  private messages: AgentMessage[] = [];
  private stats: SessionStats | null = null;
  private state: SessionState | null = null;
  private pendingDialog: RpcExtensionUIRequest | null = null;
  private source: Source = 'broker';
  private snapshotReady = false;

  private commands: Command[] | null = null;
  private commandWaiters: Array<(c: Command[] | null) => void> = [];

  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(
    readonly nodeId: string,
    private readonly deps: HubDeps,
  ) {
    this.clientId = (deps.newClientId ?? randomUUID)();
    this.backoff = { ...DEFAULT_BACKOFF, ...(deps.backoff ?? {}) };
    this.arbiter = new ControllerArbiter({
      clientId: this.clientId,
      sendUpstream: (frame) => this.upstream?.send(frame),
      notifyTab: (tabId, msg) => this.tabs.get(tabId)?.send(msg),
    });
  }

  // -------------------------------------------------------------------------
  // Tab lifecycle (registry-driven)
  // -------------------------------------------------------------------------

  /** Register a tab and kick off the session if this is the first. Returns the
   *  tab id (the caller's `removeTab`/`handleClientMsg` key). */
  addTab(send: (msg: WsServerMsg) => void): string {
    const id = randomUUID();
    this.tabs.set(id, { id, send });

    if (this.snapshotReady) {
      // Catch a late-joining tab up instantly from the cached snapshot.
      send(this.buildSnapshot(this.arbiter.roleOf(id)));
    } else if (this.upstream === null && this.reconnectTimer === null) {
      // First tab — start the session (live connect or static load).
      void this.start();
    }
    return id;
  }

  /** A tab disconnected. Frees its control slot; tears the hub down on the last. */
  removeTab(tabId: string): void {
    if (!this.tabs.has(tabId)) return;
    this.arbiter.handleTabClose(tabId);
    this.tabs.delete(tabId);
  }

  tabCount(): number {
    return this.tabs.size;
  }

  /** Detach from the broker (send `bye`, never `shutdown`) and clear timers.
   *  Called by the registry when the last tab closes (spec A.6). */
  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.upstream) {
      this.upstream.send({ type: 'bye' });
      this.upstream.close();
      this.upstream = null;
    }
    for (const w of this.commandWaiters.splice(0)) w(null);
  }

  // -------------------------------------------------------------------------
  // Session start — live connect vs dormant static (D14)
  // -------------------------------------------------------------------------

  private async start(): Promise<void> {
    const node = this.deps.resolveNode(this.nodeId);
    const live =
      node !== null &&
      node.hostKind === 'broker' &&
      node.status === 'active' &&
      this.deps.viewSockExists(this.nodeId);

    if (live) this.connectUpstream();
    else await this.loadStatic();
  }

  private connectUpstream(): void {
    if (this.disposed) return;
    const sock = this.deps.createSocket(this.nodeId);
    this.upstream = sock;
    sock.on('connect', () => {
      // Handshake: identify as an observer (D4 — controller acquired lazily).
      sock.send({ type: 'hello', role: 'observer', client_id: this.clientId });
    });
    sock.on('frame', (frame) => this.handleFrame(frame));
    sock.on('error', (err) => this.handleConnectError(err));
    sock.on('close', () => this.handleClose());
    sock.connect();
  }

  private handleConnectError(err: Error): void {
    if (this.disposed) return;
    // Socket missing for a node we thought was live → treat as dormant (§7).
    if (err instanceof BrokerUnavailableError && !this.everConnected) {
      this.upstream = null;
      void this.loadStatic();
    }
    // Other errors converge on the `close` event, which drives reconnect.
  }

  private async loadStatic(): Promise<void> {
    if (this.disposed) return;
    this.source = 'static';
    const file = this.deps.resolveSessionFile(this.nodeId);
    if (file === null) {
      this.broadcast({
        type: 'error',
        code: 'broker_unavailable',
        message: `No session file for dormant node ${this.nodeId}.`,
      });
      return;
    }
    try {
      const norm = await this.deps.normalizeDormantSession(file);
      this.messages = initMessages(norm.history);
      this.state = staticState(this.nodeId, norm);
      this.stats = staticStats(this.nodeId, norm.history);
      this.pendingDialog = null;
      this.snapshotReady = true;
      // A dormant node has no controller; reset arbiter truth.
      this.arbiter.onBrokerControlChanged(null);
      for (const tab of this.tabs.values()) tab.send(this.buildSnapshot(this.arbiter.roleOf(tab.id)));
    } catch (cause) {
      this.broadcast({
        type: 'error',
        code: 'broker_unavailable',
        message: `Failed to read dormant session for ${this.nodeId}: ${(cause as Error).message}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Upstream frame handling
  // -------------------------------------------------------------------------

  private handleFrame(frame: BrokerToClient): void {
    switch (frame.type) {
      case 'welcome':
        return this.onWelcome(frame);
      case 'control_changed':
        return this.onControlChanged(frame as ControlChangedFrame);
      case 'error':
        return this.onErrorFrame(frame as ErrorFrame);
      case 'ack':
        return this.onAck(frame as AckFrame);
      case 'extension_ui_request':
        return this.onUiRequest(frame as RpcExtensionUIRequest);
      default:
        return this.onEvent(frame as AgentSessionEvent);
    }
  }

  private onWelcome(frame: WelcomeFrame): void {
    const reconnected = this.everConnected;
    this.everConnected = true;
    this.source = 'broker';
    this.reconnectAttempts = 0;

    this.messages = initMessages(frame.snapshot.messages);
    this.stats = frame.snapshot.stats;
    this.state = welcomeToSnapshot(frame, { role: 'observer', controller: null, viewers: 0 }).state;
    this.pendingDialog = frame.pending_dialog ?? null;
    this.snapshotReady = true;

    // Reconcile the broker's controller truth into the arbiter.
    this.arbiter.onBrokerControlChanged(frame.controller_id);

    if (reconnected) this.broadcast({ type: 'broker_status', state: 'revived' });
    for (const tab of this.tabs.values()) tab.send(this.buildSnapshot(this.arbiter.roleOf(tab.id)));

    // Fetch the palette inventory on our observer upstream (spec §5.E, §8).
    this.upstream?.send({ type: 'get_commands' });
  }

  private onControlChanged(frame: ControlChangedFrame): void {
    this.arbiter.onBrokerControlChanged(frame.controller_id);
    // Broadcast the new controller identity to every tab (you_are per tab).
    for (const tab of this.tabs.values()) {
      tab.send(controlChangedToMsg(this.arbiter.controllerLabel(), this.arbiter.roleOf(tab.id)));
    }
  }

  private onErrorFrame(frame: ErrorFrame): void {
    // Broker errors are about a driving op → surface to the web-controller tab.
    const target = this.controllerTab();
    if (!target) return;
    const code = frame.code === 'not_controller' ? 'not_controller' : 'broker_unavailable';
    target.send({ type: 'error', code, message: frame.message });
  }

  private onAck(frame: AckFrame): void {
    const commands = parseCommandsAck(frame);
    if (commands !== null) {
      this.commands = commands;
      for (const w of this.commandWaiters.splice(0)) w(commands);
      return;
    }
    if (frame.for === 'get_commands') return; // a failed get_commands ack — ignore.
    // Other acks belong to the controller's last command.
    this.controllerTab()?.send(ackToMsg(frame));
  }

  private onUiRequest(req: RpcExtensionUIRequest): void {
    const t = translateUiRequest(req);
    switch (t.kind) {
      case 'dialog':
        // Cache as the pending dialog (a late-joining tab gets it in snapshot),
        // and fan out — observers render it read-only (spec H.2).
        this.pendingDialog = req;
        for (const tab of this.tabs.values()) tab.send(t.msg);
        return;
      case 'chrome':
      case 'set_input':
        // No frozen v1 wire carrier (the SPA understands only `WsServerMsg`).
        // Routed by the design to chrome / the input field; deferred until the
        // protocol carries them. Dropped here rather than faked.
        return;
    }
  }

  private onEvent(event: AgentSessionEvent): void {
    // Fold into the cached snapshot so mid-stream joiners are current (D12)…
    this.messages = applyEvent(this.messages, event);
    // …keep the streaming flag fresh for the indicator (spec C.10)…
    if (this.state) {
      if (event.type === 'agent_start') this.state = { ...this.state, isStreaming: true };
      else if (event.type === 'agent_end') this.state = { ...this.state, isStreaming: false };
      else if (event.type === 'session_info_changed') this.state = { ...this.state, sessionName: event.name ?? null };
      else if (event.type === 'thinking_level_changed') this.state = { ...this.state, thinkingLevel: event.level };
    }
    // …and relay verbatim to every tab.
    const msg = eventToMsg(event);
    for (const tab of this.tabs.values()) tab.send(msg);
  }

  // -------------------------------------------------------------------------
  // Broker down / reconnect (D5, §7)
  // -------------------------------------------------------------------------

  private handleClose(): void {
    if (this.disposed) return;
    this.upstream = null;
    this.broadcast({ type: 'broker_status', state: 'down' });
    if (this.tabs.size > 0) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.backoff.maxAttempts) {
      // Give up live retries — fall back to a static snapshot + Revive (§7).
      void this.loadStatic();
      return;
    }
    const delay = Math.min(this.backoff.maxMs, this.backoff.baseMs * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed || this.tabs.size === 0) return;
      this.broadcast({ type: 'broker_status', state: 'reconnecting' });
      this.connectUpstream();
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Client → server messages
  // -------------------------------------------------------------------------

  /** Pump one client frame from a tab. Controller-only frames from a non-
   *  controller tab are rejected pre-broker (spec §6.2, AC-14). */
  handleClientMsg(tabId: string, msg: WsClientMsg): void {
    if (msg.type === 'request_control') return this.arbiter.requestControl(tabId);
    if (msg.type === 'release_control') return this.arbiter.releaseControl(tabId);

    if (isControllerOnly(msg) && this.arbiter.roleOf(tabId) !== 'controller') {
      this.tabs.get(tabId)?.send({
        type: 'error',
        code: 'not_controller',
        message: 'This tab is not the controller.',
      });
      return;
    }

    if (msg.type === 'dialog_response') this.pendingDialog = null;
    const frame = clientMsgToFrame(msg);
    if (frame) this.upstream?.send(frame);
  }

  // -------------------------------------------------------------------------
  // Command inventory (for the canvas-routes commands endpoint, spec §6.1)
  // -------------------------------------------------------------------------

  /** The node's slash-command inventory, fetched on the observer upstream.
   *  `null` for a dormant node (no live command source → the route returns
   *  409 `no_command_source`). */
  getCommands(): Promise<Command[] | null> {
    if (this.commands !== null) return Promise.resolve(this.commands);
    if (this.source === 'static' || (this.upstream === null && this.reconnectTimer === null)) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = this.commandWaiters.indexOf(wrapped);
        if (i !== -1) this.commandWaiters.splice(i, 1);
        resolve(this.commands);
      }, 3_000);
      const wrapped = (c: Command[] | null): void => {
        clearTimeout(timer);
        resolve(c);
      };
      this.commandWaiters.push(wrapped);
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private buildSnapshot(role: WebRole): SnapshotMsg {
    const msg: SnapshotMsg = {
      type: 'snapshot',
      history: this.messages,
      stats: this.stats ?? staticStats(this.nodeId, this.messages),
      state: this.state ?? staticState(this.nodeId, { model: null, thinkingLevel: null }),
      role,
      controller: this.arbiter.controllerLabel(),
      viewers: this.tabs.size,
      source: this.source,
    };
    if (this.pendingDialog) msg.pending_dialog = this.pendingDialog;
    return msg;
  }

  private controllerTab(): Tab | undefined {
    for (const tab of this.tabs.values()) {
      if (this.arbiter.roleOf(tab.id) === 'controller') return tab;
    }
    return undefined;
  }

  private broadcast(msg: WsServerMsg): void {
    for (const tab of this.tabs.values()) tab.send(msg);
  }

  /** Notify all tabs of a broker-status change (exposed for the registry/test). */
  pushBrokerStatus(state: BrokerStatus): void {
    this.broadcast({ type: 'broker_status', state });
  }
}

// ===========================================================================
// Static (dormant) snapshot fabrication — no broker, so synthesize the
// minimal SessionState/SessionStats the wire requires (spec C.3/F.4).
// ===========================================================================

function staticState(
  nodeId: string,
  norm: { model: string | null; thinkingLevel: string | null },
): SessionState {
  return {
    sessionId: nodeId,
    sessionFile: null,
    model: norm.model,
    isStreaming: false,
    thinkingLevel: (norm.thinkingLevel as SessionState['thinkingLevel']) ?? 'off',
    steeringMode: 'all',
    followUpMode: 'all',
    sessionName: null,
    autoCompactionEnabled: true,
    pendingMessageCount: 0,
  };
}

function staticStats(nodeId: string, history: AgentMessage[]): SessionStats {
  let userMessages = 0;
  let assistantMessages = 0;
  for (const m of history) {
    if (m.role === 'user') userMessages += 1;
    else if (m.role === 'assistant') assistantMessages += 1;
  }
  return {
    sessionFile: undefined,
    sessionId: nodeId,
    userMessages,
    assistantMessages,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: history.length,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}
