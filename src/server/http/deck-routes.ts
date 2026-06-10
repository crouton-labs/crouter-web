// Deck read + resolve routes (design §5.2, §5.6). Mounts:
//   GET  /api/decks              → DecksResponse (pending asks, oldest-first)
//   GET  /api/decks/:id          → DeckDetailResponse (404 deck_not_found)
//   POST /api/decks/:id/resolve  → ResolveDeckResponse, or 409 deck_already_resolved
// All deck logic lives in the injected DeckStore (decks/deck-store.ts) so this
// module is a thin HTTP adapter — same shape as canvas-routes.ts.

import type {
  DeckDetailResponse,
  DecksResponse,
  ResolveDeckRequest,
  ResolveDeckResponse,
} from "../../shared/protocol.js";
import type { DeckStore } from "../decks/deck-store.js";
import type { RouterLike } from "./canvas-routes.js";
import { readJsonBody, sendError, sendJson } from "./router.js";

export interface DeckRoutesDeps {
  store: DeckStore;
  now?: () => Date;
}

export function registerDeckRoutes(router: RouterLike, deps: DeckRoutesDeps): void {
  const now = deps.now ?? (() => new Date());

  router.get("/api/decks", (_req, res) => {
    const body: DecksResponse = {
      decks: deps.store.listDecks(),
      generated_at: now().toISOString(),
    };
    sendJson(res, 200, body);
  });

  router.get("/api/decks/:id", (_req, res, params) => {
    const deck = deps.store.getDeck(params.id!);
    if (!deck) {
      sendError(res, 404, "deck_not_found", `Unknown or already-handled deck: ${params.id}`);
      return;
    }
    const body: DeckDetailResponse = { deck };
    sendJson(res, 200, body);
  });

  router.post("/api/decks/:id/resolve", async (req, res, params) => {
    let body: ResolveDeckRequest;
    try {
      body = await readJsonBody<ResolveDeckRequest>(req);
    } catch {
      sendError(res, 400, "bad_request", "Malformed JSON body");
      return;
    }
    if (!body || !Array.isArray(body.responses)) {
      sendError(res, 400, "bad_request", "Missing required field: responses[]");
      return;
    }
    try {
      const outcome = deps.store.resolveDeck(params.id!, body.responses);
      if (outcome === "not_found") {
        sendError(res, 404, "deck_not_found", `Unknown deck: ${params.id}`);
        return;
      }
      if (outcome === "already_resolved") {
        sendError(res, 409, "deck_already_resolved", "This ask was already handled elsewhere");
        return;
      }
      const out: ResolveDeckResponse = { ok: true };
      sendJson(res, 200, out);
    } catch (err) {
      sendError(res, 500, "resolve_failed", err instanceof Error ? err.message : String(err));
    }
  });
}
