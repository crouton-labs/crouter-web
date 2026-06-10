// Static SPA serving (design D7) — `sirv` over the built `dist/client` bundle with
// SPA index.html fallback (`single:true`) and correct content-types. This handler is
// the router's fallback: it runs only when no API route matched. During dev the
// `dist/client` dir may not exist yet (Vite owns it) — handle that gracefully by
// answering a clear 404 instead of throwing at boot.

import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sirv from "sirv";

/** Default built-bundle dir: `dist/client`, relative to this module at `dist/server/http/`. */
function defaultClientDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../client");
}

export interface ServeStaticOptions {
  /** Override the bundle dir (defaults to `dist/client`). */
  dir?: string;
  /** Enable sirv's dev mode (no caching); defaults to false. */
  dev?: boolean;
}

/**
 * Build the static-serving request handler. When the bundle dir is missing (dev /
 * unbuilt), returns a handler that answers 404 with a build hint rather than crashing.
 */
export function serveStatic(opts: ServeStaticOptions = {}): (req: IncomingMessage, res: ServerResponse) => void {
  const dir = opts.dir ?? defaultClientDir();
  if (!existsSync(dir)) {
    return (_req, res) => {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Client bundle not found at ${dir}. Run \`vite build\` (or \`npm run build\`).`);
    };
  }
  const handler = sirv(dir, {
    single: true,
    dev: opts.dev ?? false,
    etag: true,
    gzip: true,
    brotli: true,
  });
  return (req, res) => {
    handler(req, res, () => {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    });
  };
}
