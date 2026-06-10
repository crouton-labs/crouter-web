import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * The normalized view of a dormant node's pi session — structurally identical to
 * what the live broker `WelcomeFrame` snapshot delivers.
 *
 * `history` is pi's resolved `AgentMessage[]` for the active leaf path (compaction
 * summaries applied, model/thinking changes folded). `model` is the active model id
 * (matching the bare-modelId convention of `telemetry.json`), `thinkingLevel` pi's
 * thinking-level string (e.g. `"off"`/`"low"`/`"medium"`/`"high"`).
 */
export interface NormalizedDormantSession {
  history: AgentMessage[];
  model: string | null;
  thinkingLevel: string | null;
}

/**
 * Thrown when the session file cannot be read (missing, not a file, unreadable) or
 * pi's `SessionManager` rejects it. The original cause is attached for diagnostics.
 */
export class DormantSessionError extends Error {
  override readonly name = "DormantSessionError";
  constructor(
    message: string,
    readonly sessionFilePath: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * Parse a dormant node's pi session JSONL into the same `AgentMessage[]` the live
 * broker snapshot delivers, by reusing pi's own `SessionManager` (decision D2) — never
 * a hand-rolled tree walk.
 *
 * Critical isolation constraint: `SessionManager.open()` migrates and **rewrites**
 * pre-v3 session files in place. The node's live `.jsonl` must therefore never be
 * opened directly. This function copies the file into a private temp directory, opens
 * the copy, builds the session context, and discards the copy — leaving the node's own
 * session file byte-for-byte untouched.
 *
 * @param sessionFilePath Absolute path to the node's pi session `.jsonl`
 *   (resolved by the caller from `session.ptr`).
 * @throws {DormantSessionError} if the file is missing/unreadable or parsing fails.
 */
export async function normalizeDormantSession(
  sessionFilePath: string,
): Promise<NormalizedDormantSession> {
  let info;
  try {
    info = await stat(sessionFilePath);
  } catch (cause) {
    throw new DormantSessionError(
      `Session file not found or unreadable: ${sessionFilePath}`,
      sessionFilePath,
      { cause },
    );
  }
  if (!info.isFile()) {
    throw new DormantSessionError(
      `Session path is not a regular file: ${sessionFilePath}`,
      sessionFilePath,
    );
  }

  // Private temp dir so SessionManager.open()'s in-place migration/rewrite only ever
  // touches our throwaway copy, never the node's live session file.
  const tempDir = await mkdtemp(join(tmpdir(), "crtr-web-session-"));
  const tempFile = join(tempDir, basename(sessionFilePath) || "session.jsonl");
  try {
    await copyFile(sessionFilePath, tempFile);

    let context;
    try {
      // Both open() and buildSessionContext() are synchronous in pi.
      const manager = SessionManager.open(tempFile);
      context = manager.buildSessionContext();
    } catch (cause) {
      throw new DormantSessionError(
        `Failed to parse pi session file: ${sessionFilePath}`,
        sessionFilePath,
        { cause },
      );
    }

    return {
      history: context.messages,
      model: context.model ? context.model.modelId : null,
      thinkingLevel: context.thinkingLevel ?? null,
    };
  } finally {
    // Always discard the temp copy, even on throw.
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
