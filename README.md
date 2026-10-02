# crouter-web — a web frontend for the crouter agent runtime: browse the canvas and drive agent sessions in a browser

![crouter-web](https://raw.githubusercontent.com/crouton-labs/crouter-web/main/assets/banner.svg)

<p align="center">
  <a href="https://www.npmjs.com/package/@crouton-kit/crouter-web"><img alt="npm" src="https://img.shields.io/npm/v/@crouton-kit/crouter-web?label=npm"></a>
  <a href="https://nodejs.org"><img alt="node" src="https://img.shields.io/badge/node-%3E%3D20-339933"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-GPL--3.0-blue"></a>
  <a href="https://discord.gg/afwW4saEtr"><img alt="discord" src="https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white"></a>
</p>

crouter-web is a local web server and a React app for [crouter](https://github.com/crouton-labs/crouter). It reads the crouter canvas on the machine it runs on and serves a browser UI for it: a list of conversations, a canvas view of every node, an inbox for the human pages nodes send, and a page per node where you read the session and send messages. It uses crouter as a library, so what you see is the same state `crtr` shows.

From the browser you can start a node, send it a message, revive or close it, and answer the pages in your inbox. A live node's session streams to the page over a WebSocket to its broker. A node with no broker is shown from its saved session file.

crouter-web has no authentication. It binds to `127.0.0.1` by default, and if you pass another `--host` it prints a warning and stays unauthenticated, so put it behind something that authenticates before exposing it.

## Install

```bash
npm install -g @crouton-kit/crouter-web
```

It needs Node.js 20 or later and crouter state on the same machine. The package depends on the `@crouton-kit/crouter` npm package and reads the canvas under your crouter home directory.

## Usage

```bash
crouter-web serve
# crouter-web listening on http://127.0.0.1:4317
```

Open that address in a browser. Options: `--port <n>` (default 4317) and `--host <address>` (default `127.0.0.1`). `crouter-web -h` prints them.

## Develop

```bash
git clone git@github.com:crouton-labs/crouter-web.git
cd crouter-web
npm ci
npm run dev:server   # API and WebSocket server, restarts on change
npm run dev:client   # Vite dev server for the React app
```

`npm run build` compiles the server with `tsc` and the client with Vite into `dist/`; `npm start` serves that build. `npm test` runs the Node test runner over the server and client unit tests, and `npm run typecheck` checks both.

The server is in `src/server` (REST routes under `/api`, WebSockets at `/ws/canvas` and per-node session sockets), the app in `src/client`, and the types shared between them in `src/shared`. A GitHub Actions workflow publishes to npm on every push to `main`.
