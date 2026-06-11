// View manifest store — reads agent-authored views from the canvas views dir.
// Views live at $CRTR_HOME/views/<id>.json (default ~/.crouter/canvas/views/).
// Validation is strict: missing id/title/tabs throws; the caller gets [].

import { readdir, readFile } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ViewManifest } from '../../shared/protocol.js';

export function crtrHome(): string {
  return process.env.CRTR_HOME ?? join(homedir(), '.crouter', 'canvas');
}

export function canvasViewsDir(): string {
  return join(crtrHome(), 'views');
}

export function validateViewManifest(raw: unknown): ViewManifest {
  if (!raw || typeof raw !== 'object') throw new Error('view manifest must be an object');
  const obj = raw as Record<string, unknown>;
  if (typeof obj['id'] !== 'string' || !obj['id']) throw new Error('view manifest missing id');
  if (typeof obj['title'] !== 'string' || !obj['title']) throw new Error('view manifest missing title');
  if (!Array.isArray(obj['tabs'])) throw new Error('view manifest missing tabs array');
  return raw as ViewManifest;
}

export async function listViews(): Promise<ViewManifest[]> {
  const dir = canvasViewsDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }

  const manifests: ViewManifest[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(dir, entry), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      manifests.push(validateViewManifest(parsed));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`crouter-web: skipping invalid view ${entry}: ${msg}\n`);
    }
  }

  manifests.sort((a, b) => (b.updated_at < a.updated_at ? -1 : b.updated_at > a.updated_at ? 1 : 0));
  return manifests;
}

export async function getView(id: string): Promise<ViewManifest | null> {
  const dir = canvasViewsDir();
  const filePath = join(dir, `${id}.json`);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return null;
    throw err;
  }
  // JSON parse + validation errors mean a corrupt view file — treat as not found
  // rather than crashing the request. Any other error (permissions etc.) already
  // threw above.
  try {
    const parsed: unknown = JSON.parse(raw);
    return validateViewManifest(parsed);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`crouter-web: corrupt view file ${filePath}: ${msg}\n`);
    return null;
  }
}

export async function inlineMarkdownSources(
  view: ViewManifest,
  isContainedFn: (resolved: string, ...allowed: string[]) => boolean,
  nodeDirFn: (id: string) => string,
): Promise<ViewManifest> {
  const tabs = await Promise.all(
    view.tabs.map(async (tab) => {
      const blocks = await Promise.all(
        tab.blocks.map(async (block) => {
          if (block.kind !== 'markdown') return block;
          const src = block.source;
          if (!('node_id' in src)) return block;
          // source is {node_id, path} — resolve and inline.
          const { node_id, path } = src;
          // Every failure (path resolution, containment, read) produces a
          // placeholder — per spec §7 "on failure replace with unavailable".
          let inlined: string;
          try {
            const resolved = await realpath(path);
            const allowed = nodeDirFn(node_id);
            if (!isContainedFn(resolved, allowed)) {
              return {
                kind: 'markdown' as const,
                source: { inline: '> *[source unavailable: path outside node directory]*' },
              };
            }
            inlined = await readFile(resolved, 'utf8');
          } catch (err: unknown) {
            // realpath or readFile failed — path missing, permissions, etc.
            const msg = err instanceof Error ? err.message : String(err);
            return {
              kind: 'markdown' as const,
              source: { inline: `> *[source unavailable: ${msg}]*` },
            };
          }
          return { kind: 'markdown' as const, source: { inline: inlined } };
        }),
      );
      return { ...tab, blocks };
    }),
  );
  return { ...view, tabs };
}
