// DeckStore (design §1, §5.2, §5.6) — the server's read+resolve layer over
// humanloop "decks". It enumerates pending asks across the canvas, normalizes
// each to the web protocol (with conversation provenance walked off the spine),
// and resolves one by writing the human's answer back through humanloop's own
// file convention. It reinvents NOTHING about the deck protocol: scanning,
// reading, claim/resolve detection, and the write-back all come from
// @crouton-kit/humanloop (injected as seams so this unit stays mockable, the
// codebase's DI discipline). The only crouter convention replicated here is the
// per-cwd interactions path (crouter does not export it — see `defaultInteractionsRootFor`).

import { homedir } from "node:os";
import { join } from "node:path";
import type {
  DeckAnswer,
  DeckDetail,
  DeckInteraction,
  DeckKind,
  DeckSummary,
} from "../../shared/protocol.js";

// --- the slice of a node the store needs for provenance ---
export interface DeckNode {
  node_id: string;
  name: string;
  cwd: string;
  parent: string | null;
}

// --- the humanloop Deck shape the store reads (structural; avoids a hard type dep) ---
interface RawOption {
  id: string;
  label: string;
  description?: string;
}
interface RawInteraction {
  id: string;
  title: string;
  subtitle?: string;
  body?: string;
  options?: RawOption[];
  multiSelect?: boolean;
  allowFreetext?: boolean;
  freetextLabel?: string;
  kind?: string;
}
interface RawDeck {
  title?: string;
  source?: { nodeId?: string; blockedSince?: string };
  interactions: RawInteraction[];
}

/** One pending interaction dir as `scanInbox` reports it (header only). */
export interface ScannedItem {
  dir: string;
  blockedSince: string;
}

/** Injected humanloop + crouter seams (real impls wired in serve.ts; mocked in tests). */
export interface DeckStoreDeps {
  /** Canvas nodes (identity slice) — for cwd enumeration + spine provenance. */
  listNodes: () => DeckNode[];
  /** Per-cwd interactions dir. Defaults to the crouter convention. */
  interactionsRootFor?: (cwd: string) => string;
  /** humanloop `scanInbox` — pending (unresolved, unclaimed) dirs under roots. */
  scanInbox: (roots: string[]) => ScannedItem[];
  /** humanloop `readJson(deckPath(dir))` — the full deck, or null if gone/bad. */
  readDeck: (dir: string) => RawDeck | null;
  /** humanloop `isResolved` — response.json exists. */
  isResolved: (dir: string) => boolean;
  /** humanloop `isClaimed` — a live resolver owns the dir (fresh progress.json). */
  isClaimed: (dir: string) => boolean;
  /** humanloop `writeResponse` — atomically write response.json. */
  writeResponse: (dir: string, responses: DeckAnswer[], completedAt: string) => void;
  now?: () => Date;
}

/** The crouter per-cwd interactions convention (crouter/src/core/artifact.ts —
 *  not exported by the package, so replicated here): `~/.crouter/<cwd-with-
 *  slashes-as-dashes>/interactions/`. Uses homedir(), NOT CRTR_HOME. */
