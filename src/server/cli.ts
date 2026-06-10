#!/usr/bin/env node
// bin entry for `crouter-web` (design: CLI / boot). Default subcommand `serve`.
// Parses `serve [--port N] [--host H]`; everything else is the server's job.

import { serve } from "./serve.js";

const DEFAULT_PORT = 4317;
const DEFAULT_HOST = "127.0.0.1";

interface ParsedArgs {
  port: number;
  host: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  // Drop a leading `serve` subcommand (bare `crouter-web` also means serve).
  const args = argv[0] === "serve" ? argv.slice(1) : argv;
  let port = DEFAULT_PORT;
  let host = DEFAULT_HOST;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--port" || a === "-p") {
      const v = args[++i];
      if (!v || Number.isNaN(Number(v))) fail(`--port needs a number, got: ${v ?? "(nothing)"}`);
      port = Number(v);
    } else if (a === "--host") {
      const v = args[++i];
      if (!v) fail("--host needs a value");
      host = v;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`unknown argument: ${a}`);
    }
  }
  return { port, host };
}

function fail(msg: string): never {
  process.stderr.write(`crouter-web: ${msg}\n`);
  process.exit(2);
}

function printHelp(): void {
  process.stdout.write(
    [
      "crouter-web — web frontend for the crouter agent runtime",
      "",
      "Usage: crouter-web [serve] [--port N] [--host H]",
      "",
      `  --port N   port to bind (default ${DEFAULT_PORT})`,
      `  --host H   interface to bind (default ${DEFAULT_HOST}; loopback only —`,
      "             overriding prints a no-auth warning, no auth is ever added)",
      "  -h, --help show this help",
      "",
    ].join("\n"),
  );
}

const { port, host } = parseArgs(process.argv.slice(2));

serve({ port, host }).catch((err: unknown) => {
  process.stderr.write(`crouter-web: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
