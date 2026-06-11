/**
 * Regression tests for inbox-origin detection (tagInboxMessages / isInboxDigest).
 *
 * The detection contract: `coalesce()` in crouter/src/core/feed/inbox.ts produces
 * digests with the header `From <sender> — N update(s):` where <sender> is a
 * node-id (`[a-z0-9]+-[a-f0-9]+`), `system`, or `human`.  These are the only
 * user messages that should be tagged `origin:'inbox'`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isInboxDigest, extractInboxSender } from '../../../shared/inbox-detect.js';
import { tagInboxMessages } from '../inbox-detect.js';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

// ---------------------------------------------------------------------------
// isInboxDigest
// ---------------------------------------------------------------------------

test('matches a single-sender coalesce digest', () => {
  const digest = 'From mq8ijg1r-8763272f — 1 update:\n  [final] Espresso findings  (ref: /path/to/report.md)';
  assert.ok(isInboxDigest(digest));
});

test('matches a multi-update coalesce digest', () => {
  const digest = 'From mq5ktk7o-f48d32b3 — 3 updates:\n  [update] Line 1\n  [final] Line 2';
  assert.ok(isInboxDigest(digest));
});

test('matches system sender (null from → "system")', () => {
  const digest = 'From system — 1 update:\n  [message] You were CANCELED';
  assert.ok(isInboxDigest(digest));
});

test('matches human sender', () => {
  const digest = 'From human — 1 update:\n  [message] CTO has manually taken over.';
  assert.ok(isInboxDigest(digest));
});

test('does not match a plain human prompt', () => {
  assert.ok(!isInboxDigest('What is the status of the build?'));
});

test('does not match assistant text', () => {
  assert.ok(!isInboxDigest('From what I can see, the build is green.'));
});

test('does not match partial / missing update count', () => {
  assert.ok(!isInboxDigest('From mq8ijg1r-8763272f — updates:'));
});

test('does not match uppercase FROM', () => {
  // coalesce() always uses lowercase 'From'
  assert.ok(!isInboxDigest('FROM mq8ijg1r-8763272f — 1 update:'));
});

// ---------------------------------------------------------------------------
// extractInboxSender
// ---------------------------------------------------------------------------

test('extracts node-id sender', () => {
  const digest = 'From mq8ijg1r-8763272f — 2 updates:\n  [update] something';
  assert.equal(extractInboxSender(digest), 'mq8ijg1r-8763272f');
});

test('extracts system sender', () => {
  assert.equal(extractInboxSender('From system — 1 update:\n  [message] x'), 'system');
});

test('returns null for non-digest', () => {
  assert.equal(extractInboxSender('Hello from the other side'), null);
});

// ---------------------------------------------------------------------------
// tagInboxMessages
// ---------------------------------------------------------------------------

function makeUser(content: string): AgentMessage {
  return { role: 'user', content } as unknown as AgentMessage;
}

function makeAssistant(text: string): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
  } as unknown as AgentMessage;
}

test('tags inbox-origin user messages', () => {
  const digest = 'From mq5ifnw2-60578d0f — 1 update:\n  [message] CTO clarification';
  const messages = [makeUser(digest)];
  const tagged = tagInboxMessages(messages);
  assert.equal(tagged.length, 1);
  assert.equal((tagged[0] as { origin?: string }).origin, 'inbox');
});

test('does not tag plain human user messages', () => {
  const messages = [makeUser('Please summarize the findings.')];
  const tagged = tagInboxMessages(messages);
  assert.equal((tagged[0] as { origin?: string }).origin, undefined);
});

test('does not tag assistant messages', () => {
  const messages = [makeAssistant('From mq8ijg1r-8763272f — 1 update:\n  [final] x')];
  const tagged = tagInboxMessages(messages);
  assert.equal((tagged[0] as { origin?: string }).origin, undefined);
});

test('preserves untagged message reference identity', () => {
  const msg = makeUser('hello');
  const messages = [msg];
  const tagged = tagInboxMessages(messages);
  assert.strictEqual(tagged[0], msg);
});

test('tags only inbox messages in a mixed history', () => {
  const inbox = makeUser('From mq5ifnw2-60578d0f — 1 update:\n  [final] Done');
  const human = makeUser('What next?');
  const assistant = makeAssistant('I will proceed.');
  const tagged = tagInboxMessages([inbox, human, assistant]);
  assert.equal((tagged[0] as { origin?: string }).origin, 'inbox');
  assert.equal((tagged[1] as { origin?: string }).origin, undefined);
  assert.equal((tagged[2] as { origin?: string }).origin, undefined);
});

test('handles block-content user messages', () => {
  const digest = 'From mq5ifnw2-60578d0f — 1 update:\n  [message] body';
  const msg: AgentMessage = {
    role: 'user',
    content: [{ type: 'text', text: digest }],
  } as unknown as AgentMessage;
  const tagged = tagInboxMessages([msg]);
  assert.equal((tagged[0] as { origin?: string }).origin, 'inbox');
});
