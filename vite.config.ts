import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

// The whole codebase uses `.js` extensions on relative imports (Node16 ESM
// convention from ~/Code/cli/CLAUDE.md). Vite's bundler resolution does not map
// a `.js` specifier to its `.ts`/`.tsx` source, so this tiny plugin does — only
// for relative specifiers whose `.js` target is absent but a TS source exists.
function resolveJsToTs() {
  return {
    name: "resolve-js-to-ts",
    enforce: "pre" as const,
    resolveId(source: string, importer: string | undefined) {
      if (!importer || !source.startsWith(".") || !source.endsWith(".js")) return null;
      const base = pathResolve(dirname(importer), source.slice(0, -3));
      for (const ext of [".ts", ".tsx"]) {
        if (existsSync(base + ext)) return base + ext;
      }
      return null;
    },
  };
}

export default defineConfig({
  root: "src/client",
  plugins: [resolveJsToTs(), react(), tailwindcss()],
  resolve: {
    // shadcn/ui convention: "@/..." resolves to the client source root.
    alias: { "@": pathResolve(import.meta.dirname, "src/client") },
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4317",
      "/ws": { target: "ws://127.0.0.1:4317", ws: true },
    },
  },
});
