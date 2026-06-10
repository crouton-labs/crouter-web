// The application shell: router provider + the global tooltip provider + the
// reconnecting banner. AppRoutes owns the `/` ↔ `/nodes/:id` routes.

import { BrowserRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppRoutes, ReconnectingBanner } from "./app-routes.js";
import { ProfileProvider } from "./profile/provider.js";
import { AppShell } from "./shell/app-shell.js";

export function App() {
  return (
    <ProfileProvider>
      <BrowserRouter>
        <TooltipProvider delayDuration={300}>
          <ReconnectingBanner />
          <AppShell>
            <AppRoutes />
          </AppShell>
        </TooltipProvider>
      </BrowserRouter>
    </ProfileProvider>
  );
}
