/**
 * Presence + control affordance (spec §5.D.2/D.3). Shows who holds control
 * (this tab / another web tab / an external attach) and the live viewer count
 * from the session store, plus a "Request control" button for observers and a
 * "Release control" button for the controller.
 */

import type { ReactNode } from 'react';
import type { Presence as PresenceData, WebRole } from '../../shared/protocol.js';

/** React-compatible subset of the session store — plain values, not signal accessors. */
interface PresenceStore {
  presence: PresenceData;
  role: WebRole;
  /** Whether the session socket is actually open (gates request_control). */
  socketReady: boolean;
  requestControl: () => void;
  releaseControl: () => void;
}

export function Presence(props: { store: PresenceStore }): ReactNode {
  const presence = props.store.presence;
  const isController = props.store.role === 'controller';
  // The server reports its own client id as `controller` when a web tab holds
  // it; when this tab is the controller we say "you", otherwise "another client".
  const controllerLabel = (): string => {
    if (isController) return 'you';
    return presence.controller ? 'another client' : 'no one';
  };

  return (
    <div className="ctl-state flex shrink-0 items-center gap-[10px]">
      <span
        className="inline-flex items-center gap-1"
        title="connected viewers"
        style={{ color: 'var(--mut)' }}
      >
        👁 {presence.viewers}
      </span>
      <span className="inline-flex items-center gap-[5px]" style={{ color: 'var(--mut)' }}>
        control:{' '}
        <span style={{ color: 'var(--ink2)', fontStyle: 'italic' }}>{controllerLabel()}</span>
      </span>
      {isController ? (
        <button type="button" className="btn sm" onClick={() => props.store.releaseControl()}>
          Release control
        </button>
      ) : (
        <button
          type="button"
          className="btn primary sm"
          disabled={!props.store.socketReady}
          title={props.store.socketReady ? undefined : 'connecting…'}
          onClick={() => props.store.requestControl()}
        >
          Request control
        </button>
      )}
    </div>
  );
}
