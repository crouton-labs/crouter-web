/**
 * File peek panel (Phase 2c).
 *
 * A right-side panel that shows the contents of an absolute file path. Opens
 * when the user clicks a path in a tool-card subtitle; closes via the ✕ button
 * or the Escape key. Supports Pretty (markdown) and Raw (plain text) modes.
 */

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils.js';
import { peekFile, type FilePeekResponse } from '../api/rest.js';
import { renderMarkdown } from '../render/markdown.js';

export interface FilePeekProps {
  nodeId: string;
  path: string | null;
  onClose: () => void;
}

type Mode = 'pretty' | 'raw';

export function FilePeek({ nodeId, path, onClose }: FilePeekProps) {
  const [mode, setMode] = useState<Mode>('pretty');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FilePeekResponse | null>(null);

  // Load file whenever path changes
  useEffect(() => {
    if (!path) return;
    setLoading(true);
    setError(null);
    setData(null);
    peekFile(nodeId, path)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [nodeId, path]);

  // Escape key closes
  useEffect(() => {
    if (!path) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [path, onClose]);

  if (!path) return null;

  return (
    <div
      className="flex flex-col h-full w-[340px] shrink-0 border-l border-border bg-card/95 backdrop-blur-sm z-[1]"
      style={{ position: 'relative' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span style={{ color: 'var(--status-active)' }} className="shrink-0">◆</span>
        {/* rtl truncation shows the filename end */}
        <span
          className="font-mono text-xs truncate flex-1"
          style={{ direction: 'rtl', textAlign: 'left', unicodeBidi: 'plaintext' }}
          title={path}
        >
          {path}
        </span>
        {/* Pretty/Raw toggle */}
        <div className="flex gap-0.5 shrink-0">
          <button
            type="button"
            className={cn(
              'px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors',
              mode === 'pretty' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setMode('pretty')}
          >
            Pretty
          </button>
          <button
            type="button"
            className={cn(
              'px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors',
              mode === 'raw' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setMode('raw')}
          >
            Raw
          </button>
        </div>
        {/* Close */}
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors text-sm leading-none"
          onClick={onClose}
          aria-label="Close file peek"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-16 text-muted-foreground text-xs">
            <span className="animate-pulse">Loading…</span>
          </div>
        )}
        {error && (
          <div className="px-3 py-2 text-xs text-destructive">{error}</div>
        )}
        {data && !loading && (
          <>
            {data.truncated && (
              <div className="px-3 py-1 text-[10px] text-muted-foreground/60 bg-muted/40 border-b border-border">
                File truncated — showing partial content
              </div>
            )}
            {mode === 'raw' ? (
              <pre className="text-xs font-mono p-3 whitespace-pre-wrap break-all">{data.content}</pre>
            ) : (
              <PrettyView content={data.content} />
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="text-[10px] text-muted-foreground/50 px-3 py-2 border-t border-border">
        any file path in the stream opens here · esc
      </div>
    </div>
  );
}

function PrettyView({ content }: { content: string }) {
  // Check for YAML frontmatter
  if (content.startsWith('---\n') || content.startsWith('---\r\n')) {
    const endIdx = content.indexOf('\n---\n', 4);
    if (endIdx !== -1) {
      const fmRaw = content.slice(4, endIdx);
      const rest = content.slice(endIdx + 5);
      const pairs = fmRaw
        .split('\n')
        .map((line) => {
          const colon = line.indexOf(':');
          if (colon < 1) return null;
          return { key: line.slice(0, colon).trim(), val: line.slice(colon + 1).trim() };
        })
        .filter(Boolean) as { key: string; val: string }[];

      return (
        <div className="p-3">
          {pairs.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {pairs.map(({ key, val }) => (
                <span key={key} className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                  <span className="text-muted-foreground">{key}:</span> {val}
                </span>
              ))}
            </div>
          )}
          <div
            className="prose prose-sm max-w-none text-foreground"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(rest) }}
          />
        </div>
      );
    }
  }

  return (
    <div
      className="prose prose-sm max-w-none text-foreground p-3"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
}
