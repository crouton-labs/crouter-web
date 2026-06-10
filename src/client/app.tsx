// The application shell. `AppRoutes` (from the SPA client) owns the router, the
// global ReconnectingBanner, and the `/` ↔ `/nodes/:id` pages — App just mounts it.

import type { JSX } from "solid-js";
import { AppRoutes } from "./app-routes.js";

export function App(): JSX.Element {
  return <AppRoutes />;
}
