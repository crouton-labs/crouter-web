/**
 * Server-side inbox tagging — wraps the shared detection helpers with the
 * `tagInboxMessages` batch-tagger used at fold time in NodeSessionHub.
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { FoldedMessage } from '../../shared/protocol.js';
export { isInboxDigest, extractInboxSender } from '../../shared/inbox-detect.js';
import { isInboxDigest } from '../../shared/inbox-detect.js';

/** Extract the text content from a user AgentMessage (string or block array). */
function userText(message: AgentMessage): string | null {
  if (message.role !== 'user') return null;
  const content = (message as { content: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content as Array<{ type: string; text?: string }>) {
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    }
    return parts.join('') || null;
  }
  return null;
}

/**
 * Tag an array of `AgentMessage` items with `origin:'inbox'` where the message
 * content matches the coalesce() digest format injected by canvas-inbox-watcher.
 *
 * Returns a new array (same references for untagged messages; new objects only
 * for tagged ones).  Never mutates input.
 */
export function tagInboxMessages(messages: AgentMessage[]): FoldedMessage[] {
  return messages.map((m): FoldedMessage => {
    const text = userText(m);
    if (text !== null && isInboxDigest(text)) {
      return { ...m, origin: 'inbox' } as FoldedMessage;
    }
    return m as FoldedMessage;
  });
}
