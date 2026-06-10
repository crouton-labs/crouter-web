// SPA routes (react-router-dom v7). Routes are profile-aware via capability,
// not profile name (design §4.4): `/` resolves to the profile's home — the
// diagnostic Canvas for an audience that can view it, else the Conversations
// list. `/nodes/:id` (Operator) and `/c/:id` (Studio alias) both address the
// SAME node id and render the SAME composed SessionScreen; the URL term is
// itself vocabulary. The global ReconnectingBanner reads server-bridge
// connectivity from the shared zustand store (spec §7 server-restart).

import { Routes, Route, useParams } from "react-router-dom";
import { CanvasPage } from "./pages/canvas-page.js";
import { ConversationsPage } from "./pages/conversations-page.js";
import { NodePage } from "./pages/node-page.js";
import { SettingsPage } from "./pages/settings-page.js";
import { useCapability } from "./profile/provider.js";
import { useServerStatus } from "./lib/server-status.js";

function NodePageRoute() {
  const { id } = useParams<{ id: string }>();
  return <NodePage id={id ?? ""} />;
}

/** `/` resolves to the profile's home: the Canvas for an audience that can view
 *  it (Operator), otherwise the Conversations list (Studio). */
function HomeRoute() {
  const canViewCanvas = useCapability("canvas.view");
  return canViewCanvas ? <CanvasPage /> : <ConversationsPage />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/nodes/:id" element={<NodePageRoute />} />
      <Route path="/c/:id" element={<NodePageRoute />} />
      <Route path="/settings" element={<SettingsPage />} />
      {/* Unknown URLs fall back to the profile home. */}
      <Route path="*" element={<HomeRoute />} />
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
