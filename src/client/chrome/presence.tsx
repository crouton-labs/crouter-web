/**
 * Presence + control affordance (spec §5.D.2/D.3). Shows who holds control
 * (this tab / another web tab / an external attach) and the live viewer count
 * from the session store, plus a "Request control" button for observers and a
 * "Release control" button for the controller.
 */

import { Show, type JSX } from 'solid-js';
import type { SessionStore } from '../store/session-store.js';

export function Presence(props: { store: SessionStore }): JSX.Element {
  const presence = () => props.store.presence();
  const isController = () => props.store.role() === 'controller';
  // The server reports its own client id as `controller` when a web tab holds
  // it; when this tab is the controller we say "you", otherwise "another client".
  const controllerLabel = (): string => {
    if (isController()) return 'you';
    const c = presence().controller;
    return c ? 'another client' : 'no one';
  };

  return (
    <div class="presence">
      <span class="presence-viewers" title="connected viewers">
        👁 {presence().viewers}
      </span>
      <span class="presence-controller">
        control: <strong>{controllerLabel()}</strong>
      </span>
      <Show
        when={isController()}
        fallback={
          <button class="btn-secondary" onClick={() => props.store.requestControl()}>
            Request control
          </button>
        }
      >
        <button class="btn-secondary" onClick={() => props.store.releaseControl()}>
          Release control
        </button>
      </Show>
    </div>
  );
}
