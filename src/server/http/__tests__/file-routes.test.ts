import assert from "node:assert/strict";
import { test } from "node:test";
import { isContained } from "../file-routes.js";

test("isContained: exact match on dir", () => {
  assert.equal(isContained("/a/b", "/a/b"), true);
});

test("isContained: child of dir", () => {
  assert.equal(isContained("/a/b/c/file.ts", "/a/b"), true);
});

test("isContained: prefix match that is not a child (path traversal guard)", () => {
  // /a/bc should NOT be contained in /a/b
  assert.equal(isContained("/a/bc/file.ts", "/a/b"), false);
});

test("isContained: sibling dir not contained", () => {
  assert.equal(isContained("/a/other/file.ts", "/a/b"), false);
});

test("isContained: matches second allowed dir", () => {
  assert.equal(isContained("/cwd/src/foo.ts", "/node-home", "/cwd"), true);
});

test("isContained: trailing slash on dir handled correctly", () => {
  assert.equal(isContained("/a/b/file.ts", "/a/b/"), true);
});

test("isContained: empty allowed dirs → false", () => {
  assert.equal(isContained("/a/b/c"), false);
});

test("isContained: root path not contained in subdir", () => {
  assert.equal(isContained("/", "/a/b"), false);
});
