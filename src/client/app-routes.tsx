/**
 * Minimal self-contained router for the SPA (seam.md: `@solidjs/router` is NOT
 * installed and package.json is parent-owned, so we build ~30 lines here). A
 * module-level `location` signal seeds from `window.location.pathname`, updates
 * on `popstate`, and is pushed by the exported `navigate()`. `<AppRoutes/>`
 * matches `/` → CanvasPage and `/nodes/:id` → NodePage so app.tsx is a 3-line
 * mount. Also exports a `ReconnectingBanner` + `setServerReachable` the shell
 * shows when the server WS drops.
 */

import { createSignal, Show, type JSX } from 'solid-js';
import { CanvasPage } from './pages/canvas-page.js';
import { NodePage } from './pages/node-page.js';

// --- location signal -------------------------------------------------------

const [location, setLocation] = createSignal<string>(window.location.pathname || '/');

window.addEventListener('popstate', () => {
  setLocation(window.location.pathname || '/');
});

/** Push a new path onto history and update the route signal (SPA navigation). */
export function navigate(path: string): void {
  if (path === location()) return;
  window.history.pushState({}, '', path);
  setLocation(path);
}

/** Read the current route path (reactive). */
export { location as currentPath };

// --- server-WS connectivity (for the reconnecting banner) ------------------

const [serverReachable, setServerReachable] = createSignal(true);
export { setServerReachable };

/** A banner shown while the server WebSocket is unreachable (§7 server-restart). */
export function ReconnectingBanner(): JSX.Element {
  return (
    <Show when={!serverReachable()}>
      <div class="reconnecting-banner" role="status">
        Reconnecting to the crouter-web server…
      </div>
    </Show>
  );
}

// --- route matching --------------------------------------------------------

function matchNodeId(path: string): string | null {
  const m = /^\/nodes\/([^/]+)\/?$/.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

/** The route outlet. Mount this from app.tsx. */
export function AppRoutes(): JSX.Element {
  const nodeId = () => matchNodeId(location());
  return (
    <>
      <ReconnectingBanner />
      <Show when={nodeId()} fallback={<CanvasPage />} keyed>
        {(id) => <NodePage id={id} />}
      </Show>
    </>
  );
}
