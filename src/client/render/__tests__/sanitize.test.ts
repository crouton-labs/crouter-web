/**
 * XSS-inertness tests for the untrusted-content boundary (spec C.8 / AC-22).
 *
 * Both rendering paths are exercised: `renderMarkdown` (model/assistant text)
 * and `sanitizeHtml` (raw tool output assigned to innerHTML). Every fixture
 * asserts the output is INERT — no `<script>`, no `on*=` handler attribute, no
 * `javascript:`/`vbscript:` URI, no `<iframe>`/`<object>`.
 *
 * DOMPurify needs a DOM. We inject a jsdom `window` onto `globalThis` BEFORE
 * importing the render layer, which binds DOMPurify lazily on first use. In the
 * browser the global `window` is already present, so no shim runs there.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Install a DOM before the render layer binds DOMPurify (lazy, first-call).
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
(globalThis as unknown as { window: unknown }).window = window;

// Imported AFTER the window is in place.
const { sanitizeHtml, escapeText } = await import('../sanitize.js');
const { renderMarkdown, renderCodeBlock } = await import('../markdown.js');

const DANGEROUS_TAGS = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'FRAME', 'FRAMESET']);
const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'data', 'xlink:href', 'srcdoc', 'background'];

/**
 * Assert a rendered HTML string carries no executable surface — by PARSING it
 * into a DOM and inspecting real elements/attributes, not fuzzy substring
 * matching (escaped text like `&lt;img onerror=…&gt;` is inert and must pass).
 */
function assertInert(html: string, label: string): void {
  // Literal `<script>` markup never survives sanitization (only escaped text
  // may remain) — a cheap structural smoke check before the DOM walk.
  assert.ok(!/<script[\s>]/i.test(html), `${label}: literal <script> survived`);
  assert.ok(!/<iframe[\s>]/i.test(html), `${label}: literal <iframe> survived`);

  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const all: any[] = Array.from(dom.window.document.body.querySelectorAll('*'));
  for (const el of all) {
    assert.ok(!DANGEROUS_TAGS.has(el.tagName), `${label}: live <${el.tagName.toLowerCase()}> element`);
    for (const attr of Array.from(el.attributes) as any[]) {
      const name = attr.name.toLowerCase();
      assert.ok(!name.startsWith('on'), `${label}: handler attribute ${name} on <${el.tagName.toLowerCase()}>`);
      if (URL_ATTRS.includes(name)) {
        const v = attr.value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
        assert.ok(!v.startsWith('javascript:'), `${label}: javascript: in ${name}`);
        assert.ok(!v.startsWith('vbscript:'), `${label}: vbscript: in ${name}`);
        assert.ok(!v.startsWith('data:text/html'), `${label}: data:text/html in ${name}`);
      }
    }
  }
}

const RAW_XSS_FIXTURES: Array<[string, string]> = [
  ['script tag', '<script>alert(1)</script>'],
  ['img onerror', '<img src=x onerror=alert(1)>'],
  ['svg onload', '<svg onload=alert(1)></svg>'],
  ['body onload', '<body onload=alert(1)>hi</body>'],
  ['anchor javascript href', '<a href="javascript:alert(1)">click</a>'],
  ['iframe', '<iframe src="javascript:alert(1)"></iframe>'],
  ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ['object data', '<object data="javascript:alert(1)"></object>'],
  ['embed', '<embed src="data:text/html,<script>alert(1)</script>">'],
  ['onmouseover div', '<div onmouseover="alert(1)">x</div>'],
  ['form action', '<form action="javascript:alert(1)"><input></form>'],
  ['style expression', '<div style="background:url(javascript:alert(1))">x</div>'],
  ['nested malformed', '<img src=x onerror="alert(1)"//>'],
];

const MARKDOWN_XSS_FIXTURES: Array<[string, string]> = [
  ['md script', 'hello\n\n<script>alert(1)</script>\n\nbye'],
  ['md img onerror', '![x](x"onerror="alert(1))\n\n<img src=x onerror=alert(1)>'],
  ['md javascript link', '[click](javascript:alert(1))'],
  ['md raw anchor', 'text <a href="javascript:alert(1)">x</a> more'],
  ['md iframe', '<iframe src="javascript:alert(1)"></iframe>'],
  ['md html onload', '<div onload="alert(1)">content</div>'],
  ['md autolink javascript', '<javascript:alert(1)>'],
  ['md code fence then script', '```js\nconst a=1;\n```\n\n<script>alert(2)</script>'],
];

test('sanitizeHtml renders raw (tool-output) markup inert', () => {
  for (const [label, dirty] of RAW_XSS_FIXTURES) {
    const out = sanitizeHtml(dirty);
    assertInert(out, `sanitizeHtml/${label}`);
  }
});

test('renderMarkdown renders untrusted model text inert', () => {
  for (const [label, src] of MARKDOWN_XSS_FIXTURES) {
    const out = renderMarkdown(src);
    assertInert(out, `renderMarkdown/${label}`);
  }
});

test('renderMarkdown still produces real formatting + highlighting', () => {
  const out = renderMarkdown('# Title\n\nSome **bold** and `code`.\n\n```ts\nconst x: number = 1;\n```');
  assert.match(out, /<h1[^>]*>/i, 'heading rendered');
  assert.match(out, /<strong>bold<\/strong>/i, 'bold rendered');
  assert.match(out, /<pre[^>]*class="hljs"|<code[^>]*hljs/i, 'code block highlighted');
});

test('renderCodeBlock keeps a backtick-fence body inside the code block', () => {
  // A file body containing a line of three backticks plus a markdown heading
  // must NOT break out of the fence and render the heading as live markup
  // (the old `'```'+body+'```'` fence-string path did exactly that).
  const body = 'line one\n```\n# Not A Heading\n[x](javascript:alert(1))';
  const out = renderCodeBlock(body, 'markdown');
  assert.doesNotMatch(out, /<h1[^>]*>/i, 'heading must stay literal inside the code block');
  assert.doesNotMatch(out, /<a\s/i, 'link must stay literal inside the code block');
  assert.match(out, /# Not A Heading/, 'the literal text is present (escaped) in the block');
  assertInert(out, 'renderCodeBlock/fence-breakout');
});

test('escapeText neutralizes angle brackets and quotes', () => {
  const out = escapeText('<script>"&\'</script>');
  assert.ok(!/<script/i.test(out), 'escapeText leaves no live <script>');
  assert.match(out, /&lt;script&gt;/, 'escapeText escapes angle brackets');
  assert.match(out, /&amp;/, 'escapeText escapes ampersand');
});

test('a safe https link survives sanitization', () => {
  const out = sanitizeHtml('<a href="https://example.com">ok</a>');
  assert.match(out, /href="https:\/\/example\.com"/, 'safe link preserved');
  assertInert(out, 'safe-link');
});
