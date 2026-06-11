import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPeekablePath, extractPeekablePaths } from '../file-link.js';

describe('isPeekablePath', () => {
  it('returns true for a valid absolute path with known extension', () => {
    assert.equal(isPeekablePath('/Users/foo/bar/baz.ts'), true);
  });

  it('returns false when only 1 segment after root', () => {
    assert.equal(isPeekablePath('/foo.md'), false);
  });

  it('returns false for relative paths', () => {
    assert.equal(isPeekablePath('./relative/path.ts'), false);
  });

  it('returns false when no extension', () => {
    assert.equal(isPeekablePath('/foo/bar'), false);
  });

  it('returns false for unknown extensions', () => {
    assert.equal(isPeekablePath('/foo/bar.unknown'), false);
  });

  it('returns false for hidden files (dot as first char of filename)', () => {
    assert.equal(isPeekablePath('/foo/bar/.hidden'), false);
  });

  it('returns true for /Users/foo/roadmap.md', () => {
    assert.equal(isPeekablePath('/Users/foo/roadmap.md'), true);
  });
});

describe('extractPeekablePaths', () => {
  it('extracts a single peekable path from text', () => {
    const result = extractPeekablePaths('see /Users/foo/bar.ts for details');
    assert.deepEqual(result, ['/Users/foo/bar.ts']);
  });

  it('extracts json path but not path without extension', () => {
    const result = extractPeekablePaths('path: /home/x/a.json, other /tmp/z');
    assert.deepEqual(result, ['/home/x/a.json']);
  });

  it('deduplicates repeated paths', () => {
    const result = extractPeekablePaths('/Users/foo/bar.ts and /Users/foo/bar.ts again');
    assert.deepEqual(result, ['/Users/foo/bar.ts']);
  });

  it('returns empty array when no peekable paths found', () => {
    const result = extractPeekablePaths('no paths here at all');
    assert.deepEqual(result, []);
  });
});
