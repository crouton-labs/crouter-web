# Contributing to crouter-web

Issues and pull requests are welcome at [github.com/crouton-labs/crouter-web](https://github.com/crouton-labs/crouter-web).

## Before you start

- **Bugs:** open an issue with the crouter-web version (`npm ls -g @crouton-kit/crouter-web`), your OS and browser, and the steps that fail, with any output from the `crouter-web serve` terminal or the browser console.
- **Features and larger changes:** open an issue first, so the direction is agreed before you write the code.
- **Questions:** ask in [Discord](https://discord.gg/afwW4saEtr) or open an issue.
- **Security problems:** do not open a public issue. See [SECURITY.md](SECURITY.md).

## Set up

You need Node.js 20 or later (`engines` in `package.json`; CI runs Node 22) and npm. crouter-web reads the crouter canvas on the same machine, so install [crouter](https://github.com/crouton-labs/crouter) too if you want to see real nodes.

```bash
git clone git@github.com:crouton-labs/crouter-web.git
cd crouter-web
npm ci
npm run build
```

To work on it, run the API server and the Vite dev server in two terminals:

```bash
npm run dev:server
npm run dev:client
```

## Run the tests

```bash
npm test             # Node test runner over src/**/__tests__/*.test.ts
npm run typecheck    # tsc for the server and for the client
npm run lint         # px-ban: no arbitrary pixel sizes in src/client
```

There is no CI job for these yet. The only workflow publishes to npm, so run all three before you push.

## Pull requests

- Branch from the current `main`, and keep one change per pull request.
- Describe what changed and why in the pull request body, and say how you tested it. For a change to the UI, include a screenshot.
- Add or update a test for behavior you change.
- Keep the history linear: rebase onto `main` rather than merging it into your branch.
- Commit messages follow the style of the existing log: a short imperative subject, with a prefix such as `fix(client):` or `docs:` when it helps. The publish workflow bumps the version and commits `chore: release`, so leave `version` in `package.json` alone.

## Repository layout

| Path | Contents |
|---|---|
| [`src/server`](src/server) | The `crouter-web` CLI, the REST routes under `/api`, and the WebSocket servers |
| [`src/client`](src/client) | The React app |
| [`src/shared`](src/shared) | Types and message-folding code used by both |
| [`scripts`](scripts) | The `lint` script and a demo-data seeder |
| [`test`](test) | Test fixtures |

## License

crouter-web is licensed under GPL-3.0-only. By contributing, you agree that your contribution is licensed under the same terms.
