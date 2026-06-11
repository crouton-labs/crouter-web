/**
 * The Operator left dock (Quiet Instrument "Dock (Sidebar)" surface). The
 * expanded 228px navigation column shown on the Canvas/Views routes: brand
 * glyph, the profile's nav manifest as links (inbox blocked-count in ember), a
 * dynamic "Views" section when `views.host` is granted, then a footer with the
 * profile switcher. Its collapsed twin is `OperatorRail` (the node-console
 * route). Both are profile-name-blind — they render the nav manifest + view
 * list, never branch on which audience is active.
 */

import { Link, NavLink, useNavigate } from 'react-router-dom';
import type { NavItem } from '../profile/types.js';
import { cn } from '@/lib/utils.js';
import { useInboxCount } from '../lib/use-decks.js';
import { useCapability } from '../profile/provider.js';
import { useViews } from '../lib/use-views.js';
import { ProfileSwitcher } from './profile-switcher.js';

// ── Shared glyph vocabulary (consumed by the rail too) ───────────────────────

/** Monospace glyph for a static nav entry, keyed by manifest id. */
const NAV_ICONS: Record<string, string> = {
  canvas: '◫',
  conversations: '▤',
  inbox: '⌗',
  views: '◍',
  settings: '⚙',
};

const VIEW_GLYPHS = ['◍', '◔', '◇', '◌', '◎'];

export function navIcon(id: string): string {
  return NAV_ICONS[id] ?? '◇';
}

export function viewGlyph(i: number): string {
  return VIEW_GLYPHS[i % VIEW_GLYPHS.length] ?? '◍';
}

/** A dock link's class set. Active state mirrors the mockup's `.dock a.on`. */
function linkClass(isActive: boolean): string {
  return cn(
    'flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium no-underline transition-all',
    isActive
      ? '[color:var(--ink)] [background:rgba(232,228,216,.06)] [border:1px_solid_var(--line)] [box-shadow:inset_0_1px_0_var(--raise)]'
      : 'border border-transparent [color:var(--ink2)] hover:[color:var(--ink)] hover:[background:rgba(232,228,216,.04)]',
  );
}

const IC = 'w-[15px] flex-none text-center text-[13px] opacity-75';

export function OperatorDock({ nav, home }: { nav: NavItem[]; home: string }) {
  const hasViewsHost = useCapability('views.host');
  const { views } = useViews();
  const navigate = useNavigate();

  // When views.host is granted, the static 'views' stub is replaced by the
  // dynamic section below — hide the stub link.
  const staticNav = hasViewsHost ? nav.filter((item) => item.id !== 'views') : nav;

  return (
    <aside
      aria-label="Primary"
      className="flex w-[228px] flex-none flex-col gap-0.5 px-3 py-[18px] [border-right:1px_solid_var(--line)] [background:linear-gradient(180deg,rgba(20,19,16,.6),rgba(20,19,16,.2))]"
    >
      <Link
        to={home}
        className="flex items-center gap-[9px] px-2.5 pt-1 pb-4 text-[16px] font-medium tracking-[.01em] no-underline [color:var(--ink)] [font-family:var(--font-display)]"
      >
        <span className="flex size-[22px] flex-none items-center justify-center rounded-md text-[10px] font-bold [background:var(--bone)] [color:var(--bone-ink)] [font-family:var(--font-inst)]">
          cr
        </span>
        crouter
      </Link>

      {staticNav.map((item) => (
        <NavLink
          key={item.id}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) => linkClass(isActive)}
        >
          <span className={IC}>{navIcon(item.id)}</span>
          <span>{item.label}</span>
          {item.id === 'inbox' && <DockInboxCount />}
        </NavLink>
      ))}

      {hasViewsHost && (
        <>
          <div className="instlabel px-2.5 pt-3.5 pb-1.5">Views</div>
          {views.map((view, i) => (
            <NavLink
              key={view.id}
              to={`/views/${encodeURIComponent(view.id)}`}
              className={({ isActive }) => linkClass(isActive)}
            >
              <span className={IC}>{viewGlyph(i)}</span>
              <span className="truncate">{view.title}</span>
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => navigate('/views')}
            className="flex items-center gap-2.5 rounded-lg border border-transparent bg-transparent px-2.5 py-[7px] text-[13px] font-medium transition-all [color:var(--dim)] hover:[color:var(--ink)]"
          >
            <span className={IC}>+</span>
            <span>New view</span>
          </button>
        </>
      )}

      <div className="flex-1" />

      <div className="mt-2.5 pt-2.5 [border-top:1px_solid_var(--line)]">
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="flex items-center gap-2.5 text-[13px] font-medium [color:var(--ink2)]">
            <span className={IC}>◉</span> silas
          </span>
          <span className="kbd">⌘K</span>
        </div>
        <div className="px-1 pt-2">
          <ProfileSwitcher />
        </div>
      </div>
    </aside>
  );
}

/** The inbox pending-ask count, rendered as the ember `.count` pill. Hidden at
 *  zero (the badge disappears at inbox-zero, never shows '0'). */
function DockInboxCount() {
  const count = useInboxCount();
  if (count <= 0) return null;
  return (
    <span className="ml-auto rounded-full border px-[7px] py-[1.5px] text-[9px] font-semibold [font-family:var(--font-inst)] [color:#ff8260] [background:var(--blk-dim)] [border-color:rgba(255,94,54,.35)]">
      {count}
    </span>
  );
}
