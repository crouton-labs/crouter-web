// Browser entry point. Mounts <App/> into #root (see index.html) and pulls in
// the Tailwind v4 + shadcn theme (index.css) so Vite bundles a real stylesheet.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./index.css";

// Dark-primary console (spec north star); the meta color-scheme stays "dark light".
document.documentElement.classList.add("dark");

const root = document.getElementById("root");
if (!root) throw new Error("crouter-web: #root element not found in index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
