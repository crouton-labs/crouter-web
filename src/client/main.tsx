// Browser entry point. Mounts the App into #root (see index.html).

import { render } from "solid-js/web";
import { App } from "./app.js";

const root = document.getElementById("root");
if (!root) throw new Error("crouter-web: #root element not found in index.html");

render(() => <App />, root);
