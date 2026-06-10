// The application shell: router provider + the global tooltip provider + the
// reconnecting banner. AppRoutes owns the `/` ↔ `/nodes/:id` routes.

import { BrowserRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppRoutes, ReconnectingBanner } from "./app-routes.js";

export function App() {
  return (
    <BrowserRouter>
      <TooltipProvider delayDuration={300}>
        <ReconnectingBanner />
        <AppRoutes />
      </TooltipProvider>
    </BrowserRouter>
  );
}
