# Security policy

## Reporting a vulnerability

Please report security vulnerabilities privately, by email to **rhyneer.silas@gmail.com**. Do not open a public GitHub issue or pull request for a suspected vulnerability.

Include what you found, the version (`npm ls -g @crouton-kit/crouter-web`) and platform, and the steps or a proof of concept that reproduce it. If the report involves a token or credential, redact it.

Reports are read by a single maintainer, and no response time is guaranteed. Fix timelines depend on severity and on what the fix involves. Say in your report if you want credit in the fix.

## Supported versions

Fixes land on `main` and ship in the next published release. Only the latest published version is supported.

## What is in scope

The code in this repository: the `crouter-web` server in [`src/server`](src/server) (its REST routes, its WebSocket endpoints and the file-peek route) and the React app in [`src/client`](src/client). Of particular interest:

- The file route reading a path outside the node directories and working directory it is meant to be limited to.
- A request from another origin or another machine driving a node, or reading the canvas, when the server is bound to its default `127.0.0.1`.
- Rendered transcript or document content running script in the browser.

crouter-web has no authentication by design. If you start it with `--host` set to a non-loopback address, anyone who can reach that address has the same access you do; that is documented behavior, not a vulnerability. Problems in `crtr` itself belong in [crouter](https://github.com/crouton-labs/crouter).
