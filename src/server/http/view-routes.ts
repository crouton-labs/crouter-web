// View read routes (spec §6.1, design §7).
//   GET /api/views       → ViewsResponse (all manifests, no markdown inlining)
//   GET /api/views/:id   → ViewDetailResponse (with markdown inlining)

import type { ViewDetailResponse, ViewManifest, ViewsResponse } from '../../shared/protocol.js';
import type { RouterLike } from './canvas-routes.js';
import { sendError, sendJson } from './router.js';

export interface ViewRoutesDeps {
  listViews(): Promise<ViewManifest[]>;
  getView(id: string): Promise<ViewManifest | null>;
  inlineMarkdownSources(view: ViewManifest): Promise<ViewManifest>;
}

export function registerViewRoutes(router: RouterLike, deps: ViewRoutesDeps): void {
  router.get('/api/views', async (_req, res) => {
    const views = await deps.listViews();
    const body: ViewsResponse = { views };
    sendJson(res, 200, body);
  });

  router.get('/api/views/:id', async (_req, res, params) => {
    const id = params.id!;
    const view = await deps.getView(id);
    if (!view) {
      sendError(res, 404, 'node_not_found', `Unknown view: ${id}`);
      return;
    }
    const inlined = await deps.inlineMarkdownSources(view);
    const body: ViewDetailResponse = { view: inlined };
    sendJson(res, 200, body);
  });
}
