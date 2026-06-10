// SPA routes (react-router-dom v7). `/` → CanvasPage, `/nodes/:id` → NodePage.
// The global ReconnectingBanner reads server-bridge connectivity from the
// shared zustand store (spec §7 server-restart).

import { Routes, Route, useParams } from "react-router-dom";
import { CanvasPage } from "./pages/canvas-page.js";
import { NodePage } from "./pages/node-page.js";
import { useServerStatus } from "./lib/server-status.js";

function NodePageRoute() {
  const { id } = useParams<{ id: string }>();
  return <NodePage id={id ?? ""} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<CanvasPage />} />
      <Route path="/nodes/:id" element={<NodePageRoute />} />
      {/* Unknown URLs fall back to the canvas (matches the SolidJS default). */}
      <Route path="*" element={<CanvasPage />} />
    </Routes>
  );
}

/** Banner shown while the server WebSocket is unreachable (§7 server-restart). */
export function ReconnectingBanner() {
  const reachable = useServerStatus((s) => s.reachable);
  if (reachable) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-warning/90 px-4 py-1.5 text-center text-sm font-medium text-background"
    >
      Reconnecting to the crouter-web server…
    </div>
  );
}
