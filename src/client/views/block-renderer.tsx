/**
 * Renders an array of ViewBlock[] — the typed content blocks within a view tab.
 * Three block kinds: kpis, barlist, markdown. Layout follows the mockup grid.
 */

import { useMemo } from 'react';
import type { ViewBlock } from '../../shared/protocol.js';
import { renderMarkdown } from '../render/markdown.js';
import { cn } from '@/lib/utils.js';

export function BlockRenderer({ blocks }: { blocks: ViewBlock[] }): React.ReactElement {
  // Pair barlist+markdown side-by-side when they appear together (7fr 5fr grid),
  // matching Surface 3/4. KPIs always span full width above.
  const kpiBlocks = blocks.filter((b) => b.kind === 'kpis');
  const gridBlocks = blocks.filter((b) => b.kind === 'barlist' || b.kind === 'markdown');

  return (
    <div>
      {kpiBlocks.map((block, i) => {
        if (block.kind !== 'kpis') return null;
        return <KpiGrid key={i} items={block.items} />;
      })}

      {gridBlocks.length > 0 && (
        <div
          className={cn(
            'mt-3 gap-3',
            gridBlocks.length >= 2 ? 'grid' : 'flex flex-col',
          )}
          style={gridBlocks.length >= 2 ? { gridTemplateColumns: '7fr 5fr' } : undefined}
        >
          {gridBlocks.map((block, i) => {
            if (block.kind === 'barlist') return <BarListBlock key={i} block={block} />;
            if (block.kind === 'markdown') return <MarkdownBlock key={i} block={block} />;
            return null;
          })}
        </div>
      )}
    </div>
  );
}

// ─── KPI grid ────────────────────────────────────────────────────────────────

function isTextValue(value: string): boolean {
  // Heuristic: if it doesn't start with a digit or $, treat as prose text.
  return !/^[\d$]/.test(value.trim());
}

function KpiGrid({
  items,
}: {
  items: { label: string; value: string; unit?: string; sub?: string }[];
}): React.ReactElement {
  return (
    <div className="mb-3.5 grid grid-cols-4 gap-3">
      {items.map((item, i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-card px-[18px] pb-3.5 pt-4"
          style={{ boxShadow: 'inset 0 1px 0 var(--raise, rgba(255,255,255,0.06))' }}
        >
          <span
            className="instlabel block text-[11px] uppercase tracking-widest text-muted-foreground"
          >
            {item.label}
          </span>
          <div
            className="mt-2"
            style={
              isTextValue(item.value)
                ? {
                    fontFamily: 'var(--font-display)',
                    fontStyle: 'italic',
                    fontWeight: 480,
                    fontSize: '19px',
                    letterSpacing: 0,
                    color: 'var(--foreground)',
                  }
                : {
                    fontFamily: 'var(--font-inst)',
                    fontSize: '21px',
                    fontWeight: 600,
                    letterSpacing: '0.01em',
                    color: 'var(--foreground)',
                  }
            }
          >
            {item.value}
            {item.unit && (
              <span
                className="text-muted-foreground"
                style={{ fontSize: '10px', fontWeight: 400 }}
              >
                {item.unit}
              </span>
            )}
          </div>
          {item.sub && (
            <p className="mt-1 text-[11px] text-muted-foreground">{item.sub}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Bar list ────────────────────────────────────────────────────────────────

function BarListBlock({
  block,
}: {
  block: Extract<ViewBlock, { kind: 'barlist' }>;
}): React.ReactElement {
  const { title, rows } = block;
  const maxVal = Math.max(...rows.map((r) => r.max ?? r.value), 1);

  return (
    <div
      className="rounded-lg border border-border bg-card p-4"
      style={{ boxShadow: 'inset 0 1px 0 var(--raise, rgba(255,255,255,0.06))' }}
    >
      {/* caption */}
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>

      {/* rows */}
      <div className="flex flex-col gap-2">
        {rows.map((row, i) => {
          const pct = Math.min(100, Math.round((row.value / maxVal) * 100));
          const isTop = i === 0;
          return (
            <div key={i} className="flex items-center gap-2">
              {/* label */}
              <span
                className="min-w-0 shrink-0 basis-[52%] truncate text-xs"
                style={{ color: isTop ? 'var(--foreground)' : 'var(--foreground)/80' }}
              >
                {row.label}
                {row.note && (
                  <em className="ml-1 not-italic text-muted-foreground/60">
                    {row.note}
                  </em>
                )}
              </span>
              {/* bar */}
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full"
                style={{ background: 'var(--border)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: isTop
                      ? 'linear-gradient(90deg, #247d4b, rgba(36,125,75,.45))'
                      : 'linear-gradient(90deg, rgba(var(--foreground-raw,100,100,100),.45), rgba(var(--foreground-raw,100,100,100),.25))',
                  }}
                />
              </div>
              {/* value */}
              <span
                className="shrink-0 tabular-nums"
                style={{
                  fontFamily: 'var(--font-inst)',
                  fontSize: '11px',
                  color: isTop ? '#247d4b' : 'var(--muted-foreground)',
                }}
              >
                {row.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Markdown block ──────────────────────────────────────────────────────────

function MarkdownBlock({
  block,
}: {
  block: Extract<ViewBlock, { kind: 'markdown' }>;
}): React.ReactElement {
  const src = block.source;
  const text = 'inline' in src ? src.inline : '';

  const html = useMemo(() => renderMarkdown(text), [text]);

  return (
    <div
      className="rounded-lg border border-border bg-card p-4"
      style={{ boxShadow: 'inset 0 1px 0 var(--raise, rgba(255,255,255,0.06))' }}
    >
      <div
        className="prose prose-sm max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
