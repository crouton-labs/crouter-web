/**
 * The single web-controller slot across all tabs of ONE node (design D4, spec
 * §5.D). A pure state machine over injected callbacks — no socket, no tab
 * registry — so it unit-tests without a live broker.
 *
 * Two coupled facts it tracks:
 *   - `webController`: which browser tab (if any) currently holds the web slot;
 *   - the broker's truth: whether the server's upstream client holds the
 *     broker controller slot (`controllerId === clientId`), an EXTERNAL client
 *     holds it (`controllerId !== clientId && !== null`), or it is free
 *     (`controllerId === null`), learned via `onBrokerControlChanged`.
 *
 * Lazy hold (D4): the server sends `request_control` upstream only when a web
 * tab first becomes web-controller, and `release_control` only when no web tab
 * holds control — so an external `crtr attach` can contend for the same one
 * broker slot. A tab is `controller` for gating purposes ONLY once it is the
 * `webController` AND the broker slot is confirmed held.
 */

import type { ClientToBroker } from '../crouter-lib.js';
import type { WebRole, WsServerMsg } from '../../shared/protocol.js';

/** Everything the arbiter needs from the hub, injected so it stays socket-free
 *  and unit-testable (D4). */
export interface ArbiterDeps {
  /** The server's upstream broker client id (one per hub). The broker reports
   *  this back as `controller_id` once we hold the slot. */
  clientId: string;
  /** Send a control frame on the hub's single upstream broker connection. */
  sendUpstream: (frame: ClientToBroker) => void;
  /** Deliver a server→client message to one tab (no-op if the tab is gone). */
  notifyTab: (tabId: string, msg: WsServerMsg) => void;
}

export class ControllerArbiter {
  private webController: string | null = null;
  /** True once the broker confirmed our upstream client holds its slot. */
  private brokerSlotHeld = false;
  /** True while an external broker client (e.g. a `crtr attach`) holds it. */
  private externalHolds = false;
  /** The broker's last-known controller id (for the displayed label). */
  private controllerId: string | null = null;

  constructor(private readonly deps: ArbiterDeps) {}

  /** The label shown as `controller` on the wire (the broker's controller id,
   *  be it our client id, an external id, or null). */
  controllerLabel(): string | null {
    return this.controllerId;
  }

  /** This tab's role for gating + display: `controller` only when it holds the
   *  web slot AND the broker slot is confirmed (a pending request reads as
   *  `observer` until the broker grants it). */
  roleOf(tabId: string): WebRole {
    return this.webController === tabId && this.brokerSlotHeld ? 'controller' : 'observer';
  }

  /** Does an external broker client currently hold the slot? (D5 display.) */
  hasExternalController(): boolean {
    return this.externalHolds;
  }

  /** Tab asks to drive (spec §5.D, Flow 3). Denied while an external client
   *  holds the broker slot; otherwise this tab becomes web-controller, any
   *  prior web-controller tab is demoted + notified, and — if we do not yet
   *  hold the broker slot — `request_control` goes upstream (confirmed later
   *  via `onBrokerControlChanged`). */
  requestControl(tabId: string): void {
    if (this.externalHolds) {
      this.deps.notifyTab(tabId, {
        type: 'error',
        code: 'control_denied',
        message: 'An external attach client holds control of this node.',
      });
      return;
    }

    const prev = this.webController;
    if (prev === tabId) {
      // Already the web-controller — re-confirm if the broker slot is held.
      if (this.brokerSlotHeld) {
        this.deps.notifyTab(tabId, {
          type: 'control_changed',
          controller: this.controllerId,
          you_are: 'controller',
        });
      }
      return;
    }

    this.webController = tabId;
    if (prev !== null) {
      this.deps.notifyTab(prev, {
        type: 'control_changed',
        controller: this.controllerId,
        you_are: 'observer',
      });
    }

    if (this.brokerSlotHeld) {
      // We already drive upstream — this is a pure tab→tab handoff.
      this.deps.notifyTab(tabId, {
        type: 'control_changed',
        controller: this.controllerId,
        you_are: 'controller',
      });
    } else {
      // Acquire the broker slot lazily; promotion confirms on the broker's
      // `control_changed` → onBrokerControlChanged.
      this.deps.sendUpstream({ type: 'request_control' });
    }
  }

  /** Tab releases the web slot (spec §5.D, D.7). Clears the slot and, if no web
   *  tab holds control, releases the broker slot upstream so an external attach
   *  can take it. */
  releaseControl(tabId: string): void {
    if (this.webController !== tabId) return;
    this.webController = null;
    this.deps.notifyTab(tabId, {
      type: 'control_changed',
      controller: null,
      you_are: 'observer',
    });
    if (this.brokerSlotHeld) {
      this.deps.sendUpstream({ type: 'release_control' });
      // brokerSlotHeld flips false when the broker echoes control_changed{null}.
    }
  }

  /** A tab disconnected (closed/navigated away). If it was the web-controller,
   *  free the slot exactly as an explicit release would (spec §7 multi-tab). */
  handleTabClose(tabId: string): void {
    if (this.webController === tabId) this.releaseControl(tabId);
  }

  /** Reconcile against the broker's authoritative `controller_id` (from a
   *  `WelcomeFrame` at attach, or a relayed `ControlChangedFrame`). This is the
   *  single point that flips `brokerSlotHeld`/`externalHolds`. */
  onBrokerControlChanged(controllerId: string | null): void {
    this.controllerId = controllerId;

    if (controllerId === this.deps.clientId) {
      // We now hold the broker slot — confirm the pending web-controller tab.
      this.brokerSlotHeld = true;
      this.externalHolds = false;
      if (this.webController !== null) {
        this.deps.notifyTab(this.webController, {
          type: 'control_changed',
          controller: controllerId,
          you_are: 'controller',
        });
      }
    } else if (controllerId === null) {
      // Slot is free (we or an external client released it).
      this.brokerSlotHeld = false;
      this.externalHolds = false;
    } else {
      // An external client grabbed the slot — demote any web-controller tab.
      this.brokerSlotHeld = false;
      this.externalHolds = true;
      if (this.webController !== null) {
        const demoted = this.webController;
        this.webController = null;
        this.deps.notifyTab(demoted, {
          type: 'control_changed',
          controller: controllerId,
          you_are: 'observer',
        });
      }
    }
  }
}