export function defaultInteractionsRootFor(cwd: string): string {
  return join(homedir(), ".crouter", cwd.replace(/\//g, "-"), "interactions");
}

/** Opaque, reversible deck id: base64url of the absolute interaction dir. */
export function encodeDeckId(dir: string): string {
  return Buffer.from(dir, "utf8").toString("base64url");
}
export function decodeDeckId(id: string): string {
  return Buffer.from(id, "base64url").toString("utf8");
}

/** humanloop has 6 kinds; the web renders 5. Normalize review/unknown/absent. */
export function normalizeKind(kind: string | undefined): DeckKind {
  switch (kind) {
    case "notify":
    case "validation":
    case "decision":
    case "context":
    case "error":
      return kind;
    case "review":
      return "decision";
    default:
      // No kind: a deck with options is a decision; pure freetext/none is context;
      // an empty no-options ack reads as a notify.
      return "decision";
  }
}

export class DeckStore {
  private readonly deps: DeckStoreDeps;
  private readonly rootFor: (cwd: string) => string;
  private readonly now: () => Date;

  constructor(deps: DeckStoreDeps) {
    this.deps = deps;
    this.rootFor = deps.interactionsRootFor ?? defaultInteractionsRootFor;
    this.now = deps.now ?? (() => new Date());
  }

  /** Every pending deck across the canvas, oldest-blocked first (design §5.2). */
  listDecks(): DeckSummary[] {
    const summaries: DeckSummary[] = [];
    for (const { dir, deck } of this.scanAll()) {
      const summary = this.summarize(dir, deck);
      if (summary) summaries.push(summary);
    }
    summaries.sort((a, b) =>
      a.blocked_since < b.blocked_since ? -1 : a.blocked_since > b.blocked_since ? 1 : 0,
    );
    return summaries;
  }

  /** The full deck for a resolution flow, or null if it's gone / handled elsewhere. */
  getDeck(id: string): DeckDetail | null {
    const dir = this.dirForId(id);
    if (dir === null) return null;
    // Resolved/claimed elsewhere reads as gone — the flow page self-clears.
    if (this.deps.isResolved(dir) || this.deps.isClaimed(dir)) return null;
    const deck = this.deps.readDeck(dir);
    if (deck === null) return null;
    const summary = this.summarize(dir, deck);
    if (summary === null) return null;
    return { ...summary, interactions: deck.interactions.map(toInteraction) };
  }

  /**
   * Write the human's answer back. Returns:
   *  - 'ok' on a successful write
   *  - 'not_found' if the id maps to no current pending deck
   *  - 'already_resolved' if it was resolved/claimed elsewhere (the soft 409 path)
   */
  resolveDeck(id: string, responses: DeckAnswer[]): "ok" | "not_found" | "already_resolved" {
    const dir = this.dirForId(id);
    if (dir === null) return "not_found";
    if (this.deps.isResolved(dir) || this.deps.isClaimed(dir)) return "already_resolved";
    this.deps.writeResponse(dir, responses, this.now().toISOString());
    return "ok";
  }

  // --- internals ---------------------------------------------------------

  /** Distinct cwds across the canvas, each scanned once for its pending dirs. */
  private scanAll(): { dir: string; deck: RawDeck }[] {
    const nodes = this.deps.listNodes();
    const seenCwd = new Set<string>();
    const out: { dir: string; deck: RawDeck }[] = [];
    for (const n of nodes) {
      if (seenCwd.has(n.cwd)) continue;
      seenCwd.add(n.cwd);
      let items: ScannedItem[];
      try {
        items = this.deps.scanInbox([this.rootFor(n.cwd)]);
      } catch {
        continue; // humanloop missing / no interactions dir — fine
      }
      for (const it of items) {
        const deck = this.deps.readDeck(it.dir);
        if (deck === null || deck.interactions.length === 0) continue;
        out.push({ dir: it.dir, deck });
      }
    }
    return out;
  }

  /**
   * Decode an opaque id to its interaction dir, but ONLY if that dir lives under
   * a known node's interactions root (the path-injection guard — prevents
   * writing response.json to an arbitrary client-supplied path). Deliberately
   * does NOT require the deck to still be pending: that lets resolveDeck/getDeck
   * distinguish 'already_resolved' from 'not_found' (scanInbox itself filters
   * resolved/claimed dirs out, so a pending-set check could never see them).
   */
  private dirForId(id: string): string | null {
    let dir: string;
    try {
      dir = decodeDeckId(id);
    } catch {
      return null;
    }
    if (dir === "" || dir.includes("\0")) return null;
    for (const n of this.deps.listNodes()) {
      const root = this.rootFor(n.cwd) + "/";
      if (dir.startsWith(root)) return dir;
    }
    return null;
  }

  /** Normalize a deck → list/summary row with spine provenance. */
  private summarize(dir: string, deck: RawDeck): DeckSummary | null {
    const first = deck.interactions[0];
    if (!first) return null;
    const nodes = this.deps.listNodes();
    const asking = this.resolveAskingNode(deck, dir, nodes);
    const conversation = this.resolveConversation(asking, nodes);
    return {
      id: encodeDeckId(dir),
      kind: normalizeKind(first.kind),
      title: deck.title ?? first.title,
      ...(first.subtitle ? { subtitle: first.subtitle } : {}),
      blocked_since: deck.source?.blockedSince ?? this.now().toISOString(),
      conversation_id: conversation.node_id,
      conversation_title: conversation.name,
      asking_node_id: asking.node_id,
      asking_node_name: asking.name,
      cwd: asking.cwd,
      interaction_count: deck.interactions.length,
    };
  }

  /** The node that raised the ask: prefer deck.source.nodeId, else the node
   *  owning the interaction dir's cwd. */
  private resolveAskingNode(deck: RawDeck, dir: string, nodes: DeckNode[]): DeckNode {
    const stampedId = deck.source?.nodeId;
    if (stampedId) {
      const byId = nodes.find((n) => n.node_id === stampedId);
      if (byId) return byId;
    }
    // Fall back to the node whose interactions root contains this dir.
    const byCwd = nodes.find((n) => dir.startsWith(this.rootFor(n.cwd)));
    if (byCwd) return byCwd;
    // Last resort: a synthetic node so a deck never vanishes from the list.
    return { node_id: stampedId ?? "unknown", name: "an agent", cwd: "", parent: null };
  }

  /** Walk the spine to the root (the conversation), cycle-safe. */
  private resolveConversation(asking: DeckNode, nodes: DeckNode[]): DeckNode {
    const byId = new Map(nodes.map((n) => [n.node_id, n]));
    let cur = asking;
    const seen = new Set<string>();
    while (cur.parent && !seen.has(cur.node_id)) {
      seen.add(cur.node_id);
      const parent = byId.get(cur.parent);
      if (!parent) break;
      cur = parent;
    }
    return cur;
  }
}

function toInteraction(raw: RawInteraction): DeckInteraction {
  return {
    id: raw.id,
    title: raw.title,
    ...(raw.subtitle ? { subtitle: raw.subtitle } : {}),
    ...(raw.body ? { body: raw.body } : {}),
    kind: normalizeKind(raw.kind),
    options: (raw.options ?? []).map((o) => ({
      id: o.id,
      label: o.label,
      ...(o.description ? { description: o.description } : {}),
    })),
    multiSelect: raw.multiSelect ?? false,
    allowFreetext: raw.allowFreetext ?? false,
    ...(raw.freetextLabel ? { freetextLabel: raw.freetextLabel } : {}),
  };
}
