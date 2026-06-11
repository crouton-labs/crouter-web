#!/usr/bin/env tsx
// Seed a demo view manifest for local development and testing.
// Usage: npx tsx scripts/seed-demo-view.ts
// Writes to $CRTR_HOME/views/espresso-research.json
// (default: ~/.crouter/canvas/views/espresso-research.json)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ViewManifest } from '../src/shared/protocol.js';

function crtrHome(): string {
  return process.env['CRTR_HOME'] ?? join(homedir(), '.crouter', 'canvas');
}

const viewsDir = join(crtrHome(), 'views');
mkdirSync(viewsDir, { recursive: true });

const manifest: ViewManifest = {
  id: 'espresso-research',
  title: 'Espresso research',
  built_by: null,
  updated_at: new Date().toISOString(),
  tabs: [
    {
      id: 'overview',
      label: 'Overview',
      blocks: [
        {
          kind: 'kpis',
          items: [
            { label: 'machines compared', value: '14', sub: 'across 6 review sources' },
            { label: 'top pick', value: 'Bambino Plus', sub: 'best temp stability under $600' },
            { label: 'sweet spot', value: '$450–600', sub: 'diminishing returns above' },
            { label: 'budget floor', value: '$299', sub: 'below this, thermoblock drift' },
          ],
        },
        {
          kind: 'barlist',
          title: 'Cupping score vs. price',
          rows: [
            { label: 'Bambino Plus $549', value: 9.2, max: 10, note: 'top pick' },
            { label: 'Gaggia Classic Evo $479', value: 8.7, max: 10 },
            { label: 'Rancilio Silvia $865', value: 8.5, max: 10 },
            { label: 'Lelit Anna PL41 $699', value: 8.1, max: 10 },
            { label: 'Café Affetto $579', value: 6.8, max: 10 },
            { label: 'Barista Express $699', value: 6.1, max: 10 },
          ],
        },
        {
          kind: 'markdown',
          source: {
            inline: `## Findings

1. **Sweet spot is $450–600.** Below that, thermoblock temperature instability; above it, diminishing returns for home use.
2. **Grinder matters more than machine.** A $549 machine with a $300 grinder beat a $1,200 machine with a blade grinder in every cupping note.
3. **Skip built-in grinders.** Every all-in-one tested clogged or drifted within 6 weeks of daily use.`,
          },
        },
      ],
    },
    {
      id: 'sources',
      label: 'Sources',
      blocks: [
        {
          kind: 'markdown',
          source: {
            inline: `## Sources

*Placeholder — sources tab seeded for demo purposes.*

- Wirecutter espresso machine guide (2025)
- Coffeegeek.com community reviews
- Home-Barista.com forum threads
- YouTube channel "James Hoffmann" — espresso shootout
- r/espresso survey data
- Manufacturer spec sheets`,
          },
        },
      ],
    },
  ],
};

const dest = join(viewsDir, 'espresso-research.json');
writeFileSync(dest, JSON.stringify(manifest, null, 2), 'utf8');
process.stdout.write(`seeded demo view → ${dest}\n`);
