/**
 * The SOLE module that imports `@crouton-kit/humanloop` (mirrors crouter-lib.ts).
 *
 * The DeckStore takes these as injected seams; serve.ts fills them from here.
 * Isolating the dependency to one file keeps the store mockable in tests and
 * confines a humanloop API change to a single seam. crouter-web reuses
 * humanloop's deck file protocol verbatim — it never reinvents deck.json /
 * response.json shapes or the claim/resolve detection.
 */

export {
  scanInbox,
  readJson,
  deckPath,
  writeResponse,
  isResolved,
  isClaimed,
} from "@crouton-kit/humanloop";
