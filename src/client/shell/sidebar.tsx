/**
 * Studio's persistent left navigation (design §5.1). Renders the active
 * profile's `nav` manifest as links — the shell never hardcodes which entries
 * exist; adding/removing a destination is a manifest edit, not a component
 * change. Highlights the active route with the single cyan accent.
 */

import { NavLink } from 'react-router-dom';
import type { NavItem } from '../profile/types.js';
import { cn } from '@/lib/utils.js';

export function Sidebar({ nav }: { nav: NavItem[] }) {
  return (
    <nav
      aria-label="Primary"
      className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-card/40 px-3 py-4"
    >
      {nav.map((item) => (
        <NavLink
          key={item.id}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) =>
            cn(
              'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-foreground/70 hover:bg-accent hover:text-foreground',
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
