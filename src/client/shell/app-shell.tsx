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
import { Link } from 'react-router-dom';
import { useProfile } from '../profile/provider.js';
import { Sidebar } from './sidebar.js';
import { ProfileSwitcher } from './profile-switcher.js';

export function AppShell({ children }: { children: ReactNode }) {
  const profile = useProfile();
  // Layout chooser (the one permitted density read): comfortable → sidebar app
  // shell; compact → the page keeps its own top-chrome.
  const sidebarLayout = profile.density === 'comfortable';
  const home = profile.nav[0]?.path ?? '/';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/40 px-3">
        <Link to={home} className="text-sm font-semibold tracking-tight text-foreground">
          crouter
        </Link>
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
