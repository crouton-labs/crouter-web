/**
 * Settings — deliberately quiet (design §4.4). Profile switch, theme toggle,
 * and room for future prefs. Minimal by design; the profile switch is the same
 * control as the header, surfaced here too for discoverability.
 */

import { useState } from 'react';
import { ProfileSwitcher } from '../shell/profile-switcher.js';
import { Button } from '@/components/ui/button.js';

export function SettingsPage() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  const toggleTheme = (): void => {
    const el = document.documentElement;
    const next = !el.classList.contains('dark');
    el.classList.toggle('dark', next);
    el.classList.toggle('light', !next);
    setDark(next);
  };

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-2xl flex-col gap-8 overflow-auto px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Profile</h2>
        <p className="text-sm text-muted-foreground">
          Choose the experience. You can also switch from the header at any time.
        </p>
        <ProfileSwitcher />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Appearance</h2>
        <p className="text-sm text-muted-foreground">
          {dark ? 'Dark theme' : 'Light theme'} is active.
        </p>
        <Button variant="outline" onClick={toggleTheme}>
          Switch to {dark ? 'light' : 'dark'}
        </Button>
      </section>
    </div>
  );
}
