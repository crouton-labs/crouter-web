/**
 * The profile abstraction's data model (design §3.2). A profile is a named
 * bundle of three records — grants (what's allowed/present), terms (what we
 * call things), and a nav manifest — plus density + default theme. Components
 * never read the profile *name*; they read these derived axes via the hooks in
 * provider.tsx. Adding an audience adds a Profile record, never a component
 * branch (design §3.4 — the bend-not-break test).
 */

/** What an audience is allowed to see/do (design §3.2). Capabilities are the
 *  stable axis: a feature gates on a capability key once and ships to every
 *  profile that grants it. */
export type Capability =
  | 'canvas.view' // the diagnostic node graph
  | 'canvas.search' // search/filter/inspect over the canvas
  | 'node.internals' // chrome panel: branch/model/tokens/context/tools/stats, ids
  | 'node.arbitration' // controller/observer + request-control UI
  | 'node.spawn.raw' // full spawn params (kind/mode/cwd/model/parent)
  | 'node.lifecycle.raw' // revive resume/fresh, close, raw lifecycle labels
  | 'subnodes.visible' // show the child graph vs. summarize as activity
  | 'commands.palette' // the slash-command palette
  | 'session.trace' // raw engine-event / tool-arg inspector
  | 'diagnostics' // presence counts, broker banners, timings
  | 'views.author'; // create/edit views vs. only run them

/** Every machine term a consumer audience overrides. Operator speaks the raw
 *  vocabulary; Studio renders friendly words (or nothing, for terms like
 *  broker/controller/observer that consumers must never see). Copy NEVER
 *  hardcodes these words — it always resolves them through useTerm. */
export type TermKey =
  | 'node'
  | 'nodes'
  | 'spawn'
  | 'revive'
  | 'controller'
  | 'observer'
  | 'broker'
  | 'canvas'
  | 'headless'
  | 'steer'
  | 'compact'
  | 'close';

/** A primary-navigation entry (design §3.2 — the nav manifest). */
export interface NavItem {
  id: string;
  label: string;
  path: string;
}

export type ThemeMode = 'light' | 'dark';
export type Density = 'comfortable' | 'compact';

/** A named audience (design §3.2). The provider holds exactly one active
 *  Profile; it is the only place that knows `id`. */
export interface Profile {
  id: string;
  label: string;
  grants: Set<Capability>;
  terms: Record<TermKey, string>;
  nav: NavItem[];
  density: Density;
  defaultTheme: ThemeMode;
}
