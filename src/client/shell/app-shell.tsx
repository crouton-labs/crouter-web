/**
 * The application shell — the one place that turns a profile's composition axes
 * (nav manifest + density) into a layout. A comfortable-density profile (Studio)
 * gets a persistent left sidebar of its nav; a compact one (Operator) keeps its
 * page-owned top-chrome with the shell adding only the always-present header
 * switcher. This is the single sanctioned layout chooser the brief permits to
 * read density — every page/panel below stays profile-name-blind, driven by
 * capability/term/nav.
 */

import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useProfile } from '../profile/provider.js';
import { Sidebar, NavInboxBadge } from './sidebar.js';
import { ProfileSwitcher } from './profile-switcher.js';
import { cn } from '@/lib/utils.js';

export function AppShell({ children }: { children: ReactNode }) {
  const profile = useProfile();
  // Layout chooser (the one permitted density read): comfortable → sidebar app
  // shell; compact → the page keeps its own top-chrome.
  const sidebarLayout = profile.density === 'comfortable';
  const home = profile.nav[0]?.path ?? '/';

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
