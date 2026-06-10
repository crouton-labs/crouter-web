/**
 * `nodeId → NodeSessionHub` lifecycle (design HubRegistry row, spec §7).
 *
 * One hub per node, shared by all tabs on that node (D3). The registry ref-
 * counts open tabs and tears a hub down — sending `bye` upstream — when its
 * last tab closes (spec A.6). All node/path resolution and the static
 * normalizer are injected once here and threaded into every hub it creates, so
 * `serve.ts` wires the real crouter-lib + static-session deps in one place and
 * the units stay broker-free in tests.
 */

import type { WsClientMsg, WsServerMsg } from '../../shared/protocol.js';
import { NodeSessionHub, type HubDeps } from './node-session-hub.js';

/** What the registry injects into every hub (the hub deps minus the per-node
 *  identity it fills in itself). */
export type HubRegistryDeps = HubDeps;

/** A registered tab — the ws-agnostic handle the session-ws pump drives. */
export interface TabSession {
  /** Pump one parsed client frame from this tab. */
  handleClientMsg(msg: WsClientMsg): void;
  /** This tab disconnected — free its slot, maybe tear the hub down. */
  close(): void;
}

export class HubRegistry {
  private readonly hubs = new Map<string, NodeSessionHub>();

  constructor(private readonly deps: HubRegistryDeps) {}

  /**
   * Register a tab on `nodeId`, creating the hub on first use. `send` delivers
   * a server→client message to this tab (the session-ws layer serializes it
   * onto the ws). Returns the per-tab handle the pump drives.
   */
  attachTab(nodeId: string, send: (msg: WsServerMsg) => void): TabSession {
    let hub = this.hubs.get(nodeId);
    if (!hub) {
      hub = new NodeSessionHub(nodeId, this.deps);
      this.hubs.set(nodeId, hub);
    }
    const tabId = hub.addTab(send);
    const boundHub = hub;
    let closed = false;

    return {
      handleClientMsg: (msg) => {
        if (!closed) boundHub.handleClientMsg(tabId, msg);
      },
      close: () => {
        if (closed) return;
        closed = true;
        boundHub.removeTab(tabId);
        if (boundHub.tabCount() === 0) {
          boundHub.dispose();
          this.hubs.delete(nodeId);
        }
      },
    };
  }

  /** The node's slash-command inventory via its (live) hub — the seam the
   *  canvas-routes commands endpoint calls (Child A). `null` when no hub is
   *  open or the node has no live command source. */
  async getCommands(nodeId: string): Promise<import('../../shared/protocol.js').Command[] | null> {
    const hub = this.hubs.get(nodeId);
    if (!hub) return null;
    return hub.getCommands();
  }

  /** Bring a dormant hub for `nodeId` live after a server-side revive: the open
   *  tab transitions read-only→live over its EXISTING socket, no page reload
   *  (AC-18). No-op when no tab is open on the node (the next entry connects
   *  live on its own). */
  reviveHub(nodeId: string): void {
    this.hubs.get(nodeId)?.revive();
  }

  /** True iff a hub is currently open for `nodeId`. */
  has(nodeId: string): boolean {
    return this.hubs.has(nodeId);
  }

  /** The node's host kind (`broker` | `tmux` | `null`), via the injected
   *  resolver. The session-WS upgrade boundary uses it to REJECT a
   *  non-enterable (tmux-hosted or unknown) node before a hub/tab is ever
   *  created — §7 "entering a non-enterable (tmux) node … rejected at the API
   *  boundary" (AC-5). A tmux node has no broker socket to drive, so the static
   *  read the hub would otherwise serve is not a valid session view. */
  hostKind(nodeId: string): 'tmux' | 'broker' | null {
    return this.deps.resolveNode(nodeId)?.hostKind ?? null;
  }

  /** Tear every hub down (graceful server shutdown — `bye` each upstream). */
  disposeAll(): void {
    for (const hub of this.hubs.values()) hub.dispose();
    this.hubs.clear();
  }
}
