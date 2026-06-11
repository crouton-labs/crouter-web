/**
 * Typed REST client over the bridge server's `/api/*` surface (spec §6.1).
 * Base paths are relative ('/api/...') — Vite proxies them in dev and the
 * server serves them in prod. Every action route returns either a success DTO
 * or an `ErrorEnvelope`; on a non-ok response we parse the envelope and throw a
 * typed `RestError` carrying `{code, message}`.
 */

import type {
  CanvasSnapshot,
  CloseResponse,
  Command,
  CommandsResponse,
  DeckDetail,
  DeckDetailResponse,
  DecksResponse,
  DeckSummary,
  ErrorEnvelope,
  MessageRequest,
  MessageResponse,
  NodeDetail,
  NodeDetailResponse,
  ResolveDeckRequest,
  ResolveDeckResponse,
  ReviveRequest,
  ReviveResponse,
  RestErrorCode,
  SpawnRequest,
  SpawnResponse,
} from '../../shared/protocol.js';

/** A REST failure carrying the server's structured error code + message. */
export class RestError extends Error {
  readonly code: RestErrorCode;
  constructor(code: RestErrorCode, message: string) {
    super(message);
    this.name = 'RestError';
    this.code = code;
  }
}

/** Parse an `ErrorEnvelope` body (best-effort) and throw a `RestError`. */
async function throwRestError(res: Response): Promise<never> {
  let code: RestErrorCode = 'bad_request';
  let message = `request failed (${res.status})`;
  try {
    const body = (await res.json()) as Partial<ErrorEnvelope>;
    if (body && body.error) {
      code = body.error.code;
      message = body.error.message;
    }
  } catch {
    // Non-JSON error body — keep the status-derived defaults.
  }
  throw new RestError(code, message);
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) await throwRestError(res);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) await throwRestError(res);
  return (await res.json()) as T;
}

/** `GET /api/canvas` — the canvas snapshot (poll fallback for the canvas WS). */
export function getCanvas(): Promise<CanvasSnapshot> {
  return getJson<CanvasSnapshot>('/api/canvas');
}

/** `GET /api/nodes/:id` — node identity + chrome (unwraps `{node}`). */
export async function getNode(id: string): Promise<NodeDetail> {
  const body = await getJson<NodeDetailResponse>(`/api/nodes/${encodeURIComponent(id)}`);
  return body.node;
}

/** `GET /api/nodes/:id/commands` — the slash-command inventory (unwraps `{commands}`). */
export async function getCommands(id: string): Promise<Command[]> {
  const body = await getJson<CommandsResponse>(
    `/api/nodes/${encodeURIComponent(id)}/commands`,
  );
  return body.commands;
}

/** `POST /api/nodes` — spawn a broker-hosted node. */
export function spawnNode(req: SpawnRequest): Promise<SpawnResponse> {
  return postJson<SpawnResponse>('/api/nodes', req);
}

/** `POST /api/nodes/:id/message` — deliver an inbox message (works on dormant nodes). */
export function messageNode(id: string, req: MessageRequest): Promise<MessageResponse> {
  return postJson<MessageResponse>(`/api/nodes/${encodeURIComponent(id)}/message`, req);
}

/** `POST /api/nodes/:id/revive` — bring a dormant node's broker back online. */
export function reviveNode(id: string, req: ReviveRequest = {}): Promise<ReviveResponse> {
  return postJson<ReviveResponse>(`/api/nodes/${encodeURIComponent(id)}/revive`, req);
}

/** `POST /api/nodes/:id/close` — pause the node without finishing it. */
export function closeNode(id: string): Promise<CloseResponse> {
  return postJson<CloseResponse>(`/api/nodes/${encodeURIComponent(id)}/close`);
}

/** `GET /api/decks` — pending asks across the canvas (unwraps `{decks}`). */
export async function getDecks(): Promise<DeckSummary[]> {
  const body = await getJson<DecksResponse>('/api/decks');
  return body.decks;
}

/** `GET /api/decks/:id` — the full deck for a resolution flow (unwraps `{deck}`). */
export async function getDeck(id: string): Promise<DeckDetail> {
  const body = await getJson<DeckDetailResponse>(`/api/decks/${encodeURIComponent(id)}`);
  return body.deck;
}

/** `POST /api/decks/:id/resolve` — write the human's answer back. */
export function resolveDeck(
  id: string,
  req: ResolveDeckRequest,
): Promise<ResolveDeckResponse> {
  return postJson<ResolveDeckResponse>(`/api/decks/${encodeURIComponent(id)}/resolve`, req);
}

export interface FilePeekResponse {
  path: string;
  content: string;
  truncated: boolean;
}

/** `GET /api/nodes/:id/file?path=<absolute>` — peek a text file inside the node's dirs. */
export function peekFile(nodeId: string, filePath: string): Promise<FilePeekResponse> {
  return getJson<FilePeekResponse>(
    `/api/nodes/${encodeURIComponent(nodeId)}/file?path=${encodeURIComponent(filePath)}`,
  );
}
