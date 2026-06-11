/**
 * The application shell — the one place that turns a profile's composition axes
 * (nav manifest + density) into a layout. A comfortable-density profile (Studio)
 * gets a persistent left sidebar of its nav; a compact one (Operator) keeps its
 * page-owned top-chrome with the shell adding only the always-present header
 * switcher. This is the single sanctioned layout chooser the brief permits to
 * read density — every page/panel below stays profile-name-blind, driven by
 * capability/term/nav.
 *
 * When `views.host` is granted AND density is comfortable, the Studio views-first
 * top bar replaces the standard header: brand + view tabs in center + right icons.
 * Gated on capability, never profile name (design §3.4).
 */

import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useProfile, useCapability } from '../profile/provider.js';
import { Sidebar, NavInboxBadge } from './sidebar.js';
import { ProfileSwitcher } from './profile-switcher.js';
import { useViews } from '../lib/use-views.js';
import { useInboxCount } from '../lib/use-decks.js';
import { cn } from '@/lib/utils.js';

export function AppShell({ children }: { children: ReactNode }) {
  const profile = useProfile();
  const isViewsHost = useCapability('views.host');
  // Layout chooser (the one permitted density read): comfortable → sidebar app
  // shell; compact → the page keeps its own top-chrome.
  const sidebarLayout = profile.density === 'comfortable';
  // Views-first Studio bar: views.host granted + comfortable (Studio audience).
  const studioBar = isViewsHost && sidebarLayout;
  const home = profile.nav[0]?.path ?? '/';

  if (studioBar) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <StudioTopBar home={home} />
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/40 px-3">
        <div className="flex min-w-0 items-center gap-4">
          <Link to={home} className="text-sm font-semibold tracking-tight text-foreground">
            crouter
          </Link>
          {/* A compact-density profile (Operator) has no sidebar, so the nav
              manifest renders inline in the header here. A comfortable one
              (Studio) gets the left Sidebar below and skips this. */}
          {!sidebarLayout && (
            <nav aria-label="Primary" className="flex items-center gap-1">
              {profile.nav.map((item) => (
                <NavLink
                  key={item.id}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground/60 hover:bg-accent hover:text-foreground',
                    )
                  }
                >
                  <span>{item.label}</span>
                  {item.id === 'inbox' && <NavInboxBadge />}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
        <ProfileSwitcher />
      </header>

      {sidebarLayout ? (
        <div className="flex min-h-0 flex-1">
          <Sidebar nav={profile.nav} />
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
      ) : (
        <div className="min-h-0 flex-1">{children}</div>
      )}
    </div>
  );
}

// ─── Studio views-first top bar ───────────────────────────────────────────────

function StudioTopBar({ home }: { home: string }) {
  const { views } = useViews();
  const inboxCount = useInboxCount();
  const navigate = useNavigate();

  return (
    <header
      className="flex h-[52px] shrink-0 items-center gap-0 border-b px-9"
      style={{ borderColor: 'rgba(40,36,26,.1)', background: 'var(--card)' }}
    >
      {/* brand */}
      <Link to={home} className="flex items-center gap-2 shrink-0">
        <span
          className="flex size-[22px] items-center justify-center rounded-md text-[10px] font-bold"
          style={{
            fontFamily: 'var(--font-inst)',
            background: 'var(--foreground)',
            color: 'var(--background)',
          }}
        >
          cr
        </span>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            fontSize: '17px',
            color: 'var(--foreground)',
          }}
        >
          crouter
        </span>
      </Link>

      {/* view tabs */}
      <div className="ml-3.5 flex items-center gap-1 overflow-x-auto">
        {views.map((view) => (
          <NavLink
            key={view.id}
            to={`/views/${encodeURIComponent(view.id)}`}
            className={({ isActive }) =>
              cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 py-[7px] text-[13.5px] font-medium transition-colors',
                isActive
                  ? 'border-border/50 bg-background text-foreground shadow-sm'
                  : 'border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground',
              )
            }
            style={({ isActive }) =>
              isActive
                ? { boxShadow: '0 6px 16px -10px rgba(60,50,30,.5), inset 0 1px 0 rgba(255,255,255,.9)' }
                : {}
            }
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{
                background: view.status === 'active'
                  ? '#247d4b'
                  : 'var(--muted-foreground)',
                opacity: view.status === 'active' ? 1 : 0.5,
                animation: view.status === 'active' ? 'pulse-active 2.4s ease-out infinite' : undefined,
              }}
            />
            {view.title}
          </NavLink>
        ))}

        {/* + new chat tab */}
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex shrink-0 items-center rounded-lg border border-transparent px-3 py-[7px] text-[15px] text-muted-foreground/50 transition-colors hover:text-foreground"
          title="New chat"
          aria-label="New chat"
        >
          ＋
        </button>
      </div>

      {/* right actions */}
      <div className="ml-auto flex items-center gap-2">
        {/* Chats */}
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex size-[34px] items-center justify-center rounded-lg border text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          style={{ borderColor: 'rgba(40,36,26,.1)', background: 'rgba(255,255,255,.4)' }}
          title="Chats"
          aria-label="Chats"
        >
          💬
        </button>

        {/* Inbox with badge */}
        <button
          type="button"
          onClick={() => navigate('/inbox')}
          className="relative flex size-[34px] items-center justify-center rounded-lg border text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          style={{ borderColor: 'rgba(40,36,26,.1)', background: 'rgba(255,255,255,.4)' }}
          title="Inbox"
          aria-label="Inbox"
        >
          ⌗
          {inboxCount > 0 && (
            <span
              className="absolute -right-1 -top-1 rounded-full bg-destructive px-1 text-[8px] font-bold text-white"
              style={{ fontFamily: 'var(--font-inst)', minWidth: '14px', lineHeight: '14px' }}
            >
              {inboxCount}
            </span>
          )}
        </button>

        {/* Profile placeholder */}
        <div
          className="size-[30px] shrink-0 rounded-full border-2 border-white"
          style={{
            background: 'linear-gradient(135deg,#d8b97a,#b08b4a)',
            boxShadow: '0 2px 8px rgba(60,50,30,.25)',
          }}
        />
      </div>
    </header>
  );
}
